"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Wand2, Download, ScanEye, X, Loader2, Sparkles, ImagePlus, CheckCircle2,
} from "lucide-react";
import { useApp, pulseCore } from "@/lib/store";
import { useI18n, api } from "@/lib/use-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const RECENT_KEY = "haydev-image-recent";
const PROMPT_FROM_LIB_KEY = "haydev-prompt-to-studio";

interface CopilotResult {
  optimizedPrompt: string;
  whyChosen?: string;
  estimatedCost?: number;
  chosenProvider?: string;
  chosenModel?: string;
}
interface ImageGenResponse {
  jobId: string; assetId: string; url: string; provider: string; model: string; routedBecause?: string;
}
interface RecentGen { assetId: string; url: string; prompt: string; ts: number; }

// Mini ratio shapes: [ratio, width px, height px] — visual aspect selector
const ASPECTS: { id: string; w: number; h: number }[] = [
  { id: "1:1", w: 32, h: 32 },
  { id: "9:16", w: 18, h: 32 },
  { id: "3:4", w: 24, h: 32 },
  { id: "16:9", w: 56, h: 32 },
  { id: "4:3", w: 42, h: 32 },
];

export function showStudioError(t: (k: string, v?: Record<string, string | number>) => string, err: unknown) {
  const e = err as Error & { code?: string };
  if (e?.code === "DAILY_BUDGET_EXCEEDED" || e?.code === "MONTHLY_BUDGET_EXCEEDED") {
    toast.error(t("studio.err.budget", { code: e.code }), { description: e.message });
  } else {
    toast.error(t("studio.err.generic", { msg: e?.message ?? "unknown error" }));
  }
}

export function ImageStudioModule() {
  const { t } = useI18n();
  const activeBrandId = useApp((s) => s.activeBrandId);

  const [idea, setIdea] = useState("");
  const [finalPrompt, setFinalPrompt] = useState("");
  const [copilot, setCopilot] = useState<CopilotResult | null>(null);
  const [copiloting, setCopiloting] = useState(false);
  const [aspect, setAspect] = useState("1:1");
  const [refAsset, setRefAsset] = useState<RecentGen | null>(null);
  const [generating, setGenerating] = useState(false);
  const [lastResult, setLastResult] = useState<(ImageGenResponse & { prompt: string; ts: number }) | null>(null);
  const [recent, setRecent] = useState<RecentGen[]>([]);

  // Hydrate local state (library hand-off + persisted gallery)
  useEffect(() => {
    try {
      const fromLib = window.localStorage.getItem(PROMPT_FROM_LIB_KEY);
      if (fromLib) {
        setFinalPrompt(fromLib);
        window.localStorage.removeItem(PROMPT_FROM_LIB_KEY);
        toast.info(t("studio.img.promptLoaded"));
      }
      const raw = window.localStorage.getItem(RECENT_KEY);
      if (raw) setRecent(JSON.parse(raw) as RecentGen[]);
    } catch {
      /* corrupted storage — ignore */
    }
  }, []);

  const persistRecent = useCallback((list: RecentGen[]) => {
    setRecent(list);
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 24)));
    } catch {
      /* storage full — non-critical */
    }
  }, []);

  const enhance = async () => {
    if (!idea.trim()) {
      toast.warning(t("studio.img.needIdea"));
      return;
    }
    setCopiloting(true);
    try {
      const res = await api<CopilotResult>("/api/prompts/compile", {
        method: "POST",
        body: JSON.stringify({ idea, type: "IMAGE", aspectRatio: aspect }),
      });
      setCopilot(res);
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setCopiloting(false);
    }
  };

  const generate = async () => {
    if (!finalPrompt.trim()) {
      toast.warning(t("studio.img.needPrompt"));
      return;
    }
    setGenerating(true);
    setCopilot(null);
    pulseCore("GENERATING");
    try {
      const res = await api<ImageGenResponse>("/api/generate/image", {
        method: "POST",
        body: JSON.stringify({
          prompt: finalPrompt,
          aspectRatio: aspect,
          brandId: activeBrandId ?? undefined,
          refAssetId: refAsset?.assetId,
        }),
      });
      const entry = { ...res, prompt: finalPrompt, ts: Date.now() };
      setLastResult(entry);
      persistRecent([{ assetId: res.assetId, url: res.url, prompt: finalPrompt, ts: Date.now() }, ...recent]);
      pulseCore("SUCCESS");
      toast.success(t("common.success"));
    } catch (err) {
      pulseCore("ERROR");
      showStudioError(t, err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="grid gap-5">
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-strong neon-border rounded-2xl p-5 sm:p-6">
        <h1 className="text-xl font-semibold sm:text-2xl neon-text">{t("studio.img.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("studio.img.subtitle")}</p>
      </motion.section>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* composer */}
        <Card className="glass rounded-2xl lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wand2 className="h-4 w-4 text-[var(--neon)]" /> {t("studio.img.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            {/* idea + copilot */}
            <div className="grid gap-2">
              <Label htmlFor="img-idea">{t("studio.img.idea")}</Label>
              <Textarea
                id="img-idea"
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder={t("studio.img.ideaPh")}
                rows={3}
                className="resize-none"
              />
              <Button variant="outline" onClick={enhance} disabled={copiloting} className="min-h-11 justify-start gap-2 neon-border">
                {copiloting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-[var(--neon-3)]" />}
                {copiloting ? t("studio.copilot.working") : t("studio.img.enhance")}
              </Button>
            </div>

            {copilot && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-strong rounded-xl border border-[var(--neon-3)]/40 p-4 grid gap-3"
                role="region"
                aria-label={t("studio.copilot.title")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--neon-3)]">{t("studio.copilot.title")}</span>
                  {copilot.estimatedCost != null && (
                    <Badge variant="outline" className="text-[10px]">
                      {t("studio.copilot.cost")}: ${copilot.estimatedCost.toFixed(3)}
                    </Badge>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{copilot.optimizedPrompt}</p>
                {copilot.whyChosen && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">{t("studio.copilot.why")}:</span> {copilot.whyChosen}
                  </p>
                )}
                <Button size="sm" className="min-h-11 w-fit gap-2" onClick={() => { setFinalPrompt(copilot.optimizedPrompt); toast.success(t("studio.copilot.use")); }}>
                  <CheckCircle2 className="h-4 w-4" /> {t("studio.copilot.use")}
                </Button>
              </motion.div>
            )}

            {/* final prompt */}
            <div className="grid gap-2">
              <Label htmlFor="img-prompt">{t("studio.img.finalPrompt")}</Label>
              <Textarea
                id="img-prompt"
                value={finalPrompt}
                onChange={(e) => setFinalPrompt(e.target.value)}
                placeholder={t("studio.img.promptPh")}
                rows={4}
                className="resize-none font-mono text-[13px]"
              />
            </div>

            {/* aspect ratio visual selector */}
            <div className="grid gap-2">
              <Label>{t("studio.img.aspect")}</Label>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("studio.img.aspect")}>
                {ASPECTS.map((a) => (
                  <button
                    key={a.id}
                    role="radio"
                    aria-checked={aspect === a.id}
                    onClick={() => setAspect(a.id)}
                    className={`glass glass-hover flex min-h-11 min-w-11 flex-col items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs transition ${
                      aspect === a.id ? "neon-border neon-text" : "border border-border/60"
                    }`}
                  >
                    <span
                      className={`rounded-[4px] border-2 ${aspect === a.id ? "border-[var(--neon)] bg-[var(--neon)]/15" : "border-muted-foreground/50"}`}
                      style={{ width: a.w, height: a.h }}
                      aria-hidden
                    />
                    <span className="font-mono">{a.id}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* reference */}
            <div className="grid gap-2">
              <Label>{t("studio.img.reference")}</Label>
              {refAsset ? (
                <div className="flex items-center gap-3 rounded-xl border border-[var(--neon)]/40 bg-muted/20 p-2">
                  <img src={refAsset.url} alt={t("studio.img.reference")} className="h-14 w-14 rounded-lg border border-border/60 object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-muted-foreground">{refAsset.prompt}</p>
                    <p className="text-[11px] text-muted-foreground">{t("studio.img.refHint")}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={t("studio.img.refClear")} onClick={() => setRefAsset(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("studio.img.refHint")}</p>
              )}
            </div>

            <Button onClick={generate} disabled={generating} className="min-h-11 gap-2 text-sm font-semibold" size="lg">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              {generating ? t("studio.img.generating") : t("studio.img.generate")}
            </Button>
          </CardContent>
        </Card>

        {/* result */}
        <Card className="glass rounded-2xl lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("studio.img.result")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {generating ? (
              <Skeleton className="aspect-square w-full rounded-xl bg-muted/40" />
            ) : lastResult ? (
              <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="grid gap-3">
                <div className="neon-border overflow-hidden rounded-xl">
                  <img src={lastResult.url} alt={lastResult.prompt.slice(0, 80)} className="w-full object-cover" />
                </div>
                <div className="grid gap-1 text-xs text-muted-foreground">
                  <p><span className="font-medium text-foreground">{t("studio.img.metaProvider")}:</span> {lastResult.provider}</p>
                  <p><span className="font-medium text-foreground">{t("studio.img.metaModel")}:</span> {lastResult.model}</p>
                  {lastResult.routedBecause && <p className="line-clamp-2"><span className="font-medium text-foreground">{t("studio.img.metaRouting")}:</span> {lastResult.routedBecause}</p>}
                </div>
                <Button asChild variant="outline" className="min-h-11 gap-2">
                  <a href={lastResult.url} download={`haydev-image-${lastResult.assetId}.png`} target="_blank" rel="noreferrer">
                    <Download className="h-4 w-4" /> {t("studio.img.download")}
                  </a>
                </Button>
              </motion.div>
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 text-center">
                <ImagePlus className="h-8 w-8 text-muted-foreground/50" />
                <p className="px-4 text-xs text-muted-foreground">{t("studio.img.recentEmpty")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* recent gallery */}
      <Card className="glass rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("studio.img.recent")}</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("studio.img.recentEmpty")}</p>
          ) : (
            <div className="grid max-h-96 gap-3 overflow-y-auto scrollbar-thin sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((g) => (
                <motion.div
                  key={g.assetId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass glass-hover grid gap-2 rounded-xl p-3"
                >
                  <img src={g.url} alt={g.prompt.slice(0, 60)} className="h-40 w-full rounded-lg border border-border/60 object-cover" />
                  <p className="line-clamp-2 text-xs text-muted-foreground">{g.prompt}</p>
                  <p className="text-[10px] text-muted-foreground">{new Date(g.ts).toLocaleString()}</p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 flex-1 gap-1.5 text-xs"
                      aria-label={t("studio.img.useAsRef")}
                      onClick={() => { setRefAsset(g); toast.success(t("studio.img.useAsRef")); }}
                    >
                      <ScanEye className="h-3.5 w-3.5 text-[var(--neon)]" /> {t("studio.img.useAsRef")}
                    </Button>
                    <Button asChild variant="ghost" size="sm" className="min-h-11 gap-1.5 text-xs" aria-label={t("studio.img.download")}>
                      <a href={g.url} download={`haydev-image-${g.assetId}.png`} target="_blank" rel="noreferrer">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
