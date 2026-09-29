"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Pause, Play } from "lucide-react";
import { useApp } from "@/lib/store";
import { useI18n, api } from "@/lib/use-i18n";
import {
  driveBatchJob,
  isActive,
  onBatchFinish,
  onBatchProgress,
  type BatchRun,
} from "@/lib/batch-worker";

interface JobDto {
  id: string;
  kind: string;
  status: string;
  inputJson: string | null;
  outputJson: string | null;
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

// ---- Global background batch worker (mounted once in the app shell) ----
// Polls the job feed every 10s; any in-flight CONTENT_BATCH job that nobody in this
// tab is driving gets auto-resumed — on ANY view, right after a reload, without the
// Planner being open. This closes the "the tab had to stay on the Planner" gap.
// Honest by design: pausing only stops PICKING UP jobs (a running loop finishes
// naturally), jobs are never deleted, and finish toasts are centralized here so the
// Planner and the chip never double-report.
export function BatchWorkerChip() {
  const { t } = useI18n();
  const setView = useApp((s) => s.setView);
  const [runs, setRuns] = useState<BatchRun[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const pollingRef = useRef(false);

  // local mirror of the shared claim registry
  useEffect(() => onBatchProgress(setRuns), []);

  // centralized finish toasts (single reporter for every driver in this tab)
  useEffect(
    () =>
      onBatchFinish((e) => {
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
        for (const j of jobList) {
          if (j.kind !== "CONTENT_BATCH") continue;
          if (!["QUEUED", "PROCESSING", "RETRYING"].includes(j.status)) continue;
          if (isActive(j.id)) continue;
          const inp = parseJson<{ planId?: string; indexes?: number[] }>(j.inputJson, {});
          const out = parseJson<{ done?: number }>(j.outputJson, {});
          if (!inp.planId) continue;
          // auto-resume: fire-and-forget — driveBatchJob registers in the shared registry,
          // progress/finish events flow to every mounted surface (planner card + this chip)
          void driveBatchJob({
            jobId: j.id,
            planId: inp.planId,
            done: typeof out.done === "number" ? out.done : 0,
            total: Array.isArray(inp.indexes) ? inp.indexes.length : 0,
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
  const done = runs.reduce((s, r) => s + r.done, 0);
  const total = runs.reduce((s, r) => s + r.total, 0);
  const first = runs[0];

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
            <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--neon)] opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--neon)]" />
            </span>
            <button
              onClick={() => setView("planner")}
              className="focus-glow min-w-0 rounded-lg text-left"
              aria-label={t("worker.title", { n: runs.length })}
            >
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
              {/* segmented mini progress for the first run */}
              {first && (
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
