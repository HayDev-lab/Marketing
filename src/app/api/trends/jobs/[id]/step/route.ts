import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { jobs } from "@/lib/jobs";
import { runTrendSearch } from "@/lib/trends/engine";
import { backoffDelayMs } from "@/lib/trends/dedup";

type Params = { params: Promise<{ id: string }> };

// Claim window: one TREND_SEARCH step = 1 webSearch (up to ~16s with internal
// retry) + 1 LLM classification (10-40s). The 60s batch window is too tight,
// so trend jobs get 180s.
const CLAIM_WINDOW_MS = 180_000;

function tooBusy() {
  return ok({ status: "BUSY" });
}

// POST /api/trends/jobs/[id]/step — drive a durable TREND_SEARCH job by one
// full search (bounded: 1 provider search + 1 LLM call). Claim-token guard:
// the same token renews the claim; a different token inside the freshness
// window gets BUSY — two drivers can never double-run the same search.
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) throw new ApiError(400, "NO_CLAIM_TOKEN", "Missing claim token");

    const job = await db.generationJob.findUnique({ where: { id } });
    if (!job || job.userId !== user.id) throw new ApiError(404, "JOB_NOT_FOUND", "Job not found");
    if (job.kind !== "TREND_SEARCH") throw new ApiError(400, "WRONG_KIND", "Not a trend search job");

    // terminal states report progress without doing work (idempotent re-drive)
    if (["COMPLETED", "FAILED", "CANCELLED", "NEEDS_USER_ACTION"].includes(job.status)) {
      const out = (() => {
        try { return job.outputJson ? (JSON.parse(job.outputJson) as Record<string, unknown>) : {}; } catch { return {}; }
      })();
      return ok({
        status: job.status,
        trendsFound: typeof out.trendsFound === "number" ? out.trendsFound : 0,
        duplicates: typeof out.duplicates === "number" ? out.duplicates : 0,
        error: job.error,
      });
    }

    // claim guard (same contract as CONTENT_BATCH steps)
    const now = Date.now();
    if (job.claimToken && job.claimToken !== token && job.claimAt && now - job.claimAt.getTime() < CLAIM_WINDOW_MS) {
      return tooBusy();
    }
    await db.generationJob.update({
      where: { id: job.id },
      data: { claimToken: token, claimAt: new Date() },
    });

    // bounded retry backoff: RETRYING jobs are not re-run before nextPollAt
    if (job.status === "RETRYING" && job.nextPollAt && job.nextPollAt.getTime() > now) {
      return ok({ status: "BACKOFF", nextPollAt: job.nextPollAt.toISOString() });
    }

    if (job.status === "QUEUED" || job.status === "RETRYING") {
      await db.generationJob.update({
        where: { id: job.id },
        data: { status: "PROCESSING", stage: "SEARCHING", startedAt: job.startedAt ?? new Date(), nextPollAt: null },
      });
    }

    const input = (() => {
      try { return job.inputJson ? (JSON.parse(job.inputJson) as Record<string, unknown>) : {}; } catch { return {}; }
    })();

    try {
      const result = await runTrendSearch({
        userId: user.id,
        brandId: typeof input.brandId === "string" ? input.brandId : null,
        topic: typeof input.topic === "string" && input.topic ? input.topic : "social media marketing",
        market: typeof input.market === "string" && input.market ? input.market : "Armenia",
        language: typeof input.language === "string" ? input.language : "hy",
        platform: typeof input.platform === "string" ? input.platform : "multi",
        recencyDays: typeof input.recencyDays === "number" ? input.recencyDays : 14,
        objective: typeof input.objective === "string" ? input.objective : undefined,
        maxSignals: typeof input.maxSignals === "number" ? input.maxSignals : undefined,
        minRelevance: typeof input.minRelevance === "number" ? input.minRelevance : undefined,
        minConfidence: typeof input.minConfidence === "number" ? input.minConfidence : undefined,
      });

      // cancel-guard: if the user cancelled mid-search, persist nothing more
      const fresh = await db.generationJob.findUnique({ where: { id: job.id }, select: { status: true } });
      if (fresh?.status === "CANCELLED") {
        return ok({ status: "CANCELLED", trendsFound: 0 });
      }

      await db.generationJob.update({ where: { id: job.id }, data: { checkpointJson: JSON.stringify({ stage: "persisted", found: result.trends.length }) } });
      await jobs.markCompleted(job.id, {
        trendsFound: result.trends.length,
        sourcesCount: result.sourcesCount,
        duplicates: result.duplicatesCollapsed,
        searchFallback: result.searchFallback,
        providerId: result.providerId,
        providerError: result.providerError ?? null,
        sources: result.sources.slice(0, 12),
      }, undefined, 0.005);
      await audit.log({
        userId: user.id,
        action: "trend.search_completed",
        objectType: "GenerationJob",
        objectId: job.id,
        summary: `Trend search: ${result.trends.length} signals, ${result.sourcesCount} sources${result.duplicatesCollapsed ? `, ${result.duplicatesCollapsed} duplicates collapsed` : ""}${result.searchFallback ? " (fallback: hypotheses)" : ""}`,
      });
      return ok({
        status: "COMPLETED",
        trendsFound: result.trends.length,
        sourcesCount: result.sourcesCount,
        duplicates: result.duplicatesCollapsed,
        searchFallback: result.searchFallback,
        providerError: result.providerError ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Trend search failed";
      const failed = await jobs.markFailed(job.id, message);
      if (failed.status === "RETRYING") {
        // bounded exponential backoff — a 429 must never become a hot loop
        await db.generationJob.update({
          where: { id: job.id },
          data: { nextPollAt: new Date(Date.now() + backoffDelayMs(failed.attempt)) },
        });
        return ok({ status: "RETRYING", attempt: failed.attempt, nextPollAt: failed.nextPollAt?.toISOString() });
      }
      await audit.log({
        userId: user.id,
        actorType: "SYSTEM",
        action: "trend.search_failed",
        objectType: "GenerationJob",
        objectId: job.id,
        summary: message.slice(0, 300),
      });
      return ok({ status: "FAILED", error: message });
    }
  });
}
