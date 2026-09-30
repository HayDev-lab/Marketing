"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Pause, Play, Radar } from "lucide-react";
import { useApp } from "@/lib/store";
import { useI18n, api } from "@/lib/use-i18n";
import {
  driveJob,
  isActive,
  onBatchFinish,
  onBatchProgress,
  type DrivableKind,
  type JobFinishEvent,
  type JobRun,
} from "@/lib/batch-worker";

interface JobDto {
  id: string;
  kind: string;
  status: string;
  inputJson: string | null;
  outputJson: string | null;
  nextPollAt: string | null;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const KINDS: DrivableKind[] = ["CONTENT_BATCH", "TREND_SEARCH"];

// ---- Global background job worker (mounted once in the app shell) ----
// Polls the job feed every 10s; any in-flight CONTENT_BATCH or TREND_SEARCH
// job that nobody in this tab is driving gets auto-resumed — on ANY view,
// right after a reload, without its module being open. Honest by design:
// pausing only stops PICKING UP jobs (a running loop finishes naturally),
// jobs are never deleted, finish toasts are centralized here so modules and
// the chip never double-report, and retrying trend jobs are only re-driven
// after their server-set nextPollAt backoff (no 429 hot loops).
export function BatchWorkerChip() {
  const { t } = useI18n();
  const setView = useApp((s) => s.setView);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const pollingRef = useRef(false);

  // local mirror of the shared claim registry
  useEffect(() => onBatchProgress(setRuns), []);

  // centralized finish toasts (single reporter for every driver in this tab)
  useEffect(
    () =>
      onBatchFinish((e: JobFinishEvent) => {
        if (e.run.kind === "TREND_SEARCH") {
          if (e.kind === "COMPLETED") toast.success(t("worker.trendDone", { n: e.done }));
          else if (e.kind === "RETRY_LATER") toast.info(t("worker.trendRetrying"));
          else if (e.kind === "CANCELLED") toast.info(t("worker.trendCancelled"));
          else if (e.kind === "FAILED") toast.error(t("worker.trendFailed"));
          else if (e.kind === "NETWORK") toast.error(t("worker.trendFailed"), { description: t("worker.trendInterrupted") });
          return;
        }
        if (e.kind === "COMPLETED") toast.success(t("planner.batchDone", { n: e.done }));
        else if (e.kind === "PARTIAL") toast.info(t("planner.batchPartial", { n: e.done }));
        else if (e.kind === "CANCELLED") toast.info(t("planner.batchStopped"));
        else if (e.kind === "FAILED")
          toast.error(t("planner.batchFailed"), { description: t("planner.batchInterrupted") });
        else
          toast.error(e.error ?? t("planner.batchFailed"), {
            description: t("planner.batchInterrupted"),
          });
      }),
    [t],
  );

  // the worker loop
  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      if (disposed || pausedRef.current || pollingRef.current) return;
      pollingRef.current = true;
      try {
        const jobList = await api<JobDto[]>("/api/jobs?limit=30");
        if (disposed || pausedRef.current) return;
        const now = Date.now();
        for (const j of jobList) {
          const kind = KINDS.find((k) => k === j.kind);
          if (!kind) continue;
          if (!["QUEUED", "PROCESSING", "RETRYING"].includes(j.status)) continue;
          if (isActive(j.id)) continue;
          // trend jobs in backoff window: wait — bounded retries, no hot loop
          if (kind === "TREND_SEARCH" && j.nextPollAt && new Date(j.nextPollAt).getTime() > now) continue;
          const inp = parseJson<{ planId?: string; indexes?: number[]; topic?: string; brandId?: string }>(j.inputJson, {});
          const out = parseJson<{ done?: number; trendsFound?: number }>(j.outputJson, {});
          if (kind === "CONTENT_BATCH" && !inp.planId) continue;
          // auto-resume: fire-and-forget — driveJob registers in the shared registry,
          // progress/finish events flow to every mounted surface
          void driveJob({
            jobId: j.id,
            kind,
            planId: inp.planId,
            topic: inp.topic,
            done: typeof out.trendsFound === "number" ? out.trendsFound : typeof out.done === "number" ? out.done : 0,
            total: kind === "CONTENT_BATCH" && Array.isArray(inp.indexes) ? inp.indexes.length : 0,
          });
        }
      } catch {
        /* job feed unreachable — honest retry on the next tick */
      } finally {
        pollingRef.current = false;
      }
    };
    poll(); // resume immediately on mount — covers a reload mid-run on ANY view
    const id = setInterval(poll, 10_000);
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, []);

  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  };

  const busy = runs.length > 0;
  const batchRuns = runs.filter((r) => r.kind === "CONTENT_BATCH");
  const trendRuns = runs.filter((r) => r.kind === "TREND_SEARCH");
  const done = batchRuns.reduce((s, r) => s + r.done, 0);
  const total = batchRuns.reduce((s, r) => s + r.total, 0);
  const first = batchRuns[0];
  const trendFirst = trendRuns[0];

  return (
    <AnimatePresence>
      {busy && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          className="fixed bottom-16 right-3 z-50 sm:right-6"
          role="status"
          aria-live="polite"
        >
          <div className="glass flex items-center gap-3 rounded-2xl border border-[var(--neon)]/40 px-4 py-3 shadow-[0_8px_32px_oklch(0.72_0.19_315/0.18)]">
            {trendFirst ? (
              <Radar className="h-4 w-4 shrink-0 animate-pulse text-[var(--neon-2)]" aria-hidden />
            ) : (
              <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--neon)] opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--neon)]" />
              </span>
            )}
            <button
              onClick={() => setView(trendFirst ? "trends" : "planner")}
              className="focus-glow min-w-0 rounded-lg text-left"
              aria-label={trendFirst ? t("worker.trendTitle") : t("worker.title", { n: batchRuns.length })}
            >
              {trendFirst ? (
                <>
                  <p className="text-xs font-semibold leading-tight">{t("worker.trendLabel")}</p>
                  <p className="mt-0.5 max-w-44 truncate font-mono text-[11px] leading-tight text-muted-foreground">
                    {trendFirst.topic || t("worker.trendLabel")}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold leading-tight">{t("worker.label")}</p>
                  <p className="mt-0.5 font-mono text-[11px] leading-tight text-muted-foreground">
                    {done}/{total}
                    {first && (
                      <span className="text-[var(--neon)]">
                        {" "}
                        · {first.done}/{first.total}
                      </span>
                    )}
                  </p>
                </>
              )}
              {/* segmented mini progress for the first batch run */}
              {!trendFirst && first && (
                <div className="mt-1.5 flex gap-0.5" aria-hidden>
                  {Array.from({ length: Math.min(first.total, 12) }, (_, i) => (
                    <span
                      key={i}
                      className={`h-1 w-3 rounded-full transition-all ${
                        i < first.done
                          ? "bg-[var(--neon)] shadow-[0_0_5px_var(--neon)]"
                          : "bg-muted"
                      }`}
                    />
                  ))}
                </div>
              )}
            </button>
            <button
              onClick={togglePause}
              className="focus-glow rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("worker.pause")}
              title={t("worker.pause")}
            >
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
