"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useApp, pulseCore } from "@/lib/store";
import { useI18n, api } from "@/lib/use-i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Flame, Search, Loader2, ExternalLink, Sparkles, ShieldAlert, Copy, Radar,
  ChevronDown, ChevronUp, Gauge, Globe2, Activity, FilePlus2, Quote, Wifi,
  Instagram, Facebook, Send, Music2, Eye, ShieldCheck, X, Landmark, Users,
  Layers, Lightbulb, Target, AlertTriangle, CalendarClock,
} from "lucide-react";
import { driveJob, onBatchFinish, onBatchProgress, type JobRun } from "@/lib/batch-worker";

// ---------- types ----------
interface EvidenceQuote { quote: string; source: string; observedAt: string }
interface TrendSource { name: string; url: string; snippet: string; host: string; date: string | null }
interface TrendDto {
  id: string;
  title: string;
  summary: string | null;
  sourceName: string;
  sourceUrl: string;
  platform: string | null;
  region: string | null;
  country: string | null;
  language: string | null;
  status: string; // VERIFIED_TREND | POPULAR_TOPIC | EMERGING_SIGNAL | CONTENT_OPPORTUNITY | HYPOTHESIS
  confidence: number;
  relevanceScore: number | null;
  freshnessScore: number | null;
  sourceType: string | null;
  sourcePublishedAt: string | null;
  discoveredAt: string;
  category: string | null;
  keywords: string[];
  hashtags: string[];
  brandFitScore: number | null;
  brandFitReason: string | null;
  suggestedAdaptation: string | null;
  risk: string | null;
  concept: string | null;
  hook: string | null;
  script: string | null;
  audience: string | null;
  waysToUse: string[];
  evidence?: EvidenceQuote[];
  metricsObserved?: string | null;
  createdAt: string;
}
interface AdaptationDto {
  id: string;
  trendId: string;
  platform: string;
  contentType: string;
  audience: string | null;
  hook: string | null;
  angle: string | null;
  concept: string | null;
  cta: string | null;
  creativeBrief: string | null;
  scriptOutline: string | null;
  visualDirection: string | null;
  captionIdea: string | null;
  recommendedPlatform: string | null;
  generationPrompt: string | null;
  generationProvider: string | null;
  templateId: string | null;
  language: string | null;
  status: string;
  createdAt: string;
}
interface ProviderCaps { id: string; label: string; configured: boolean; statusNote?: string; supportsRecency: boolean; maxResults: number }
interface TemplateLite { id: string; title: string; type: string }
interface BrandLite { id: string; name: string }

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const STATUS_STYLE: Record<string, { color: string; dashed?: boolean }> = {
  VERIFIED_TREND: { color: "var(--neon-2)" },
  POPULAR_TOPIC: { color: "var(--neon-3)" },
  EMERGING_SIGNAL: { color: "var(--neon)" },
  CONTENT_OPPORTUNITY: { color: "var(--neon)", dashed: true },
  HYPOTHESIS: { color: "var(--muted-foreground)" },
};
const STATUSES = ["VERIFIED_TREND", "POPULAR_TOPIC", "EMERGING_SIGNAL", "CONTENT_OPPORTUNITY", "HYPOTHESIS"] as const;

const PLATFORM_ICON: Record<string, typeof Instagram> = {
  instagram: Instagram,
  tiktok: Music2,
  facebook: Facebook,
  telegram: Send,
  web: Globe2,
  multi: Layers,
};

function relTime(iso: string, tag: string): string {
  try {
    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
    const diffMs = new Date(iso).getTime() - Date.now();
    const mins = Math.round(diffMs / 60_000);
    if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
    const hours = Math.round(mins / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
    return rtf.format(Math.round(hours / 24), "day");
  } catch {
    return "";
  }
}

// ---------- Signal Radar header (canvas, GPU-light, reduced-motion aware) ----------
function SignalRadar({ trends }: { trends: TrendDto[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let angle = -Math.PI / 2;
    let disposed = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };
    resize();

    // deterministic blip positions from trend ids
    const blips = trends.slice(0, 12).map((tr, i) => {
      let h = 0;
      for (const c of tr.id) h = (h * 31 + c.charCodeAt(0)) % 360;
      return {
        angle: ((h / 360) * Math.PI * 2),
        radius: 0.25 + ((h * 7 + i * 53) % 60) / 100,
        color:
          tr.status === "VERIFIED_TREND" ? "var(--neon-2)" :
          tr.status === "POPULAR_TOPIC" ? "var(--neon-3)" :
          tr.status === "HYPOTHESIS" ? "var(--muted-foreground)" : "var(--neon)",
        strong: tr.status === "VERIFIED_TREND" || tr.status === "POPULAR_TOPIC",
      };
    });

    const drawStatic = () => {
      const w = canvas.width, h = canvas.height;
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 6 * dpr;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "oklch(0.72 0.14 315 / 0.25)";
      ctx.lineWidth = 1 * dpr;
      for (const f of [1, 0.66, 0.33]) {
        ctx.beginPath();
        ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
      ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
      ctx.stroke();
      // sweep
      const grad = ctx.createConicGradient?.(angle, cx, cy);
      if (grad) {
        grad.addColorStop(0, "oklch(0.72 0.19 315 / 0.35)");
        grad.addColorStop(0.12, "oklch(0.72 0.19 315 / 0.0)");
        grad.addColorStop(1, "oklch(0.72 0.19 315 / 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fill();
      }
      // blips
      for (const b of blips) {
        const bx = cx + Math.cos(b.angle) * R * b.radius;
        const by = cy + Math.sin(b.angle) * R * b.radius;
        const rgb = b.color === "var(--neon-2)" ? "oklch(0.78 0.17 165" : b.color === "var(--neon-3)" ? "oklch(0.75 0.15 220" : b.color === "var(--muted-foreground)" ? "oklch(0.6 0.02 260" : "oklch(0.72 0.19 315";
        ctx.fillStyle = `${rgb} / ${b.strong ? 0.95 : 0.55})`;
        ctx.beginPath();
        ctx.arc(bx, by, (b.strong ? 3.2 : 2.2) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (reduced) {
      drawStatic();
      const onResize = () => { resize(); drawStatic(); };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    let last = 0;
    const loop = (ts: number) => {
      if (disposed) return;
      if (ts - last > 66) {
        // ~15fps — radar sweep needs to feel alive, not melt the GPU
        last = ts;
        angle += 0.045;
        drawStatic();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [trends, reduced]);

  return (
    <div className="relative overflow-hidden rounded-2xl" aria-hidden="true">
      <canvas ref={canvasRef} className="h-36 w-full sm:h-44" />
      <div className="pointer-events-none absolute inset-0 flex items-end justify-between p-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">signal radar</span>
        <span className="font-mono text-[10px] text-[var(--neon)]">{trends.length}</span>
      </div>
    </div>
  );
}

// ---------- module ----------
export function TrendsModule() {
  const { t, locale, locales, localeLabels } = useI18n();
  const localeTag = locale === "hy" ? "hy-AM" : locale;
  const activeBrandId = useApp((s) => s.activeBrandId);
  const setView = useApp((s) => s.setView);
  const setContentSeed = useApp((s) => s.setContentSeed);

  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [pickedBrandId, setPickedBrandId] = useState<string | null>(null);
  const brandId = pickedBrandId ?? activeBrandId ?? "none";
  const [topic, setTopic] = useState("");
  const [market, setMarket] = useState("");
  const [language, setLanguage] = useState<string>(locale);
  const [platform, setPlatform] = useState("multi");
  const [recencyDays, setRecencyDays] = useState("14");
  const [objective, setObjective] = useState("engagement");

  const [trends, setTrends] = useState<TrendDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobRun, setJobRun] = useState<JobRun | null>(null); // active TREND_SEARCH
  const [lastStats, setLastStats] = useState<{ sources: number; dupes: number; fallback: boolean } | null>(null);
  const [adaptingId, setAdaptingId] = useState<string | null>(null);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [adaptations, setAdaptations] = useState<Record<string, AdaptationDto[]>>({});
  const [templates, setTemplates] = useState<TemplateLite[]>([]);
  const [templatePick, setTemplatePick] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<TrendSource[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderCaps[]>([]);

  useEffect(() => setLanguage(locale), [locale]);

  const loadTrends = useCallback(async () => {
    const list = await api<TrendDto[]>("/api/trends");
    setTrends(list);
  }, []);

  const loadInitial = useCallback(async () => {
    try {
      const [trendList, brandList, providerList] = await Promise.all([
        api<TrendDto[]>("/api/trends"),
        api<BrandLite[]>("/api/brands"),
        api<ProviderCaps[]>("/api/trends/providers"),
      ]);
      setTrends(trendList);
      setBrands(brandList);
      setProviders(providerList);
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // template list for "Use template" (lazy, top favorites only)
  useEffect(() => {
    let dead = false;
    api<{ templates: TemplateLite[] }>("/api/prompts?favorite=1")
      .then((r) => { if (!dead) setTemplates((r.templates ?? []).slice(0, 12)); })
      .catch(() => { /* library optional */ });
    return () => { dead = true; };
  }, []);

  const refreshAfterSearch = useCallback(async (jobId: string) => {
    try {
      await loadTrends();
      const job = await api<{ outputJson: string | null; status: string }>(`/api/jobs/${jobId}`);
      const out = (() => { try { return job.outputJson ? JSON.parse(job.outputJson) as Record<string, unknown> : {}; } catch { return {}; } })();
      setLastStats({
        sources: typeof out.sourcesCount === "number" ? out.sourcesCount : 0,
        dupes: typeof out.duplicates === "number" ? out.duplicates : 0,
        fallback: Boolean(out.searchFallback),
      });
      if (Array.isArray(out.sources)) {
        setSources((out.sources as TrendSource[]).slice(0, 12));
        setSourcesOpen(true);
      }
    } catch { /* honest silent refresh failure — feed still renders */ }
  }, [loadTrends]);

  // central finish events: refresh the feed when a TREND_SEARCH completes
  useEffect(
    () =>
      onBatchFinish((e) => {
        if (e.run.kind !== "TREND_SEARCH") return;
        setJobRun((cur) => (cur && cur.jobId === e.run.jobId ? null : cur));
        if (e.kind === "COMPLETED") void refreshAfterSearch(e.run.jobId);
      }),
    [refreshAfterSearch],
  );
  useEffect(() => onBatchProgress((runs) => {
    const tr = runs.find((r) => r.kind === "TREND_SEARCH");
    setJobRun(tr ?? null);
  }), []);

  const search = async () => {
    if (jobRun) return;
    pulseCore("TREND_SEARCH");
    try {
      const res = await api<{ jobId: string; deduplicated: boolean; status: string }>("/api/trends", {
        method: "POST",
        body: JSON.stringify({
          brandId: brandId === "none" ? undefined : brandId,
          topic: topic.trim() || undefined,
          market: market.trim() || undefined,
          language,
          platform,
          recencyDays: Number(recencyDays),
          objective,
        }),
      });
      pulseCore("SUCCESS");
      if (res.deduplicated) toast.info(t("trends.jobDedup"));
      const run: JobRun = { jobId: res.jobId, kind: "TREND_SEARCH", topic: topic.trim() || t("trends.title"), done: 0, total: 0, stage: "SEARCHING" };
      setJobRun(run);
      void driveJob(run); // this view drives it; the global chip co-drives/resumes transparently
    } catch (e) {
      pulseCore("ERROR");
      toast.error(errMessage(e));
    }
  };

  const cancelSearch = async () => {
    if (!jobRun) return;
    try {
      await api(`/api/jobs/${jobRun.jobId}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) });
      setJobRun(null);
    } catch (e) {
      toast.error(errMessage(e));
    }
  };

  // structured adaptation of a trend to the picked business
  const adapt = async (trend: TrendDto) => {
    setAdaptingId(trend.id);
    pulseCore("GENERATING");
    try {
      const res = await api<{ adaptation: AdaptationDto }>(`/api/trends/${trend.id}/adapt`, {
        method: "POST",
        body: JSON.stringify({
          brandId: brandId === "none" ? undefined : brandId,
          language,
          platform: trend.platform && trend.platform !== "web" ? trend.platform : "instagram",
          objective,
          templateId: templatePick[trend.id] || undefined,
        }),
      });
      setAdaptations((prev) => ({ ...prev, [trend.id]: [res.adaptation, ...(prev[trend.id] ?? [])] }));
      setExpanded((prev) => ({ ...prev, [trend.id]: true }));
      pulseCore("SUCCESS");
      toast.success(t("trends.adapted"));
    } catch (e) {
      pulseCore("ERROR");
      toast.error(errMessage(e));
    } finally {
      setAdaptingId(null);
    }
  };

  const loadAdaptations = async (trendId: string) => {
    if (adaptations[trendId]) return;
    try {
      const list = await api<AdaptationDto[]>(`/api/trends/${trendId}/adaptations`);
      setAdaptations((prev) => ({ ...prev, [trendId]: list }));
    } catch { /* honest: panel just renders empty */ }
  };

  const toggleDetails = async (tr: TrendDto) => {
    const next = !expanded[tr.id];
    setExpanded((p) => ({ ...p, [tr.id]: next }));
    if (next) await loadAdaptations(tr.id);
  };

  // Trend → Draft: structured adaptation seeds the whole draft (existing pipeline)
  const draftFromAdaptation = async (tr: TrendDto, ad: AdaptationDto) => {
    const targetBrandId = brandId !== "none" ? brandId : activeBrandId ?? brands[0]?.id;
    if (!targetBrandId) {
      toast.error(t("trends.needBrand"));
      return;
    }
    setDraftingId(tr.id);
    pulseCore("GENERATING");
    try {
      const item = await api<{ id: string }>("/api/content", {
        method: "POST",
        body: JSON.stringify({
          brandId: targetBrandId,
          title: tr.title,
          platform: ad.platform || "instagram",
          language: ad.language || language,
          contentType: ad.contentType || "IMAGE_POST",
          adaptationId: ad.id,
          trendId: tr.id,
        }),
      });
      pulseCore("SUCCESS");
      toast.success(t("trends.toDraftDone"));
      setContentSeed(item.id);
      setView("content");
    } catch (e) {
      pulseCore("ERROR");
      toast.error(errMessage(e));
    } finally {
      setDraftingId(null);
    }
  };

  // legacy single-click draft straight from the trend (AI writes from brief)
  const draftFromTrend = async (tr: TrendDto) => {
    const targetBrandId = brandId !== "none" ? brandId : activeBrandId ?? brands[0]?.id;
    if (!targetBrandId) {
      toast.error(t("trends.needBrand"));
      return;
    }
    setDraftingId(tr.id);
    pulseCore("GENERATING");
    try {
      const item = await api<{ id: string }>("/api/content", {
        method: "POST",
        body: JSON.stringify({
          brandId: targetBrandId,
          title: tr.title,
          platform: tr.platform && tr.platform !== "web" ? tr.platform : "instagram",
          language,
          contentType: tr.platform === "tiktok" ? "VIDEO_REEL" : "IMAGE_POST",
          aiWrite: true,
          brief: tr.suggestedAdaptation ?? tr.summary ?? tr.title,
          linkTrend: tr.sourceUrl,
          trendId: tr.id,
        }),
      });
      pulseCore("SUCCESS");
      toast.success(t("trends.toDraftDone"));
      setContentSeed(item.id);
      setView("content");
    } catch (e) {
      pulseCore("ERROR");
      toast.error(errMessage(e));
    } finally {
      setDraftingId(null);
    }
  };

  const dismiss = async (tr: TrendDto) => {
    try {
      await api(`/api/trends/${tr.id}`, { method: "DELETE" });
      setTrends((prev) => prev.filter((x) => x.id !== tr.id));
      toast.success(t("trends.dismissed"));
    } catch (e) {
      toast.error(errMessage(e));
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("common.copied"));
    } catch {
      toast.error(t("common.error"));
    }
  };

  const hostOf = (url: string) => {
    try { return new URL(url).host; } catch { return url; }
  };

  const hasAdaptation = (tr: TrendDto) => Boolean(adaptations[tr.id]?.length || tr.concept || tr.hook);

  const PlatformIcon = ({ p, className }: { p: string | null; className?: string }) => {
    const Icon = PLATFORM_ICON[p ?? "web"] ?? Globe2;
    return <Icon className={className ?? "h-3.5 w-3.5"} aria-hidden="true" />;
  };

  const ScoreBar = ({ label, value, color }: { label: string; value: number | null; color: string }) => (
    <div className="grid min-w-0 gap-1">
      <div className="flex items-center justify-between gap-1 text-[10px] leading-none">
        <span className="min-w-0 truncate text-muted-foreground" title={label}>{label}</span>
        <span className="shrink-0 whitespace-nowrap font-mono font-semibold" style={{ color }}>{value != null ? `${Math.round(value * 100)}%` : "—"}</span>
      </div>
      <Progress value={value != null ? Math.round(value * 100) : 0} className="h-1" aria-label={label} />
    </div>
  );

  return (
    <div className="grid gap-5">
      {/* header + signal radar */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{t("trends.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("trends.subtitle")}</p>
        </div>
        <Card className="glass overflow-hidden rounded-2xl">
          <CardContent className="p-0">
            <SignalRadar trends={trends} />
          </CardContent>
        </Card>
      </motion.section>

      {/* honest provider status strip */}
      <section aria-label={t("trends.providers")} className="flex flex-wrap items-center gap-2">
        {providers.map((p) => (
          <span
            key={p.id}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]"
            style={{
              borderColor: p.configured ? "color-mix(in oklab, var(--neon-2) 40%, transparent)" : "color-mix(in oklab, var(--muted-foreground) 35%, transparent)",
              background: p.configured ? "color-mix(in oklab, var(--neon-2) 10%, transparent)" : "transparent",
            }}
            title={p.statusNote ?? p.label}
          >
            {p.configured ? <Wifi className="h-3 w-3 text-[var(--neon-2)]" /> : <ShieldAlert className="h-3 w-3 text-muted-foreground" />}
            {p.label}
            <span className="text-muted-foreground">· {p.configured ? t("trends.providerLive") : t("trends.providerOff")}</span>
          </span>
        ))}
      </section>

      {/* search form */}
      <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} aria-label={t("trends.searchTitle")}>
        <Card className="glass rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radar className="h-4 w-4 text-[var(--neon-3)]" /> {t("trends.searchTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              onSubmit={(e) => { e.preventDefault(); if (!jobRun && !loading) search(); }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="tr-brand">{t("trends.brand")}</Label>
                <Select value={brandId} onValueChange={setPickedBrandId}>
                  <SelectTrigger id="tr-brand" className="h-11">
                    <SelectValue placeholder={t("trends.brandAny")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("trends.brandAny")}</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tr-topic">{t("trends.niche")}</Label>
                <Input id="tr-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("trends.nichePlaceholder")} className="h-11" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tr-market">{t("trends.region")}</Label>
                <Input id="tr-market" value={market} onChange={(e) => setMarket(e.target.value)} placeholder={t("trends.regionPlaceholder")} className="h-11" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tr-lang">{t("trends.language")}</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger id="tr-lang" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {locales.map((l) => (
                      <SelectItem key={l} value={l}>{localeLabels[l]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tr-platform">{t("trends.platform")}</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger id="tr-platform" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="multi">{t("trends.platformMulti")}</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="tiktok">TikTok</SelectItem>
                    <SelectItem value="facebook">Facebook</SelectItem>
                    <SelectItem value="telegram">Telegram</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tr-window">{t("trends.window")}</Label>
                <Select value={recencyDays} onValueChange={setRecencyDays}>
                  <SelectTrigger id="tr-window" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">{t("trends.window7")}</SelectItem>
                    <SelectItem value="14">{t("trends.window14")}</SelectItem>
                    <SelectItem value="30">{t("trends.window30")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tr-objective">{t("trends.objective")}</Label>
                <Select value={objective} onValueChange={setObjective}>
                  <SelectTrigger id="tr-objective" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="awareness">{t("trends.objAwareness")}</SelectItem>
                    <SelectItem value="engagement">{t("trends.objEngagement")}</SelectItem>
                    <SelectItem value="conversion">{t("trends.objConversion")}</SelectItem>
                    <SelectItem value="education">{t("trends.objEducation")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 lg:col-span-1">
                <Button type="submit" className="h-11 w-full gap-2 neon-border" disabled={Boolean(jobRun)} aria-label={t("trends.search")}>
                  {jobRun ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {jobRun ? t("trends.searching") : t("trends.search")}
                </Button>
                {jobRun && (
                  <Button type="button" variant="outline" className="h-11 gap-1.5" onClick={cancelSearch} aria-label={t("trends.cancelSearch")}>
                    <X className="h-4 w-4" /> <span className="hidden xl:inline">{t("trends.cancelSearch")}</span>
                  </Button>
                )}
              </div>
            </form>
            {jobRun && (
              <div className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--neon) 35%, transparent)" }} role="status" aria-live="polite">
                <span className="relative flex h-2.5 w-2.5" aria-hidden>
                  <span className="absolute h-full w-full animate-ping rounded-full bg-[var(--neon)] opacity-60" />
                  <span className="relative h-2.5 w-2.5 rounded-full bg-[var(--neon)]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t("trends.searchRunning")}</p>
                  <p className="text-xs text-muted-foreground">{t("trends.searchHint")}</p>
                </div>
              </div>
            )}
            {lastStats && !jobRun && (
              <p className="text-xs text-muted-foreground" role="note">
                <Activity className="mr-1 inline h-3 w-3 text-[var(--neon-3)]" aria-hidden />
                {t("trends.lastRun", { sources: lastStats.sources, dupes: lastStats.dupes })}
              </p>
            )}
          </CardContent>
        </Card>
      </motion.section>

      {/* real sources backing the latest Trend Agent run */}
      {sources.length > 0 && (
        <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} aria-label={t("trends.sourcesTitle")}>
          <Card className="glass rounded-2xl">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="rounded-lg p-1.5" style={{ background: "color-mix(in oklab, var(--neon-2) 15%, transparent)" }}>
                    <Globe2 className="h-4 w-4 text-[var(--neon-2)]" />
                  </span>
                  {t("trends.sourcesTitle")}
                  <Badge variant="outline" className="text-[10px]" aria-label={String(sources.length)}>{sources.length}</Badge>
                </CardTitle>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setSourcesOpen((o) => !o)} aria-expanded={sourcesOpen} aria-label={t("trends.sourcesTitle")}>
                  {sourcesOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("trends.sourcesHint")}</p>
            </CardHeader>
            {sourcesOpen && (
              <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {sources.map((s, i) => (
                  <motion.a
                    key={`${s.url}-${i}`}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.25) }}
                    className="source-card group/source"
                    aria-label={`${s.host || "web"}: ${s.name}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="rank-chip" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold">{s.host || s.name}</span>
                      {s.date && <span className="shrink-0 text-[10px] text-muted-foreground">{s.date}</span>}
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/source:opacity-100" aria-hidden="true" />
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{s.name}</p>
                  </motion.a>
                ))}
              </CardContent>
            )}
          </Card>
        </motion.section>
      )}

      {/* trend feed */}
      <section aria-label={t("trends.feed")} className="grid gap-4">
        <h2 className="flex items-center gap-2 text-sm font-medium tracking-wide text-muted-foreground">
          <Flame className="h-4 w-4 text-[var(--neon)]" /> {t("trends.feed")}
        </h2>

        {lastStats?.fallback && (
          <div role="status" className="flex items-start gap-2 rounded-xl border p-3 text-[13px] leading-relaxed"
            style={{ borderColor: "color-mix(in oklab, var(--neon-3) 35%, transparent)", background: "color-mix(in oklab, var(--neon-3) 8%, transparent)" }}>
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--neon-3)]" aria-hidden="true" />
            <span>{t("trends.fallbackNotice")}</span>
          </div>
        )}

        {loading ? (
          [...Array(3)].map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl bg-muted/40" />)
        ) : trends.length === 0 ? (
          <Card className="glass rounded-2xl">
            <CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
              <span className="rounded-2xl p-3" style={{ background: "color-mix(in oklab, var(--neon-3) 15%, transparent)" }}>
                <Flame className="h-7 w-7 text-[var(--neon-3)]" />
              </span>
              <p className="text-sm text-muted-foreground">{t("trends.noTrends")}</p>
            </CardContent>
          </Card>
        ) : (
          trends.map((tr, i) => {
            const statusStyle = STATUS_STYLE[tr.status] ?? STATUS_STYLE.HYPOTHESIS;
            const isOpen = Boolean(expanded[tr.id]);
            const adapted = hasAdaptation(tr);
            const trendAdaptations = adaptations[tr.id] ?? [];
            return (
              <motion.article key={tr.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.2) }}>
                <Card className="glass glass-hover rounded-2xl">
                  <CardContent className="grid gap-3 p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="flex min-w-0 flex-1 items-start gap-2 text-sm font-semibold leading-snug sm:text-base">
                        <PlatformIcon p={tr.platform} className="mt-0.5 h-4 w-4 shrink-0 text-[var(--neon-3)]" />
                        {tr.title}
                      </h3>
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-[10px] ${statusStyle.dashed ? "border-dashed" : ""}`}
                        style={{
                          color: statusStyle.color,
                          borderColor: `color-mix(in oklab, ${statusStyle.color} 45%, transparent)`,
                          background: `color-mix(in oklab, ${statusStyle.color} 12%, transparent)`,
                        }}
                      >
                        {t(`trends.status.${STATUSES.includes(tr.status as (typeof STATUSES)[number]) ? tr.status : "HYPOTHESIS"}` as const)}
                      </Badge>
                    </div>

                    {tr.summary && <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{tr.summary}</p>}

                    {/* meta chips */}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {tr.platform && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 font-medium">
                          <PlatformIcon p={tr.platform} /> {tr.platform}
                        </span>
                      )}
                      {(tr.country || tr.region) && (
                        <span className="inline-flex items-center gap-1"><Landmark className="h-3 w-3" aria-hidden /> {tr.country ?? tr.region}</span>
                      )}
                      {tr.language && <span className="uppercase">{tr.language}</span>}
                      {tr.category && <span className="rounded-md border border-border/60 bg-muted/30 px-2 py-0.5">{tr.category}</span>}
                      <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" aria-hidden /> {relTime(tr.discoveredAt, localeTag)}</span>
                      {tr.metricsObserved && (
                        <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5" title={tr.metricsObserved}>
                          <Activity className="h-3 w-3 shrink-0 text-[var(--neon-3)]" aria-hidden="true" />
                          <span className="max-w-48 truncate font-medium text-[var(--neon-3)]">{tr.metricsObserved}</span>
                        </span>
                      )}
                    </div>

                    {/* scores: relevance / freshness / confidence */}
                    <div className="grid grid-cols-3 gap-3">
                      <ScoreBar label={t("trends.relevance")} value={tr.relevanceScore} color="var(--neon)" />
                      <ScoreBar label={t("trends.freshness")} value={tr.freshnessScore} color="var(--neon-3)" />
                      <ScoreBar label={t("trends.confidence")} value={tr.confidence} color="var(--neon-2)" />
                    </div>

                    {/* keywords + hashtags */}
                    {(tr.keywords.length > 0 || tr.hashtags.length > 0) && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {tr.keywords.slice(0, 5).map((k) => (
                          <span key={`kw-${k}`} className="rounded-full bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">{k}</span>
                        ))}
                        {tr.hashtags.slice(0, 4).map((h) => (
                          <span key={`tag-${h}`} className="rounded-full px-2 py-0.5 text-[10px] text-[var(--neon)]" style={{ background: "color-mix(in oklab, var(--neon) 10%, transparent)" }}>#{h}</span>
                        ))}
                      </div>
                    )}

                    {/* first evidence quote */}
                    {tr.evidence && tr.evidence.length > 0 && (
                      <blockquote className="quote-accent">
                        <p className="line-clamp-2 text-[13px] leading-relaxed">{tr.evidence[0].quote}</p>
                        {tr.evidence[0].source && (
                          <a href={tr.evidence[0].source} target="_blank" rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-[var(--neon-2)] hover:underline">
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            {hostOf(tr.evidence[0].source)}
                          </a>
                        )}
                      </blockquote>
                    )}

                    {tr.risk && (
                      <div className="flex items-start gap-2 rounded-xl border p-3 text-[13px] leading-relaxed"
                        style={{ borderColor: "color-mix(in oklab, var(--neon-3) 35%, transparent)", background: "color-mix(in oklab, var(--neon-3) 8%, transparent)" }}
                        role="alert">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--neon-3)]" />
                        <span><span className="font-semibold text-[var(--neon-3)]">{t("trends.risk")}:</span> {tr.risk}</span>
                      </div>
                    )}

                    {/* actions */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => toggleDetails(tr)} aria-expanded={isOpen} aria-label={t("trends.details")}>
                          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          {t("trends.details")}
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" className="h-9 gap-1.5 sm:h-10" onClick={() => dismiss(tr)} aria-label={t("trends.dismiss")}>
                          <X className="h-4 w-4" />
                          <span className="hidden sm:inline">{t("trends.dismiss")}</span>
                        </Button>
                        <Button variant="outline" size="sm" className="h-9 gap-1.5 sm:h-10" onClick={() => draftFromTrend(tr)} disabled={draftingId === tr.id} aria-label={t("trends.toDraft")}>
                          {draftingId === tr.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
                          <span className="hidden sm:inline">{t("trends.toDraft")}</span>
                        </Button>
                        <Button variant="outline" size="sm" className="h-9 gap-1.5 neon-border sm:h-10" onClick={() => adapt(tr)} disabled={adaptingId === tr.id} aria-label={t("trends.adapt")}>
                          {adaptingId === tr.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                          {adaptingId === tr.id ? t("trends.adapting") : t("trends.adapt")}
                        </Button>
                      </div>
                    </div>

                    {/* details panel */}
                    {isOpen && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="grid gap-4 overflow-hidden rounded-xl border border-border/60 bg-muted/20 p-4">
                        {/* SOURCE */}
                        <div className="grid gap-1.5">
                          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--neon-2)]">
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> {t("trends.dSource")}
                          </p>
                          {tr.sourceUrl ? (
                            <a href={tr.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] underline-offset-2 hover:text-[var(--neon-2)] hover:underline">
                              <span className="max-w-full truncate">{tr.sourceName || hostOf(tr.sourceUrl)}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                              <span className="text-[11px] text-muted-foreground">({hostOf(tr.sourceUrl)})</span>
                            </a>
                          ) : (
                            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                              <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> {t("trends.noSourceUrl")}
                            </p>
                          )}
                          {tr.sourceType && (
                            <p className="text-[11px] text-muted-foreground">
                              {t("trends.sourceType")}: <span className="font-mono">{tr.sourceType}</span>
                              {tr.sourcePublishedAt ? ` · ${relTime(tr.sourcePublishedAt, localeTag)}` : ""}
                            </p>
                          )}
                        </div>

                        {/* WHY IT MATTERS */}
                        <div className="grid gap-1.5">
                          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--neon)]">
                            <Lightbulb className="h-3.5 w-3.5" aria-hidden /> {t("trends.dWhy")}
                          </p>
                          <p className="text-[13px] leading-relaxed">{tr.summary ?? "—"}</p>
                          {tr.brandFitReason && (
                            <p className="text-[13px] leading-relaxed text-muted-foreground"><span className="font-medium text-[var(--neon-2)]">{t("trends.why")}:</span> {tr.brandFitReason}</p>
                          )}
                        </div>

                        {/* EVIDENCE */}
                        {tr.evidence && tr.evidence.length > 0 && (
                          <div className="grid gap-2">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--neon-2)]">
                              <Quote className="h-3.5 w-3.5" aria-hidden /> {t("trends.evidenceTitle")}
                            </p>
                            {tr.evidence.map((q, qi) => (
                              <blockquote key={qi} className="quote-accent">
                                <p className="text-[13px] leading-relaxed">{q.quote}</p>
                                {q.source && (
                                  <a href={q.source} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-[var(--neon-2)] hover:underline">
                                    <ExternalLink className="h-3 w-3" aria-hidden="true" />{hostOf(q.source)}
                                  </a>
                                )}
                              </blockquote>
                            ))}
                          </div>
                        )}

                        {/* AUDIENCE / PLATFORM / FRESHNESS / BUSINESS MATCH grid */}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="grid gap-1">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Users className="h-3.5 w-3.5" aria-hidden /> {t("trends.dAudience")}</p>
                            <p className="text-[13px]">{tr.audience ?? "—"}</p>
                          </div>
                          <div className="grid gap-1">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Gauge className="h-3.5 w-3.5" aria-hidden /> {t("trends.dBusinessMatch")}</p>
                            <p className="text-[13px]">
                              {tr.brandFitScore != null ? `${Math.round(tr.brandFitScore * 100)}%` : "—"}
                              {tr.brandFitReason ? ` — ${tr.brandFitReason.slice(0, 120)}` : ""}
                            </p>
                          </div>
                        </div>

                        {/* RISKS */}
                        {tr.risk && (
                          <div className="grid gap-1">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--neon-3)]"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {t("trends.dRisks")}</p>
                            <p className="text-[13px] leading-relaxed">{tr.risk}</p>
                          </div>
                        )}

                        {/* WAYS TO USE IT */}
                        {tr.waysToUse.length > 0 && (
                          <div className="grid gap-1.5">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--neon)]"><Target className="h-3.5 w-3.5" aria-hidden /> {t("trends.dWays")}</p>
                            <ul className="grid gap-1 pl-1">
                              {tr.waysToUse.map((w, wi) => (
                                <li key={wi} className="flex gap-2 text-[13px] leading-relaxed"><span className="text-[var(--neon)]">›</span>{w}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* suggested adaptation */}
                        {tr.suggestedAdaptation && (
                          <div className="rounded-xl border p-3 text-[13px] leading-relaxed"
                            style={{ borderColor: "color-mix(in oklab, var(--neon) 30%, transparent)", background: "color-mix(in oklab, var(--neon) 7%, transparent)" }}>
                            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--neon)]">
                              <Sparkles className="h-3.5 w-3.5" /> {t("trends.adaptation")}
                            </p>
                            {tr.suggestedAdaptation}
                          </div>
                        )}

                        {/* template picker (Prompt Library bridge) */}
                        {templates.length > 0 && !trendAdaptations.length && !adapted && (
                          <div className="grid gap-1.5">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--neon)]">
                              <Layers className="h-3.5 w-3.5" aria-hidden /> {t("trends.useTemplate")}
                            </p>
                            <Select value={templatePick[tr.id] ?? "none"} onValueChange={(v) => setTemplatePick((p) => ({ ...p, [tr.id]: v === "none" ? "" : v }))}>
                              <SelectTrigger className="h-9 w-full max-w-xs text-xs" aria-label={t("trends.useTemplate")}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">{t("trends.templateNone")}</SelectItem>
                                {templates.map((tpl) => (
                                  <SelectItem key={tpl.id} value={tpl.id}>
                                    {tpl.title.slice(0, 44)}{tpl.type ? ` · ${tpl.type}` : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-[11px] text-muted-foreground">{t("trends.templateNote")}</p>
                          </div>
                        )}

                        {/* structured adaptations */}
                        {(trendAdaptations.length > 0 || adapted) && (
                          <div className="grid gap-3 border-t border-border/60 pt-3">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--neon-2)]">
                              <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {t("trends.adaptedPanel")}
                            </p>
                            {trendAdaptations.map((ad) => (
                              <div key={ad.id} className="grid gap-2 rounded-xl border border-border/60 bg-background/40 p-3">
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                  <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 font-medium"><PlatformIcon p={ad.recommendedPlatform ?? ad.platform} />{ad.recommendedPlatform ?? ad.platform}</span>
                                  <span className="rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 font-mono">{ad.contentType}</span>
                                  {ad.status === "USED" && <Badge variant="outline" className="text-[10px] text-[var(--neon-2)]" style={{ borderColor: "color-mix(in oklab, var(--neon-2) 45%, transparent)" }}>{t("trends.adaptUsed")}</Badge>}
                                </div>
                                {([
                                  ["trends.hook", ad.hook],
                                  ["trends.angle", ad.angle],
                                  ["trends.concept", ad.concept],
                                  ["trends.scriptOutline", ad.scriptOutline],
                                  ["trends.visualDir", ad.visualDirection],
                                  ["trends.captionIdea", ad.captionIdea],
                                  ["trends.cta", ad.cta],
                                  ["trends.creativeBrief", ad.creativeBrief],
                                ] as const).map(([label, value]) =>
                                  value ? (
                                    <div key={label} className="grid gap-1">
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--neon)]">{t(label)}</p>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-[var(--neon)]" onClick={() => copyText(value)} aria-label={`${t("common.copied")}: ${t(label)}`}>
                                          <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                      <p className="whitespace-pre-wrap rounded-lg bg-background/40 p-2.5 text-[13px] leading-relaxed">{value}</p>
                                    </div>
                                  ) : null,
                                )}
                                {ad.generationPrompt && (
                                  <div className="grid gap-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--neon-3)]">
                                        <Eye className="h-3.5 w-3.5" aria-hidden /> {t("trends.genPrompt")} ({ad.generationProvider})
                                      </p>
                                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-[var(--neon-3)]" onClick={() => copyText(ad.generationPrompt!)} aria-label={t("trends.copyPrompt")}>
                                        <Copy className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                    <p className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-background/40 p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">{ad.generationPrompt}</p>
                                    <p className="text-[11px] text-muted-foreground">{t("trends.genPromptNote")}</p>
                                  </div>
                                )}
                                <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                                  <Button size="sm" className="h-9 gap-1.5" onClick={() => draftFromAdaptation(tr, ad)} disabled={draftingId === tr.id} aria-label={t("trends.toDraft")}>
                                    {draftingId === tr.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
                                    {t("trends.draftFromAdaptation")}
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </CardContent>
                </Card>
              </motion.article>
            );
          })
        )}
      </section>
    </div>
  );
}
