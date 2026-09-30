import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { jobs } from "@/lib/jobs";
import { backoffDelayMs } from "@/lib/trends/dedup";
import { adaptTrendToBusiness } from "@/lib/trends/adapt";
import { createDraftFromAdaptation } from "@/lib/trends/draft-bridge";

type Params = { params: Promise<{ id: string }> };

// One TREND_ADAPT step = 1 structured LLM call (10-40s) → same claim window
// discipline as TREND_SEARCH (180s).
const CLAIM_WINDOW_MS = 180_000;

function tooBusy() {
  return ok({ status: "BUSY" });
}

// POST /api/trends/adapt-jobs/[id]/step — drive a durable TREND_ADAPT job:
// adapt one trend to the business (structured LLM), then — ONLY if the
// autopilot policy explicitly allows generation — seed a DRAFT from the
// adaptation. Drafts always land in DRAFT state: autopilot never publishes.
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) throw new ApiError(400, "NO_CLAIM_TOKEN", "Missing claim token");

    const job = await db.generationJob.findUnique({ where: { id } });
    if (!job || job.userId !== user.id) throw new ApiError(404, "JOB_NOT_FOUND", "Job not found");
    if (job.kind !== "TREND_ADAPT") throw new ApiError(400, "WRONG_KIND", "Not a trend adapt job");

    // terminal states report progress without doing work (idempotent re-drive)
    if (["COMPLETED", "FAILED", "CANCELLED", "NEEDS_USER_ACTION"].includes(job.status)) {
      const out = (() => {
        try { return job.outputJson ? (JSON.parse(job.outputJson) as Record<string, unknown>) : {}; } catch { return {}; }
      })();
      return ok({
        status: job.status,
        done: 1,
        adaptationId: typeof out.adaptationId === "string" ? out.adaptationId : null,
        draftId: typeof out.draftId === "string" ? out.draftId : null,
        error: job.error,
      });
    }

    // claim guard (same contract as TREND_SEARCH / CONTENT_BATCH steps)
    const now = Date.now();
    if (job.claimToken && job.claimToken !== token && job.claimAt && now - job.claimAt.getTime() < CLAIM_WINDOW_MS) {
      return tooBusy();
    }
    await db.generationJob.update({
      where: { id: job.id },
      data: { claimToken: token, claimAt: new Date() },
    });

    // bounded retry backoff
    if (job.status === "RETRYING" && job.nextPollAt && job.nextPollAt.getTime() > now) {
      return ok({ status: "BACKOFF", nextPollAt: job.nextPollAt.toISOString() });
    }

    if (job.status === "QUEUED" || job.status === "RETRYING") {
      await db.generationJob.update({
        where: { id: job.id },
        data: { status: "PROCESSING", stage: "ADAPTING", startedAt: job.startedAt ?? new Date(), nextPollAt: null },
      });
    }

    const input = (() => {
      try { return job.inputJson ? (JSON.parse(job.inputJson) as Record<string, unknown>) : {}; } catch { return {}; }
    })();
    const trendId = typeof input.trendId === "string" ? input.trendId : "";
    const trend = trendId ? await db.trend.findUnique({ where: { id: trendId }, select: { id: true, title: true, userId: true } }) : null;
    if (!trend || trend.userId !== user.id) {
      await jobs.markFailed(job.id, "Trend not found", { needsUserAction: true });
      return ok({ status: "NEEDS_USER_ACTION", error: "Trend not found" });
    }

    try {
      // Retry idempotency: a READY adaptation for this trend+language IS the
      // artifact this job is producing (a previous attempt already paid the
      // LLM call). Reuse it — no duplicate rows, no duplicate cost.
      const adaptLanguage = typeof input.language === "string" ? input.language : "hy";
      const reusable = await db.trendAdaptation.findFirst({
        where: { trendId: trend.id, userId: user.id, status: "READY", language: adaptLanguage },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const adaptationId = reusable
        ? reusable.id
        : (
            await adaptTrendToBusiness({
              trendId: trend.id,
              userId: user.id,
              brandId: typeof input.brandId === "string" ? input.brandId : null,
              language: adaptLanguage,
              platform: typeof input.platform === "string" ? input.platform : undefined,
              objective: typeof input.objective === "string" ? input.objective : "engagement",
            })
          ).adaptationId;

      // cancel-guard: user cancelled while the LLM was thinking — the
      // adaptation itself is already persisted (harmless), but no draft spawns
      const fresh = await db.generationJob.findUnique({ where: { id: job.id }, select: { status: true } });
      if (fresh?.status === "CANCELLED") {
        await jobs.markCompleted(job.id, { adaptationId, draftId: null, cancelledBeforeDraft: true }, undefined, 0.004);
        return ok({ status: "CANCELLED", adaptationId, draftId: null });
      }

      // Generation gate: draft seeding only when the policy explicitly allows it
      let draftId: string | null = null;
      let draftNote: string | null = null;
      const policy = await db.autopilotPolicy.findUnique({ where: { userId: user.id } });
      if (policy?.enabled && policy.autoGeneration) {
        // resolve a brand for the draft: job input → primary brand (audited) → none
        let draftBrandId = typeof input.brandId === "string" && input.brandId ? input.brandId : null;
        if (!draftBrandId) {
          const primary = await db.brand.findFirst({
            where: { userId: user.id },
            orderBy: { updatedAt: "desc" },
            select: { id: true, name: true },
          });
          draftBrandId = primary?.id ?? null;
          if (draftBrandId) {
            await audit.log({
              userId: user.id,
              actorType: "AUTOPILOT",
              action: "trend.adapt_brand_resolved",
              objectType: "GenerationJob",
              objectId: job.id,
              summary: `Policy has no brand list — using primary brand: ${primary?.name.slice(0, 80)}`,
            });
          }
        }
        if (draftBrandId) {
          const draft = await createDraftFromAdaptation({
            userId: user.id,
            adaptationId,
            titleOverride: trend.title,
            brandIdOverride: draftBrandId,
          });
          draftId = draft.contentItemId;
        } else {
          draftNote = "no brand available for draft — adaptation kept READY";
        }
      } else if (policy && !policy.autoGeneration) {
        draftNote = "draft generation disabled by policy";
      }

      await jobs.markCompleted(job.id, { adaptationId, draftId, draftNote }, undefined, 0.004);
      await audit.log({
        userId: user.id,
        actorType: "AUTOPILOT",
        action: "trend.adapt_completed",
        objectType: "GenerationJob",
        objectId: job.id,
        summary: `Adapted trend: ${trend.title.slice(0, 120)}${draftId ? " → draft created" : ` (${draftNote ?? "no draft"})`}`,
      });
      return ok({ status: "COMPLETED", done: 1, adaptationId, draftId, draftNote });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Trend adaptation failed";
      const failed = await jobs.markFailed(job.id, message);
      if (failed.status === "RETRYING") {
        // bounded exponential backoff — never a hot loop
        await db.generationJob.update({
          where: { id: job.id },
          data: { nextPollAt: new Date(Date.now() + backoffDelayMs(failed.attempt)) },
        });
        return ok({ status: "RETRYING", attempt: failed.attempt, nextPollAt: failed.nextPollAt?.toISOString() });
      }
      await audit.log({
        userId: user.id,
        actorType: "SYSTEM",
        action: "trend.adapt_failed",
        objectType: "GenerationJob",
        objectId: job.id,
        summary: message.slice(0, 300),
      });
      return ok({ status: "FAILED", error: message });
    }
  });
}
