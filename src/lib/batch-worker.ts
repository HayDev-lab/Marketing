"use client";

// ---- Shared client-side driver for durable CONTENT_BATCH jobs ----
// Single source of truth for "which batch job is being stepped right now":
// the Planner (manual start/resume) and the global background worker chip
// (app-shell, auto-resume on any view) both go through claim() — so a job
// can never be double-stepped by two loops in the same tab. Cross-tab safety
// comes from the server-side claimAt guard on the step route (BUSY response).
//
// The driver emits progress + finish events; UI surfaces (Planner card, floating
// chip) subscribe instead of owning the loop. The job itself is checkpointed
// server-side, so any driver crash is recoverable by simply driving again.

import { api } from "@/lib/use-i18n";

export interface BatchRun {
  jobId: string;
  planId: string;
  done: number;
  total: number;
}

export type BatchFinishKind = "COMPLETED" | "CANCELLED" | "PARTIAL" | "FAILED" | "NETWORK";

export interface BatchFinishEvent {
  run: BatchRun;
  kind: BatchFinishKind;
  done: number;
  total: number;
  /** raw transport error message, only for kind=NETWORK */
  error?: string;
}

type FinishListener = (e: BatchFinishEvent) => void;
type ProgressListener = (runs: BatchRun[]) => void;

const active = new Map<string, BatchRun>();
const finishListeners = new Set<FinishListener>();
const progressListeners = new Set<ProgressListener>();

export function activeRuns(): BatchRun[] {
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

function emitFinish(e: BatchFinishEvent) {
  for (const l of finishListeners) {
    try {
      l(e);
    } catch {
      /* same */
    }
  }
}

/**
 * Step a batch job to its terminal state, one bounded POST per item (~one LLM call).
 * Each drive holds a claim token: the server renews it for the same token and answers
 * BUSY to a different driver inside the freshness window — so the Planner and the
 * background chip (or another tab) can never double-step the same job.
 * Returns false immediately when the job is already claimed in this tab (or the server
 * says BUSY because another tab is driving it) — no duplicate stepping.
 */
export async function driveBatchJob(run: BatchRun): Promise<boolean> {
  if (active.has(run.jobId)) return false;
  active.set(run.jobId, { ...run });
  emitProgress();
  const token =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `t${Date.now()}${Math.random().toString(36).slice(2)}`;
  try {
    for (;;) {
      const st = await api<{ status: string; done: number; total: number }>(
        `/api/plans/content/batch-jobs/${run.jobId}/step`,
        { method: "POST", body: JSON.stringify({ token }) },
      );
      if (st.status === "BUSY") {
        // another driver (other tab / other loop) holds the claim — release silently;
        // the job stays in the feed and its real driver will finish it
        active.delete(run.jobId);
        emitProgress();
        return false;
      }
      const cur = active.get(run.jobId);
      if (cur) {
        cur.done = st.done;
        cur.total = st.total || cur.total;
        emitProgress();
      }
      if (st.status === "PROCESSING") continue;
      // terminal
      active.delete(run.jobId);
      emitProgress();
      const total = st.total || run.total;
      const kind: BatchFinishKind =
        st.status === "COMPLETED"
          ? "COMPLETED"
          : st.status === "CANCELLED"
            ? st.done > 0
              ? "PARTIAL"
              : "CANCELLED"
            : "FAILED"; // FAILED / NEEDS_USER_ACTION — surfaced honestly
      emitFinish({ run, kind, done: st.done, total });
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
