import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { jobs } from "@/lib/jobs";
import { searchFingerprint, trendSearchIdempotencyKey } from "@/lib/trends/fingerprint";
import { parseJson } from "@/lib/api";

// POST /api/autopilot/trend-search — one supervised, policy-bounded
// TREND_SEARCH job. Autopilot never means "AI can do everything": the run is
// constrained by the user's trend policy (markets, keywords, platforms,
// thresholds, max signals) and goes through the SAME durable job pipeline as
// manual searches (fingerprinted, reload-safe, cancelable).
// ?scheduled=1 — called by the opt-in chip scheduler: the route itself then
// enforces searchFrequencyHours as a minimum interval between ANY trend
// searches (quota-safe regardless of what the client knows). The manual
// "Run policy search" button is never frequency-limited.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const policy = await db.autopilotPolicy.findUnique({ where: { userId: user.id } });
    if (!policy) throw new ApiError(423, "AUTOPILOT_DISABLED", "Configure Autopilot first");
    if (!policy.enabled || !policy.trendDiscovery) {
      throw new ApiError(423, "TREND_AUTOPILOT_DISABLED", "Enable Autopilot and Trend discovery first");
    }

    const scheduled = new URL(req.url).searchParams.get("scheduled") === "1";
    if (scheduled) {
      const last = await db.generationJob.findFirst({
        where: { userId: user.id, kind: "TREND_SEARCH" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const freqHours = Math.max(policy.searchFrequencyHours ?? 24, 1);
      if (last && Date.now() - last.createdAt.getTime() < freqHours * 3_600_000) {
        return ok({ skipped: "frequency", lastSearchAt: last.createdAt.toISOString(), frequencyHours: freqHours });
      }
    }

    const markets = parseJson<string[]>(policy.marketsJson, []);
    const keywords = parseJson<string[]>(policy.keywordsJson, []);
    const platforms = parseJson<string[]>(policy.platformsJson, ["instagram"]);
    const languages = parseJson<string[]>(policy.languagesJson, ["hy"]);
    const allowedBrands = parseJson<string[]>(policy.brandsJson, []);
    if (allowedBrands.length && allowedBrands[0]) {
      const b = await db.brand.findUnique({ where: { id: allowedBrands[0] }, select: { userId: true } });
      if (b && b.userId !== user.id) throw new ApiError(423, "BRAND_NOT_ALLOWED", "Brand not allowed");
    }

    const market = markets[0] ?? "Armenia";
    const topic = keywords.slice(0, 5).join(" ") || "social media marketing";
    const platform = platforms[0] ?? "multi";
    const language = languages[0] ?? "hy";
    const brandId = allowedBrands[0] && markets.length ? allowedBrands[0] : null;

    const fingerprint = searchFingerprint({
      userId: user.id,
      brandId,
      market,
      language,
      platform,
      query: topic,
      recencyDays: 14,
      bucketHours: 1,
    });
    const { job, deduplicated } = await jobs.create({
      userId: user.id,
      kind: "TREND_SEARCH",
      provider: "zai-web-search",
      input: {
        topic,
        market,
        language,
        platform,
        recencyDays: 14,
        objective: "autopilot",
        brandId,
        fingerprint,
        autopilot: true,
        maxSignals: policy.maxSignalsPerRun,
        minRelevance: policy.minimumRelevance,
        minConfidence: policy.minimumConfidence,
      },
      idempotencyKey: trendSearchIdempotencyKey(user.id, fingerprint),
      maxAttempts: 2, // autopilot retries are tighter than manual runs
      brandId: brandId ?? undefined,
      estimatedCost: 0.005,
      checkpointJson: { stage: "queued", source: "autopilot" },
    });
    await audit.log({
      userId: user.id,
      actorType: "AUTOPILOT",
      action: "autopilot.trend_search",
      objectType: "GenerationJob",
      objectId: job.id,
      summary: `Policy-bounded trend search (${deduplicated ? "dedup" : "new"}): ${topic} / ${market} [${platform}]`,
    });
    return ok({ jobId: job.id, status: job.status, deduplicated, policy: { market, platform, topic, language, maxSignals: policy.maxSignalsPerRun } });
  });
}
