// Autopilot chain: TREND_SEARCH (completed, autopilot-flagged) → bounded
// TREND_ADAPT jobs → (policy-gated) seeded drafts. Honest bounds:
//  - only signals that came from THIS search job (Trend.jobId)
//  - policy thresholds (minimumRelevance / minimumConfidence) re-checked
//    against the STORED scores
//  - one autopilot adaptation per trend, ever (skip if any exists)
//  - hard cap maxAdaptPerRun (schema default 2) — autopilot never floods
//  - HYPOTHESIS rows are never auto-adapted (unverified speculation)

import { db } from "@/lib/db";
import { jobs } from "@/lib/jobs";
import { audit } from "@/lib/ledger";
import { parseJson } from "@/lib/api";

const AUTOPILOT_ADAPT_CAP = 3; // absolute ceiling even if the policy says more

export interface EnqueueResult {
  queued: number;
  skippedExisting: number;
  skippedThreshold: number;
  skippedHypothesis: number;
}

export async function enqueueAdaptationsAfterSearch(userId: string, searchJobId: string): Promise<EnqueueResult> {
  const policy = await db.autopilotPolicy.findUnique({ where: { userId } });
  if (!policy || !policy.enabled || !policy.trendDiscovery) {
    return { queued: 0, skippedExisting: 0, skippedThreshold: 0, skippedHypothesis: 0 };
  }

  const cap = Math.min(Math.max(policy.maxAdaptPerRun ?? 2, 0), AUTOPILOT_ADAPT_CAP);
  if (cap === 0) return { queued: 0, skippedExisting: 0, skippedThreshold: 0, skippedHypothesis: 0 };

  const signals = await db.trend.findMany({
    where: { userId, jobId: searchJobId },
    orderBy: [{ relevanceScore: "desc" }],
    take: 12,
  });

  const brandIds = parseJson<string[]>(policy.brandsJson, []).filter(Boolean);
  let brandId: string | null = brandIds[0] ?? null;
  if (!brandId) {
    // policy has no brand allowlist → resolve the user's primary brand so
    // adaptations get real brand context (tone/positioning) and drafts have a
    // brand to attach to. Recorded in the job input + audit — never silent.
    const primary = await db.brand.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    });
    brandId = primary?.id ?? null;
  }
  const languages = parseJson<string[]>(policy.languagesJson, ["hy"]);
  const platforms = parseJson<string[]>(policy.platformsJson, ["instagram"]);
  const language = languages[0] ?? "hy";
  const platform = platforms[0] ?? "instagram";

  const result: EnqueueResult = { queued: 0, skippedExisting: 0, skippedThreshold: 0, skippedHypothesis: 0 };

  for (const trend of signals) {
    if (result.queued >= cap) break;
    if (trend.status === "HYPOTHESIS") {
      result.skippedHypothesis++;
      continue;
    }
    if ((trend.relevanceScore ?? 0) < policy.minimumRelevance || (trend.confidence ?? 0) < policy.minimumConfidence) {
      result.skippedThreshold++;
      continue;
    }
    const existing = await db.trendAdaptation.findFirst({ where: { trendId: trend.id }, select: { id: true } });
    if (existing) {
      result.skippedExisting++;
      continue;
    }

    const { job, deduplicated } = await jobs.create({
      userId,
      kind: "TREND_ADAPT",
      provider: "zai-llm",
      input: {
        trendId: trend.id,
        trendTitle: trend.title,
        brandId,
        language,
        platform,
        objective: "autopilot",
        autopilot: true,
        searchJobId,
      },
      idempotencyKey: `trendadapt:${userId}:${trend.id}`,
      maxAttempts: 2,
      brandId: brandId ?? undefined,
      estimatedCost: 0.004,
      checkpointJson: { stage: "queued", source: "autopilot", trendTitle: trend.title },
    });
    if (!deduplicated) result.queued++;
    await audit.log({
      userId,
      actorType: "AUTOPILOT",
      action: "autopilot.trend_adapt",
      objectType: "GenerationJob",
      objectId: job.id,
      summary: `Auto-adapt trend: ${trend.title.slice(0, 120)}${deduplicated ? " (dedup)" : ""}`,
    });
  }

  return result;
}
