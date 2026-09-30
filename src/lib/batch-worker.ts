"use client";

// ---- Shared client-side driver for durable jobs (CONTENT_BATCH, TREND_SEARCH) ----
// Single source of truth for "which job is being stepped right now":
// the Planner / Trends view (manual start/resume) and the global background
// worker chip (app-shell, auto-resume on any view) both go through claim() —
// so a job can never be double-stepped by two loops in the same tab.
// Cross-tab safety comes from the server-side claimAt guard on the step
// routes (BUSY response).
//
// The driver emits progress + finish events; UI surfaces subscribe instead of
// owning the loop. Jobs are checkpointed server-side, so any driver crash is
// recoverable by simply driving again.

import { api } from "@/lib/use-i18n";

export type DrivableKind = "CONTENT_BATCH" | "TREND_SEARCH" | "TREND_ADAPT";

export interface JobRun {
  jobId: string;
  kind: DrivableKind;
  /** batch: owning plan; trend: search topic (for chip labels) */
  planId?: string;
  topic?: string;
  done: number;
  total: number;
  /** display stage for trend jobs (SEARCHING / …) */
  stage?: string;
}

// backward-compatible alias used by the Planner (kind is optional and forced
// to CONTENT_BATCH by the wrapper below)
export type BatchRun = Omit<JobRun, "kind"> & { kind?: "CONTENT_BATCH" };

export type JobFinishKind = "COMPLETED" | "CANCELLED" | "PARTIAL" | "FAILED" | "NETWORK" | "RETRY_LATER";

export interface JobFinishEvent {
  run: JobRun;
  kind: JobFinishKind;
  done: number;
  total: number;
  /** raw transport error message, only for kind=NETWORK */
  error?: string;
}

type FinishListener = (e: JobFinishEvent) => void;
type ProgressListener = (runs: JobRun[]) => void;

const active = new Map<string, JobRun>();
const finishListeners = new Set<FinishListener>();
const progressListeners = new Set<ProgressListener>();

export function activeRuns(): JobRun[] {
  return Array.from(active.values());
}

export function isActive(jobId: string): boolean {
  return active.has(jobId);
}

export function onBatchProgress(l: ProgressListener): () => void {
  progressListeners.add(l);
  return () => {
    progressListeners.delete(l);
  };
}

export function onBatchFinish(l: FinishListener): () => void {
  finishListeners.add(l);
  return () => {
    finishListeners.delete(l);
  };
}

function emitProgress() {
  const runs = activeRuns();
  for (const l of progressListeners) {
    try {
      l(runs);
    } catch {
      /* a broken listener must never break the drive loop */
    }
  }
}

function emitFinish(e: JobFinishEvent) {
  for (const l of finishListeners) {
    try {
      l(e);
    } catch {
      /* same */
    }
  }
}

function stepEndpoint(kind: DrivableKind, jobId: string): string {
  return kind === "CONTENT_BATCH"
    ? `/api/plans/content/batch-jobs/${jobId}/step`
    : kind === "TREND_ADAPT"
      ? `/api/trends/adapt-jobs/${jobId}/step`
      : `/api/trends/jobs/${jobId}/step`;
}

function makeToken(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `t${Date.now()}${Math.random().toString(36).slice(2)}`;
}

/**
 * Step a durable job to its terminal state (one bounded POST per step).
 * Each drive holds a claim token: the server renews it for the same token and
 * answers BUSY to a different driver inside the freshness window — so the
 * Planner/Trends and the background chip (or another tab) can never
 * double-step the same job. RETRY_LATER means the job hit a retryable failure
 * and is backing off (nextPollAt) — released silently, the poller re-drives
 * it when due; attempts are bounded server-side, so 429s never hot-loop.
 */
export async function driveJob(run: JobRun): Promise<boolean> {
  if (active.has(run.jobId)) return false;
  active.set(run.jobId, { ...run });
  emitProgress();
  const token = makeToken();
  try {
    for (;;) {
      const st = await api<{ status: string; done?: number; total?: number; stage?: string; trendsFound?: number }>(
        stepEndpoint(run.kind, run.jobId),
        { method: "POST", body: JSON.stringify({ token }) },
      );
      if (st.status === "BUSY" || st.status === "BACKOFF") {
        // another driver holds the claim / job is in backoff — release silently;
        // the poller re-drives when due, the real driver will finish it
        active.delete(run.jobId);
        emitProgress();
        return false;
      }
      const cur = active.get(run.jobId);
      if (cur) {
        if (typeof st.done === "number") cur.done = st.done;
        if (typeof st.total === "number" && st.total > 0) cur.total = st.total;
        if (typeof st.stage === "string") cur.stage = st.stage;
        if (typeof st.trendsFound === "number") cur.done = st.trendsFound;
        emitProgress();
      }
      if (st.status === "PROCESSING") continue;
      // terminal
      active.delete(run.jobId);
      emitProgress();
      const total = typeof st.total === "number" && st.total ? st.total : run.total;
      const done = typeof st.done === "number" ? st.done : run.done;
      let kind: JobFinishKind;
      if (st.status === "COMPLETED") kind = "COMPLETED";
      else if (st.status === "RETRYING" || st.status === "WAITING_PROVIDER") kind = "RETRY_LATER";
      else if (st.status === "CANCELLED") kind = done > 0 && (run.kind === "CONTENT_BATCH" || run.kind === "TREND_ADAPT") ? "PARTIAL" : "CANCELLED";
      else if (st.status === "NEEDS_USER_ACTION" || st.status === "FAILED") kind = "FAILED";
      else kind = "FAILED";
      emitFinish({ run, kind, done, total });
      return true;
    }
  } catch (e) {
    // network/provider failure mid-loop — the job stays in the DB, resumable via chip or poll
    active.delete(run.jobId);
    emitProgress();
    emitFinish({
      run,
      kind: "NETWORK",
      done: run.done,
      total: run.total,
      error: e instanceof Error ? e.message : String(e),
    });
    return true;
  }
}

/** Backward-compatible wrapper used by the Planner for CONTENT_BATCH runs. */
export async function driveBatchJob(run: BatchRun): Promise<boolean> {
  return driveJob({ ...run, kind: run.kind ?? "CONTENT_BATCH" });
}
