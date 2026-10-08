// Durable Generation Engine — internal job records, idempotency, reconciliation, resume, cancel.
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { videoPoll, downloadToBuffer, saveAssetBuffer } from "@/lib/ai/zai";
import { ledger, audit } from "@/lib/ledger";

export type JobKind =
  | "LLM"
  | "IMAGE"
  | "VIDEO"
  | "ASSEMBLE"
  | "TTS"
  | "MUSIC"
  | "TRANSCRIPTION"
  | "ANALYZE_SITE"
  | "TREND_SEARCH"
  | "TREND_ADAPT"
  | "PLAN"
  | "CONTENT_BATCH"
  | "AUTOPILOT_CYCLE";

export interface CreateJobInput {
  userId: string;
  kind: JobKind;
  provider: string;
  model?: string;
  input: Record<string, unknown>;
  idempotencyKey?: string;
  brandId?: string;
  estimatedCost?: number;
  maxAttempts?: number;
  checkpointJson?: Record<string, unknown>;
}

function hashInput(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 32);
}

export const jobs = {
  async create(input: CreateJobInput) {
    const inputHash = hashInput(input.input);
    // Idempotency: an ACTIVE job with the same key is rejoined (no duplicate
    // paid work). A TERMINAL job (completed/failed/cancelled) with the same
    // fingerprint never blocks a deliberate re-run — the new job gets a
    // derived key; downstream trend dedupKey collapsing keeps data clean.
    if (input.idempotencyKey) {
      const existing = await db.generationJob.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing && existing.userId !== input.userId) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key already used");
      const ACTIVE = ["DRAFT", "QUEUED", "SUBMITTED", "PROCESSING", "WAITING_PROVIDER", "RETRYING"];
      if (existing && ACTIVE.includes(existing.status)) return { job: existing, deduplicated: true };
      if (existing) {
        const siblings = await db.generationJob.count({
          where: { idempotencyKey: { startsWith: `${input.idempotencyKey}#r` } },
        });
        input = { ...input, idempotencyKey: `${input.idempotencyKey}#r${siblings + 1}` };
      }
    }
    const job = await db.generationJob.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        provider: input.provider,
        model: input.model,
        status: "QUEUED",
        inputJson: JSON.stringify(input.input),
        inputHash,
        idempotencyKey: input.idempotencyKey,
        maxAttempts: input.maxAttempts ?? 3,
        ...(input.checkpointJson ? { checkpointJson: JSON.stringify(input.checkpointJson) } : {}),
      },
    });
    if (input.estimatedCost && input.estimatedCost > 0) {
      await ledger.record({
        userId: input.userId,
        brandId: input.brandId,
        jobId: job.id,
        provider: input.provider,
        model: input.model,
        capability: input.kind,
        estimatedCost: input.estimatedCost,
      });
    }
    return { job, deduplicated: false };
  },

  async markSubmitted(jobId: string, providerJobId?: string) {
    return db.generationJob.update({
      where: { id: jobId },
      data: { status: "WAITING_PROVIDER", providerJobId, startedAt: new Date(), stage: "SUBMITTED" },
    });
  },

  async markProcessing(jobId: string) {
    return db.generationJob.update({ where: { id: jobId }, data: { status: "PROCESSING", stage: "RUNNING" } });
  },

  async markCompleted(jobId: string, output: Record<string, unknown>, resultAssetId?: string, actualCost?: number) {
    const job = await db.generationJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        stage: "DONE",
        outputJson: JSON.stringify(output),
        resultAssetId,
        finishedAt: new Date(),
        ...(actualCost != null ? { cost: actualCost } : {}),
      },
    });
    if (actualCost != null) {
      await ledger.recordActual(job.userId, jobId, actualCost);
    }
    return job;
  },

  async markFailed(jobId: string, error: string, opts?: { needsUserAction?: boolean }) {
    const job = await db.generationJob.findUnique({ where: { id: jobId } });
    if (!job) throw new ApiError(404, "JOB_NOT_FOUND", "Job not found");
    const attempt = job.attempt + 1;
    const retryable = attempt < job.maxAttempts;
    return db.generationJob.update({
      where: { id: jobId },
      data: {
        status: opts?.needsUserAction ? "NEEDS_USER_ACTION" : retryable ? "RETRYING" : "FAILED",
        attempt,
        error: error.slice(0, 1000),
        finishedAt: retryable ? null : new Date(),
      },
    });
  },

  // Reconcile an async provider job (video): ask provider, persist result, no double spend.
  async reconcileVideo(jobId: string, userId: string) {
    const job = await db.generationJob.findUnique({ where: { id: jobId } });
    if (!job || job.userId !== userId) throw new ApiError(404, "JOB_NOT_FOUND", "Job not found");
    if (job.status === "COMPLETED") return job;
    if (job.status === "FAILED" || job.status === "CANCELLED" || job.status === "NEEDS_USER_ACTION") return job;
    if (!job.providerJobId) throw new ApiError(409, "NO_PROVIDER_JOB", "Job was never submitted to provider");

    const poll = await videoPoll(job.providerJobId);
    if (poll.status === "PROCESSING") {
      const updated = await db.generationJob.update({
        where: { id: jobId },
        data: { status: "WAITING_PROVIDER", nextPollAt: new Date(Date.now() + 8000) },
      });
      return updated;
    }
    if (poll.status === "FAIL") {
      const failed = await this.markFailed(jobId, poll.error ?? "provider FAIL");
      await audit.log({
        userId,
        actorType: "SYSTEM",
        action: "job.provider_fail",
        objectType: "GenerationJob",
        objectId: jobId,
        summary: `Video provider failed: ${poll.error}`,
      });
      return failed;
    }
    // SUCCESS → download once (idempotent: only if no asset yet)
    if (job.resultAssetId) return db.generationJob.findUnique({ where: { id: jobId } });
    const buf = await downloadToBuffer(poll.outputUrl!, job.provider);
    const asset = await saveAssetBuffer(userId, buf, "VIDEO", "video/mp4", `video_${jobId}.mp4`, {
      providerJobId: job.providerJobId,
      provider: job.provider,
    });
    const done = await this.markCompleted(jobId, { videoUrl: `/api/assets/${asset.id}/raw`, assetId: asset.id }, asset.id);
    await audit.log({
      userId,
      actorType: "SYSTEM",
      action: "job.completed",
      objectType: "GenerationJob",
      objectId: jobId,
      summary: "Video generation completed and asset stored",
    });
    return done;
  },

  // Resume from last checkpoint. Never re-spends if provider already has the job.
  async resume(jobId: string, userId: string) {
    const job = await db.generationJob.findUnique({ where: { id: jobId } });
    if (!job || job.userId !== userId) throw new ApiError(404, "JOB_NOT_FOUND", "Job not found");
    if (job.status === "COMPLETED") return job;
    if (job.providerJobId && job.kind === "VIDEO") {
      // provider job exists — reconcile, do NOT resubmit
      await db.generationJob.update({ where: { id: jobId }, data: { status: "RETRYING" } });
      return this.reconcileVideo(jobId, userId);
    }
    if (job.status === "RETRYING" || job.status === "FAILED" || job.status === "NEEDS_USER_ACTION") {
      return db.generationJob.update({
        where: { id: jobId },
        data: { status: "QUEUED", error: null, stage: "RESUMED" },
      });
    }
    return job;
  },

  async cancel(jobId: string, userId: string) {
    const job = await db.generationJob.findUnique({ where: { id: jobId } });
    if (!job || job.userId !== userId) throw new ApiError(404, "JOB_NOT_FOUND", "Job not found");
    if (job.status === "COMPLETED") throw new ApiError(409, "JOB_COMPLETED", "Cannot cancel a completed job");
    return db.generationJob.update({
      where: { id: jobId },
      data: { status: "CANCELLED", finishedAt: new Date(), stage: "CANCELLED" },
    });
  },

  async getForUser(jobId: string, userId: string) {
    const job = await db.generationJob.findUnique({ where: { id: jobId } });
    if (!job || job.userId !== userId) throw new ApiError(404, "JOB_NOT_FOUND", "Job not found");
    return job;
  },

  async listForUser(userId: string, limit = 30) {
    return db.generationJob.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
  },
};
