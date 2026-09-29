"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useI18n, api } from "@/lib/use-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp, Eye, Heart, MessageSquare, Share2, Bookmark, MousePointerClick,
  PenLine, Sparkles, Database, BrainCircuit, Loader2, RefreshCw, BarChart3,
} from "lucide-react";
import { PlatformIcon } from "@/components/modules/content";

// ===== types =====
interface Snapshot {
  id: string; contentItemId: string | null; platform: string; source: string; collectedAt: string;
  views: number; reach: number; impressions: number; likes: number; comments: number; shares: number; saves: number; clicks: number;
  watchTimeSec: number; completionRate: number;
  contentItem?: { id: string; title: string; platform: string } | null;
}

interface ContentLite { id: string; title: string; platform: string }

const METRIC_FIELDS = ["views", "likes", "comments", "shares", "saves", "clicks"] as const;
type MetricField = (typeof METRIC_FIELDS)[number];

const METRIC_ICONS: Record<MetricField, React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>> = {
  views: Eye, likes: Heart, comments: MessageSquare, shares: Share2, saves: Bookmark, clicks: MousePointerClick,
};

function metricColor(field: MetricField): string {
  switch (field) {
    case "views": return "var(--neon)";
    case "likes": return "var(--neon-2)";
    case "comments": return "var(--neon-3)";
    case "shares": return "var(--neon)";
    case "saves": return "var(--neon-2)";
    case "clicks": return "var(--neon-3)";
  }
}

// ===== main module =====
export function AnalyticsModule(_props: { onBrandsChanged?: () => void }) {
  const { t } = useI18n();

  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const [content, setContent] = useState<ContentLite[] | null>(null);
  const [entry, setEntry] = useState<Record<MetricField, string>>({ views: "", likes: "", comments: "", shares: "", saves: "", clicks: "" });
  const [entryId, setEntryId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        api<Snapshot[]>("/api/analytics"),
        api<ContentLite[]>("/api/content"),
      ]);
      setSnaps(s);
      setContent(c);
      if (c.length && !entryId) setEntryId(c[0].id);
    } catch {
      setSnaps([]);
      setContent([]);
    }
  }, [entryId]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const acc: Record<MetricField, number> = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0 };
    for (const s of snaps ?? []) {
      for (const f of METRIC_FIELDS) acc[f] += s[f] ?? 0;
    }
    return acc;
  }, [snaps]);

  const perPost = useMemo(() => {
    const map = new Map<string, { title: string; platform: string; views: number; engagement: number }>();
    for (const s of snaps ?? []) {
      if (!s.contentItem) continue;
      const key = s.contentItem.id;
      const cur = map.get(key) ?? { title: s.contentItem.title, platform: s.contentItem.platform, views: 0, engagement: 0 };
      cur.views += s.views;
      cur.engagement += s.likes + s.comments + s.shares + s.saves;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.engagement - a.engagement);
  }, [snaps]);

  const maxEngagement = Math.max(1, ...perPost.map((p) => p.engagement));

  const engagementRate = totals.views > 0
    ? ((totals.likes + totals.comments + totals.shares + totals.saves) / totals.views) * 100
    : 0;

  const saveEntry = async () => {
    if (!entryId) return;
    setSaving(true);
    try {
      const body: Record<string, number | string> = { contentItemId: entryId };
      for (const f of METRIC_FIELDS) body[f] = Math.max(0, Math.floor(Number(entry[f]) || 0));
      await api<Snapshot>("/api/analytics", { method: "POST", body: JSON.stringify(body) });
      toast.success(t("analytics.saved"), { description: t("analytics.manualNote") });
      setEntry({ views: "", likes: "", comments: "", shares: "", saves: "", clicks: "" });
      await load();
    } catch (e) {
      toast.error(t("common.error"), { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-5">
      {/* header */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-strong neon-border rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
              <TrendingUp className="h-5 w-5 text-[var(--neon)]" aria-hidden /> {t("analytics.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("analytics.subtitle")}</p>
          </div>
          <Button variant="outline" size="sm" className="min-h-11" onClick={load} aria-label={t("content.refresh")}>
            <RefreshCw className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </motion.section>

      {/* aggregate metric cards */}
      <section aria-label={t("analytics.metrics")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {METRIC_FIELDS.map((f, i) => {
            const Icon = METRIC_ICONS[f];
            const color = metricColor(f);
            return (
              <motion.div key={f} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="glass glass-hover rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <span className="rounded-lg p-2" style={{ background: `color-mix(in oklab, ${color} 15%, transparent)` }}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                </div>
                {snaps === null ? (
                  <Skeleton className="mt-3 h-7 w-20 rounded-lg bg-muted/40" />
                ) : (
                  <p className="mt-3 text-lg font-semibold tabular-nums" style={{ color }}>{totals[f].toLocaleString()}</p>
                )}
                <p className="text-xs text-muted-foreground">{t(`analytics.m.${f}`)}</p>
              </motion.div>
            );
          })}
        </div>
        {snaps && snaps.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("analytics.engagementRate")}: <span className="neon-text font-semibold">{engagementRate.toFixed(1)}%</span>
          </p>
        )}
      </section>

      {/* per-post engagement */}
      <Card className="glass rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-[var(--neon-2)]" aria-hidden /> {t("analytics.perPost")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("analytics.perPostDesc")}</p>
        </CardHeader>
        <CardContent className="max-h-96 overflow-y-auto scrollbar-thin">
          {snaps === null ? (
            <div className="grid gap-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl bg-muted/40" />)}</div>
          ) : perPost.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("analytics.empty")}</p>
          ) : (
            <ul className="grid gap-2">
              {perPost.map((p, i) => (
                <li key={i} className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</p>
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <PlatformIcon platform={p.platform} /> {p.platform}
                    </Badge>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted/40">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.max(4, (p.engagement / maxEngagement) * 100)}%`, background: "linear-gradient(90deg, var(--neon), var(--neon-2))" }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("analytics.m.views")}: {p.views.toLocaleString()} · engagement: {p.engagement.toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* manual entry */}
      <Card className="glass rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <PenLine className="h-4 w-4 text-[var(--neon-3)]" aria-hidden /> {t("analytics.manualEntry")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("analytics.manualDesc")}</p>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 pt-0">
          {!content ? (
            <Skeleton className="h-20 rounded-xl bg-muted/40" />
          ) : content.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("analytics.noContentForEntry")}</p>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label>{t("analytics.selectPost")}</Label>
                <Select value={entryId} onValueChange={setEntryId}>
                  <SelectTrigger className="min-h-11" aria-label={t("analytics.selectPost")}><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {content.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {METRIC_FIELDS.map((f) => (
                  <div key={f} className="grid gap-1.5">
                    <Label htmlFor={`m-${f}`} className="text-xs">{t(`analytics.m.${f}`)}</Label>
                    <Input
                      id={`m-${f}`}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className="min-h-11"
                      value={entry[f]}
                      onChange={(e) => setEntry({ ...entry, [f]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
              <Button className="min-h-11 w-full sm:w-auto sm:justify-self-end" disabled={saving || !entryId} onClick={saveEntry}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                {t("analytics.saveMetrics")}
              </Button>
              {/* honest note — always visible under the form */}
              <p className="rounded-xl border border-[color-mix(in_oklab,var(--neon-3)_40%,transparent)] bg-[color-mix(in_oklab,var(--neon-3)_8%,transparent)] p-3 text-xs text-foreground/85" role="note">
                <Database className="mr-1 inline h-3.5 w-3.5 text-[var(--neon-3)]" aria-hidden />
                {t("analytics.manualNote")}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* learning insights explanation */}
      <Card className="glass rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4 text-[var(--neon)]" aria-hidden /> {t("analytics.learning")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("analytics.learningDesc")}</p>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 sm:grid-cols-2">
          <div className="rounded-xl border border-[color-mix(in_oklab,var(--neon-2)_40%,transparent)] bg-[color-mix(in_oklab,var(--neon-2)_8%,transparent)] p-4">
            <Badge variant="outline" className="text-[10px]" style={{ background: "color-mix(in oklab, var(--neon-2) 16%, transparent)", color: "var(--neon-2)", borderColor: "color-mix(in oklab, var(--neon-2) 40%, transparent)" }}>
              {t("analytics.observedTitle")}
            </Badge>
            <p className="mt-2 text-xs leading-relaxed text-foreground/85">{t("analytics.observedDesc")}</p>
          </div>
          <div className="rounded-xl border border-[color-mix(in_oklab,var(--neon)_40%,transparent)] bg-[color-mix(in_oklab,var(--neon)_8%,transparent)] p-4">
            <Badge variant="outline" className="text-[10px]" style={{ background: "color-mix(in oklab, var(--neon) 16%, transparent)", color: "var(--neon)", borderColor: "color-mix(in oklab, var(--neon) 40%, transparent)" }}>
              {t("analytics.interpTitle")}
            </Badge>
            <p className="mt-2 text-xs leading-relaxed text-foreground/85">{t("analytics.interpDesc")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
