"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/lib/store";
import { useI18n, api } from "@/lib/use-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2, Flame, CalendarRange, FileStack, ImageIcon, Clapperboard,
  AudioLines, Mic, UserSquare, Send, TrendingUp, Zap, Clock, Wallet,
} from "lucide-react";

interface Job {
  id: string;
  kind: string;
  status: string;
  stage?: string | null;
  error?: string | null;
  createdAt: string;
}
interface Trend {
  id: string;
  title: string;
  platform?: string | null;
  status: string;
  brandFitScore?: number | null;
}
interface Scheduled {
  id: string;
  platform: string;
  scheduledAt: string;
  status: string;
  contentItem?: { title: string } | null;
}
interface Costs {
  today: number;
  week: number;
  month: number;
  byProvider: { provider: string; cost: number }[];
}
interface DashData {
  jobs: Job[];
  trends: Trend[];
  scheduled: Scheduled[];
  costs: Costs;
  contentCount: number;
  brandCount: number;
}

const QUICK = [
  { view: "brands" as const, icon: Building2, key: "dash.qa.analyze", neon: "--neon" },
  { view: "trends" as const, icon: Flame, key: "dash.qa.trends", neon: "--neon-3" },
  { view: "planner" as const, icon: CalendarRange, key: "dash.qa.strategy", neon: "--neon" },
  { view: "content" as const, icon: FileStack, key: "dash.qa.content", neon: "--neon-2" },
  { view: "image" as const, icon: ImageIcon, key: "dash.qa.image", neon: "--neon" },
  { view: "video" as const, icon: Clapperboard, key: "dash.qa.video", neon: "--neon-3" },
  { view: "voice" as const, icon: AudioLines, key: "dash.qa.music", neon: "--neon-2" },
  { view: "voice" as const, icon: Mic, key: "dash.qa.voice", neon: "--neon" },
  { view: "voice" as const, icon: UserSquare, key: "dash.qa.avatar", neon: "--neon-3" },
  { view: "publishing" as const, icon: Send, key: "dash.qa.schedule", neon: "--neon-2" },
];

export function DashboardModule() {
  const { t } = useI18n();
  const setView = useApp((s) => s.setView);
  const user = useApp((s) => s.user);
  const activeBrandId = useApp((s) => s.activeBrandId);
  const brands = useApp((s) => s.activeBrandId);
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [jobs, trends, scheduled, costs, content, brandsList] = await Promise.all([
        api<Job[]>("/api/jobs?limit=12"),
        api<Trend[]>(`/api/trends${activeBrandId ? `?brandId=${activeBrandId}` : ""}`),
        api<Scheduled[]>("/api/schedule?upcoming=1"),
        api<Costs>("/api/costs"),
        api<unknown[]>(`/api/content${activeBrandId ? `?brandId=${activeBrandId}` : ""}`),
        api<{ id: string }[]>("/api/brands"),
      ]);
      setData({ jobs, trends: trends.slice(0, 5), scheduled: scheduled.slice(0, 5), costs, contentCount: content.length, brandCount: brandsList.length });
    } catch {
      // dashboard stays usable; empty states show
    } finally {
      setLoading(false);
    }
  }, [activeBrandId]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000); // job feed auto-refresh
    return () => clearInterval(iv);
  }, [load]);

  const activeJobs = data?.jobs.filter((j) => ["QUEUED", "PROCESSING", "WAITING_PROVIDER", "RETRYING"].includes(j.status)) ?? [];

  return (
    <div className="grid gap-5">
      {/* welcome */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-strong neon-border rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold sm:text-2xl">
              {t("dash.welcome")}, <span className="neon-text">{user?.name ?? user?.email}</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data && data.brandCount === 0 ? t("dash.noBrand") : `${data?.brandCount ?? 0} brands · ${data?.contentCount ?? 0} content items`}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Zap className="h-3.5 w-3.5 text-[var(--neon)]" /> Cloud AI Core connected
          </div>
        </div>
      </motion.section>

      {/* quick actions */}
      <section aria-label={t("dash.quickActions")}>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground">{t("dash.quickActions")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {QUICK.map(({ view, icon: Icon, key, neon }, i) => (
            <motion.button
              key={key + i}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => setView(view)}
              className="glass glass-hover group flex flex-col items-start gap-3 rounded-xl p-4 text-left"
            >
              <span className="rounded-lg p-2 transition group-hover:scale-110" style={{ background: `color-mix(in oklab, var(${neon}) 18%, transparent)` }}>
                <Icon className="h-5 w-5" style={{ color: `var(${neon})` }} />
              </span>
              <span className="text-xs font-medium leading-snug sm:text-sm">{t(key)}</span>
            </motion.button>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* active jobs */}
        <Card className="glass rounded-2xl lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-[var(--neon)]" /> {t("dash.activeJobs")}
              {activeJobs.length > 0 && <Badge variant="secondary" className="animate-pulse-soft">{activeJobs.length}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-64 overflow-y-auto scrollbar-thin">
            {loading ? (
              <div className="grid gap-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl bg-muted/40" />)}</div>
            ) : activeJobs.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("dash.noJobs")}</p>
            ) : (
              <ul className="grid gap-2">
                {activeJobs.map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{j.kind}</p>
                      <p className="text-xs text-muted-foreground">{new Date(j.createdAt).toLocaleTimeString()}</p>
                    </div>
                    <Badge variant={j.status === "RETRYING" ? "destructive" : "secondary"} className="shrink-0 text-[10px]">
                      {t(`job.status.${j.status}` as const)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* budget */}
        <Card className="glass rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4 text-[var(--neon-2)]" /> {t("dash.budget")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {data ? (
              <>
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-muted-foreground">Today</span>
                    <span className="font-medium">${data.costs.today.toFixed(3)}</span>
                  </div>
                  <Progress value={Math.min(100, data.costs.today * 20)} className="h-1.5" />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-muted-foreground">Week</span>
                    <span className="font-medium">${data.costs.week.toFixed(3)}</span>
                  </div>
                  <Progress value={Math.min(100, data.costs.week * 4)} className="h-1.5" />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-muted-foreground">Month</span>
                    <span className="font-medium">${data.costs.month.toFixed(3)}</span>
                  </div>
                  <Progress value={Math.min(100, data.costs.month)} className="h-1.5" />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Hard limits enforced by Autopilot policy · {data.costs.byProvider.length} providers tracked
                </p>
              </>
            ) : (
              <Skeleton className="h-32 rounded-xl bg-muted/40" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* trends */}
        <Card className="glass rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4 text-[var(--neon-3)]" /> {t("dash.trendOpportunities")}</CardTitle>
          </CardHeader>
          <CardContent className="max-h-60 overflow-y-auto scrollbar-thin">
            {!data || data.trends.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("dash.noTrends")}</p>
            ) : (
              <ul className="grid gap-2">
                {data.trends.map((tr) => (
                  <li key={tr.id} className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-1 text-sm font-medium">{tr.title}</p>
                      <Badge variant="outline" className="shrink-0 text-[10px]">{tr.status}</Badge>
                    </div>
                    {tr.brandFitScore != null && (
                      <p className="mt-1 text-[11px] text-muted-foreground">Brand fit: {(tr.brandFitScore * 100).toFixed(0)}% · {tr.platform ?? "web"}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* next posts */}
        <Card className="glass rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Send className="h-4 w-4 text-[var(--neon-2)]" /> {t("dash.nextPosts")}</CardTitle>
          </CardHeader>
          <CardContent className="max-h-60 overflow-y-auto scrollbar-thin">
            {!data || data.scheduled.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("dash.noPosts")}</p>
            ) : (
              <ul className="grid gap-2">
                {data.scheduled.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.contentItem?.title ?? p.platform}</p>
                      <p className="text-xs text-muted-foreground">{new Date(p.scheduledAt).toLocaleString()}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{p.platform}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
