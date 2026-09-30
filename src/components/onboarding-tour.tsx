"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/use-i18n";

const TOUR_KEY = "haydev-tour-done";
const TOUR_EVENT = "haydev:tour";

interface Step {
  /** CSS selector for the spotlight target; null = centered card */
  target: string | null;
  titleKey: string;
  textKey: string;
}

const STEPS: Step[] = [
  { target: null, titleKey: "tour.s1.title", textKey: "tour.s1.text" },
  { target: '[data-tour="nav"]', titleKey: "tour.s2.title", textKey: "tour.s2.text" },
  { target: '[data-tour="brand"]', titleKey: "tour.s3.title", textKey: "tour.s3.text" },
  { target: '[data-tour="mode"]', titleKey: "tour.s4.title", textKey: "tour.s4.text" },
  { target: '[data-tour="palette"]', titleKey: "tour.s5.title", textKey: "tour.s5.text" },
  { target: '[data-tour="sources"]', titleKey: "tour.s8.title", textKey: "tour.s8.text" },
  { target: null, titleKey: "tour.s6.title", textKey: "tour.s6.text" },
  { target: null, titleKey: "tour.s9.title", textKey: "tour.s9.text" },
  { target: null, titleKey: "tour.s7.title", textKey: "tour.s7.text" },
];

const PAD = 8;

/** true if the element exists and is actually on screen (excludes hidden mobile-only targets) */
function visibleRect(sel: string): DOMRect | null {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) return null;
  return r;
}

export function openOnboardingTour() {
  window.dispatchEvent(new CustomEvent(TOUR_EVENT));
}

export function OnboardingTour() {
  const { t } = useI18n();

  // auto-start once (first logged-in session) — lazy init, no effect setState
  const [autoStart] = useState(() => {
    try {
      return !localStorage.getItem(TOUR_KEY);
    } catch {
      return false;
    }
  });

  const [open, setOpen] = useState(autoStart);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // external replay trigger (footer button) — setState inside the event callback, not in effect body
  useEffect(() => {
    const onStart = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(TOUR_EVENT, onStart);
    return () => window.removeEventListener(TOUR_EVENT, onStart);
  }, []);

  const finish = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(TOUR_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  // measure target + keep in sync with viewport/scroll (ResizeObserver covers programmatic resizes)
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const s = STEPS[step];
      if (!s.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector(s.target);
      if (!el) {
        setRect(null);
        return;
      }
      // target exists but is scrolled out of view → bring it in; the scroll
      // listener below re-measures once the smooth scroll settles
      const r = el.getBoundingClientRect();
      if (r.top > window.innerHeight || r.bottom < 0) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      setRect(visibleRect(s.target));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      ro.disconnect();
    };
  }, [open, step]);

  // Escape skips
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight" || e.key === "Enter") {
        if (document.activeElement?.tagName !== "BUTTON" || e.key === "ArrowRight") {
          setStep((s) => (s + 1 < STEPS.length ? s + 1 : s));
          if (step + 1 >= STEPS.length) finish();
        }
      }
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish, step]);

  if (!open) return null;

  const s = STEPS[step];
  const spotlighted = rect !== null;
  const total = STEPS.length;

  // card position: near spotlight when targeting, centered otherwise
  let cardStyle: React.CSSProperties = {};
  if (rect) {
    const below = rect.bottom + 12;
    const cardH = 210;
    const fitsBelow = below + cardH < window.innerHeight - 12;
    const top = fitsBelow ? below : Math.max(12, rect.top - cardH - 12);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - 352);
    cardStyle = { top, left, width: 340 };
  }

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={t(s.titleKey)}>
      {/* dim backdrop (cut out by the spotlight's huge box-shadow) */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/60"
        onClick={finish}
        aria-hidden
      />

      {/* spotlight cut-out */}
      {spotlighted && (
        <motion.div
          key={`spot-${step}`}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1, left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="pointer-events-none absolute rounded-xl neon-border"
          style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.6), 0 0 28px oklch(0.72 0.19 315 / 45%)", border: "1px solid oklch(0.8 0.09 315 / 60%)" }}
          aria-hidden
        />
      )}

      {/* step card */}
      <AnimatePresence mode="wait">
        <motion.div
          ref={cardRef}
          key={step}
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.22 }}
          className={spotlighted ? "absolute glass-strong rounded-2xl p-5 neon-border" : "absolute left-1/2 top-1/2 w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 glass-strong rounded-2xl p-5 neon-border"}
          style={cardStyle}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--neon)]/15 px-2.5 py-1 text-[11px] font-medium text-[var(--neon)]">
              <Sparkles className="h-3 w-3" aria-hidden />
              {t("tour.stepOf", { n: step + 1, total })}
            </span>
            <button
              onClick={finish}
              className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label={t("tour.skip")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <h2 className="text-base font-semibold leading-snug">{t(s.titleKey)}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(s.textKey)}</p>

          {/* progress dots */}
          <div className="mt-4 flex items-center gap-1.5" role="tablist" aria-label={t("tour.stepOf", { n: step + 1, total })}>
            {STEPS.map((_, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === step}
                aria-label={`Step ${i + 1}`}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all ${i === step ? "w-5 bg-[var(--neon)] shadow-[0_0_8px_var(--neon)]" : i < step ? "w-1.5 bg-[var(--neon)]/60" : "w-1.5 bg-muted-foreground/40"}`}
              />
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" className="min-h-9" onClick={() => setStep((v) => Math.max(0, v - 1))} disabled={step === 0}>
              {t("tour.back")}
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="min-h-9 text-muted-foreground" onClick={finish}>
                {t("tour.skip")}
              </Button>
              {step + 1 < total ? (
                <Button size="sm" className="min-h-9 gap-1.5" onClick={() => setStep((v) => v + 1)} autoFocus>
                  {t("tour.next")}
                </Button>
              ) : (
                <Button size="sm" className="min-h-9 gap-1.5" onClick={finish} autoFocus>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  {t("tour.finish")}
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
