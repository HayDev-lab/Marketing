import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { jobs } from "@/lib/jobs";
import { serializeTrend } from "@/lib/trends/engine";
import { searchFingerprint, trendSearchIdempotencyKey } from "@/lib/trends/fingerprint";

const PLATFORMS = ["instagram", "tiktok", "facebook", "telegram", "multi"];

// GET /api/trends?brandId=&status= — list trends (serialized DTOs)
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const brandId = url.searchParams.get("brandId");
    const status = url.searchParams.get("status");
    const trends = await db.trend.findMany({
      where: {
        userId: user.id,
        ...(brandId ? { brandId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 60,
    });
    return ok(trends.map(serializeTrend));
  });
}

// POST /api/trends — creates a DURABLE TREND_SEARCH job (fingerprinted).
// The actual search runs in POST /api/trends/jobs/[id]/step, driven by the
// trends UI or the global worker chip — survives reload, restart-safe.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const brandId = body.brandId ? String(body.brandId) : null;
    if (brandId) {
      const brand = await db.brand.findUnique({ where: { id: brandId }, select: { userId: true } });
      if (!brand || brand.userId !== user.id) throw new ApiError(404, "BRAND_NOT_FOUND", "Brand not found");
    }
    const topic = body.topic ?? body.niche ?? "";
    const market = body.market ?? body.region ?? "Armenia";
    const language = ["hy", "ru", "en"].includes(body.language) ? body.language : "hy";
    const platform = PLATFORMS.includes(body.platform) ? body.platform : "multi";
    const recencyDays = [7, 14, 30].includes(Number(body.recencyDays)) ? Number(body.recencyDays) : 14;
    const objective = body.objective ? String(body.objective).slice(0, 60) : "engagement";

    // Idempotency: identical search within the same hour-bucket returns the
    // existing job — no 50 duplicate runs, no duplicate paid work.
    const fingerprint = searchFingerprint({
      userId: user.id,
      brandId,
      market,
      language,
      platform,
      query: topic,
      recencyDays,
      bucketHours: 1,
    });
    const idempotencyKey = trendSearchIdempotencyKey(user.id, fingerprint);
    const { job, deduplicated } = await jobs.create({
      userId: user.id,
      kind: "TREND_SEARCH",
      provider: "zai-web-search",
      input: { topic, market, language, platform, recencyDays, objective, brandId, fingerprint },
      idempotencyKey,
      maxAttempts: 3,
      brandId: brandId ?? undefined,
      estimatedCost: 0.005,
      checkpointJson: { stage: "queued" },
    });
    if (brandId) await db.trend.updateMany({ where: { jobId: job.id, brandId: null }, data: { brandId } }); // attach brand to re-run rows
    await audit.log({
      userId: user.id,
      action: "trend.search_job_create",
      objectType: "GenerationJob",
      objectId: job.id,
      summary: `${deduplicated ? "Reattached to existing" : "Created"} TREND_SEARCH job for ${topic || "general"} / ${market}`,
    });
    return ok({ jobId: job.id, status: job.status, deduplicated, fingerprint });
  });
}
