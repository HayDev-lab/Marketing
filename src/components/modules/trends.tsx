"use client";

import { useCallback, useEffect, useState } from "react";
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
  ChevronDown, ChevronUp, Gauge,
} from "lucide-react";

// ---------- types ----------
interface TrendDto {
  id: string;
  title: string;
  summary: string | null;
  sourceName: string;
  sourceUrl: string;
  platform: string | null;
  region: string | null;
  language: string | null;
  status: string; // VERIFIED_TREND | POPULAR_TOPIC | EMERGING_SIGNAL | HYPOTHESIS
  confidence: number;
  brandFitScore: number | null;
  brandFitReason: string | null;
  suggestedAdaptation: string | null;
  risk: string | null;
  concept: string | null;
  hook: string | null;
  script: string | null;
  createdAt: string;
}
interface BrandLite { id: string; name: string }

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const STATUS_STYLE: Record<string, { color: string }> = {
  VERIFIED_TREND: { color: "var(--neon-2)" },
  POPULAR_TOPIC: { color: "var(--neon-3)" },
  EMERGING_SIGNAL: { color: "var(--neon)" },
  HYPOTHESIS: { color: "var(--muted-foreground)" },
};
const STATUSES = ["VERIFIED_TREND", "POPULAR_TOPIC", "EMERGING_SIGNAL", "HYPOTHESIS"] as const;

export function TrendsModule() {
  const { t, locale, locales, localeLabels } = useI18n();
  const activeBrandId = useApp((s) => s.activeBrandId);

  const [brands, setBrands] = useState<BrandLite[]>([]);
  // null = no explicit choice yet → derive from the active brand (effect-free, always in sync)
  const [pickedBrandId, setPickedBrandId] = useState<string | null>(null);
  const brandId = pickedBrandId ?? activeBrandId ?? "none";
  const [niche, setNiche] = useState("");
  const [region, setRegion] = useState("");
  const [language, setLanguage] = useState<string>(locale);

  const [trends, setTrends] = useState<TrendDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [adaptingId, setAdaptingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // keep trend language in sync with UI locale
  useEffect(() => {
    setLanguage(locale);
  }, [locale]);

  const loadInitial = useCallback(async () => {
    try {
      const [trendList, brandList] = await Promise.all([
        api<TrendDto[]>("/api/trends"),
        api<BrandLite[]>("/api/brands"),
      ]);
      setTrends(trendList);
      setBrands(brandList);
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const search = async () => {
    setSearching(true);
    pulseCore("TREND_SEARCH");
    try {
      const res = await api<{ jobId: string; trends: TrendDto[]; sources: number }>("/api/trends", {
        method: "POST",
        body: JSON.stringify({
          brandId: brandId === "none" ? undefined : brandId,
          niche: niche.trim() || undefined,
          region: region.trim() || undefined,
          language,
        }),
      });
      pulseCore("SUCCESS");
      toast.success(t("trends.found", { count: res.trends.length }));
      setTrends((prev) => [...res.trends, ...prev]);
    } catch (e) {
      pulseCore("ERROR");
      toast.error(errMessage(e));
    } finally {
      setSearching(false);
    }
  };

  const adapt = async (trend: TrendDto) => {
    setAdaptingId(trend.id);
    pulseCore("GENERATING");
    try {
      const updated = await api<TrendDto>(`/api/trends/${trend.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "adapt", language }),
      });
      setTrends((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
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

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("common.copied"));
    } catch {
      toast.error(t("common.error"));
    }
  };

  const hasAdaptation = (tr: TrendDto) => Boolean(tr.concept || tr.hook || tr.script);

  return (
    <div className="grid gap-5">
      {/* header */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl font-semibold sm:text-2xl">{t("trends.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("trends.subtitle")}</p>
      </motion.section>

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
              onSubmit={(e) => { e.preventDefault(); if (!searching) search(); }}
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
                <Label htmlFor="tr-niche">{t("trends.niche")}</Label>
                <Input
                  id="tr-niche"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  placeholder={t("trends.nichePlaceholder")}
                  className="h-11"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tr-region">{t("trends.region")}</Label>
                <Input
                  id="tr-region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder={t("trends.regionPlaceholder")}
                  className="h-11"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tr-lang">{t("trends.language")}</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger id="tr-lang" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locales.map((l) => (
                      <SelectItem key={l} value={l}>{localeLabels[l]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-4">
                <Button type="submit" className="h-11 gap-2 neon-border" disabled={searching} aria-label={t("trends.search")}>
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {searching ? t("trends.searching") : t("trends.search")}
                </Button>
                <p className="text-xs text-muted-foreground" role="note">{t("trends.searchHint")}</p>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.section>

      {/* trend feed */}
      <section aria-label={t("trends.feed")} className="grid gap-4">
        <h2 className="flex items-center gap-2 text-sm font-medium tracking-wide text-muted-foreground">
          <Flame className="h-4 w-4 text-[var(--neon)]" /> {t("trends.feed")}
        </h2>

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
            const fitPct = Math.round((tr.brandFitScore ?? 0) * 100);
            const adapted = hasAdaptation(tr);
            const isOpen = Boolean(expanded[tr.id]);
            return (
              <motion.article
                key={tr.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.2) }}
              >
                <Card className="glass glass-hover rounded-2xl">
                  <CardContent className="grid gap-3 p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug sm:text-base">{tr.title}</h3>
                      <Badge
                        variant="outline"
                        className="shrink-0 text-[10px]"
                        style={{
                          color: statusStyle.color,
                          borderColor: `color-mix(in oklab, ${statusStyle.color} 45%, transparent)`,
                          background: `color-mix(in oklab, ${statusStyle.color} 12%, transparent)`,
                        }}
                      >
                        {t(`trends.status.${STATUSES.includes(tr.status as (typeof STATUSES)[number]) ? tr.status : "HYPOTHESIS"}` as const)}
                      </Badge>
                    </div>

                    {tr.summary && (
                      <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{tr.summary}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {tr.platform && (
                        <span className="rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 font-medium">{tr.platform}</span>
                      )}
                      {tr.region && <span>{tr.region}</span>}
                      <span className="inline-flex items-center gap-1">
                        <Gauge className="h-3 w-3" /> {t("trends.confidence")}: {Math.round(tr.confidence * 100)}%
                      </span>
                    </div>

                    {tr.brandFitScore != null && (
                      <div className="grid gap-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">{t("trends.brandFit")}</span>
                          <span className="font-semibold text-[var(--neon-2)]">{fitPct}%</span>
                        </div>
                        <Progress value={fitPct} className="h-1.5 [&>div]:bg-[var(--neon-2)]" aria-label={t("trends.brandFit")} />
                        {tr.brandFitReason && (
                          <p className="text-[11px] leading-snug text-muted-foreground">
                            <span className="font-medium text-[var(--neon-2)]">{t("trends.why")}:</span> {tr.brandFitReason}
                          </p>
                        )}
                      </div>
                    )}

                    {tr.suggestedAdaptation && (
                      <div
                        className="rounded-xl border p-3 text-[13px] leading-relaxed"
                        style={{
                          borderColor: "color-mix(in oklab, var(--neon) 30%, transparent)",
                          background: "color-mix(in oklab, var(--neon) 7%, transparent)",
                        }}
                      >
                        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--neon)]">
                          <Sparkles className="h-3.5 w-3.5" /> {t("trends.adaptation")}
                        </p>
                        {tr.suggestedAdaptation}
                      </div>
                    )}

                    {tr.risk && (
                      <div
                        className="flex items-start gap-2 rounded-xl border p-3 text-[13px] leading-relaxed"
                        style={{
                          borderColor: "color-mix(in oklab, var(--neon-3) 35%, transparent)",
                          background: "color-mix(in oklab, var(--neon-3) 8%, transparent)",
                        }}
                        role="alert"
                      >
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--neon-3)]" />
                        <span><span className="font-semibold text-[var(--neon-3)]">{t("trends.risk")}:</span> {tr.risk}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                      <a
                        href={tr.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-md px-1 text-xs text-muted-foreground underline-offset-2 hover:text-[var(--neon-2)] hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span className="max-w-52 truncate">{tr.sourceName || tr.sourceUrl}</span>
                        <span className="sr-only">{t("trends.source")}</span>
                      </a>
                      <div className="flex items-center gap-2">
                        {adapted && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 gap-1.5"
                            onClick={() => setExpanded((p) => ({ ...p, [tr.id]: !p[tr.id] }))}
                            aria-expanded={isOpen}
                            aria-label={t("trends.adaptedPanel")}
                          >
                            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            {t("trends.adaptedPanel")}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 gap-1.5 sm:h-10"
                          onClick={() => adapt(tr)}
                          disabled={adaptingId === tr.id}
                          aria-label={t("trends.adapt")}
                        >
                          {adaptingId === tr.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                          {adaptingId === tr.id ? t("trends.adapting") : t("trends.adapt")}
                        </Button>
                      </div>
                    </div>

                    {adapted && isOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="grid gap-3 overflow-hidden rounded-xl border border-border/60 bg-muted/20 p-3"
                      >
                        {([
                          ["trends.concept", "trends.copyConcept", tr.concept],
                          ["trends.hook", "trends.copyHook", tr.hook],
                          ["trends.script", "trends.copyScript", tr.script],
                        ] as const).map(([labelKey, copyKey, value]) =>
                          value ? (
                            <div key={labelKey} className="grid gap-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--neon)]">{t(labelKey)}</p>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-[var(--neon)]"
                                  onClick={() => copyText(value)}
                                  aria-label={t(copyKey)}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                              <p className="whitespace-pre-wrap rounded-lg bg-background/40 p-3 text-[13px] leading-relaxed">{value}</p>
                            </div>
                          ) : null
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
