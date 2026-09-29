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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  CalendarRange, Lock, LockOpen, Pencil, Loader2, CheckCircle2, Sparkles,
  Target, Radio, Filter, CalendarDays, Crosshair, FlaskConical, Megaphone,
  FileStack, Wand2, Repeat, Square,
} from "lucide-react";

// ---------- types (server API shapes) ----------
interface BrandLite { id: string; name: string }
interface MarketingPlanDto {
  id: string;
  brandId: string;
  version: number;
  status: string; // DRAFT | APPROVED
  objectivesJson: string | null;
  pillarsJson: string | null;
  channelsJson: string | null;
  funnelJson: string | null;
  weeklyJson: string | null;
  monthlyJson: string | null;
  cadence: string | null;
  kpisJson: string | null;
  experimentsJson: string | null;
  campaignIdeasJson: string | null;
  lockedSections: string; // JSON array
  createdAt: string;
}
interface ContentPlanDto {
  id: string;
  brandId: string;
  title: string;
  itemsJson: string | null;
  status: string;
  createdAt: string;
  contentItems: { id: string; title: string; approvalState: string; platform: string; metaJson: string | null }[];
}
interface PlanItem {
  title?: string;
  platform?: string;
  contentType?: string;
  day?: number;
  hook?: string;
  topic?: string;
  pillar?: string;
  goal?: string;
}
interface Pillar { name: string; share_pct: number; description: string }
interface Channel { platform: string; role: string; cadence_per_week: number }
interface FunnelStage { stage: string; content_types: string[] }
interface WeeklyRow { day: string; platform: string; pillar: string; format: string; topic: string }
interface Kpi { name: string; target: string }
interface Campaign { name: string; concept: string; platform: string }

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}
function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------- section codecs (JSON ↔ line-per-item "JSON-lite") ----------
type SectionKey = "objectives" | "pillars" | "channels" | "funnel" | "weekly" | "monthly" | "kpis" | "experiments" | "campaigns";
const SECTION_KEYS: SectionKey[] = ["objectives", "pillars", "channels", "funnel", "weekly", "monthly", "kpis", "experiments", "campaigns"];
const LIST_SECTIONS: SectionKey[] = ["objectives", "monthly", "experiments"];

function cells(line: string): string[] {
  return line.split("|").map((c) => c.trim());
}

function encodeSection(key: SectionKey, raw: string | null): string {
  switch (key) {
    case "objectives":
    case "monthly":
    case "experiments":
      return parseJson<string[]>(raw, []).join("\n");
    case "pillars":
      return parseJson<Pillar[]>(raw, []).map((p) => [p.name, String(p.share_pct ?? 0), p.description ?? ""].join(" | ")).join("\n");
    case "channels":
      return parseJson<Channel[]>(raw, []).map((c) => [c.platform, String(c.cadence_per_week ?? 0), c.role ?? ""].join(" | ")).join("\n");
    case "funnel":
      return parseJson<FunnelStage[]>(raw, []).map((f) => [f.stage, (f.content_types ?? []).join(", ")].join(" | ")).join("\n");
    case "weekly":
      return parseJson<WeeklyRow[]>(raw, []).map((w) => [w.day ?? "", w.platform ?? "", w.pillar ?? "", w.format ?? "", w.topic ?? ""].join(" | ")).join("\n");
    case "kpis":
      return parseJson<Kpi[]>(raw, []).map((k) => [k.name, k.target ?? ""].join(" | ")).join("\n");
    case "campaigns":
      return parseJson<Campaign[]>(raw, []).map((c) => [c.name, c.platform ?? "", c.concept ?? ""].join(" | ")).join("\n");
  }
}

function decodeSection(key: SectionKey, text: string): unknown {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  switch (key) {
    case "objectives":
    case "monthly":
    case "experiments":
      return lines;
    case "pillars":
      return lines.map((l) => {
        const [name = "", share = "", description = ""] = cells(l);
        return { name, share_pct: Number(share) || 0, description };
      });
    case "channels":
      return lines.map((l) => {
        const [platform = "", cadence = "", role = ""] = cells(l);
        return { platform, cadence_per_week: Number(cadence) || 0, role };
      });
    case "funnel":
      return lines.map((l) => {
        const [stage = "", types = ""] = cells(l);
        return { stage, content_types: types.split(",").map((s) => s.trim()).filter(Boolean) };
      });
    case "weekly":
      return lines.map((l) => {
        const [day = "", platform = "", pillar = "", format = "", topic = ""] = cells(l);
        return { day, platform, pillar, format, topic };
      });
    case "kpis":
      return lines.map((l) => {
        const [name = "", target = ""] = cells(l);
        return { name, target };
      });
    case "campaigns":
      return lines.map((l) => {
        const [name = "", platform = "", concept = ""] = cells(l);
        return { name, platform, concept };
      });
  }
}

// MarketingPlan JSON field per section key (campaigns → campaignIdeasJson)
const SECTION_FIELD: Record<SectionKey, string> = {
  objectives: "objectivesJson",
  pillars: "pillarsJson",
  channels: "channelsJson",
  funnel: "funnelJson",
  weekly: "weeklyJson",
  monthly: "monthlyJson",
  kpis: "kpisJson",
  experiments: "experimentsJson",
  campaigns: "campaignIdeasJson",
};
function sectionRaw(plan: MarketingPlanDto, key: SectionKey): string | null {
  return (plan[SECTION_FIELD[key] as keyof MarketingPlanDto] as string | null) ?? null;
}

const SECTION_ICON: Record<SectionKey, typeof Target> = {
  objectives: Target,
  pillars: Radio,
  channels: Filter,
  funnel: Filter,
  weekly: CalendarDays,
  monthly: Crosshair,
  kpis: Crosshair,
  experiments: FlaskConical,
  campaigns: Megaphone,
};
const SECTION_NEON: Record<SectionKey, string> = {
  objectives: "var(--neon)",
  pillars: "var(--neon-2)",
  channels: "var(--neon-3)",
  funnel: "var(--neon)",
  weekly: "var(--neon-2)",
  monthly: "var(--neon-3)",
  kpis: "var(--neon)",
  experiments: "var(--neon-2)",
  campaigns: "var(--neon-3)",
};

// ---------- component ----------
export function PlannerModule() {
  const { t, locale } = useI18n();
  const activeBrandId = useApp((s) => s.activeBrandId);
  const setActiveBrand = useApp((s) => s.setActiveBrand);

  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [plan, setPlan] = useState<MarketingPlanDto | null>(null);
  const [contentPlans, setContentPlans] = useState<ContentPlanDto[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [generatingContent, setGeneratingContent] = useState(false);

  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [editText, setEditText] = useState("");
  const [savingSection, setSavingSection] = useState<SectionKey | null>(null);
  const [locking, setLocking] = useState<SectionKey | null>(null);
  const [approving, setApproving] = useState(false);
  const [creatingItem, setCreatingItem] = useState<string | null>(null);
  const [createdItems, setCreatedItems] = useState<Record<string, boolean>>({});
  // batch AI drafting: one plan card at a time, sequential per-item calls with progress + cancel
  const [batch, setBatch] = useState<{ planId: string; done: number; total: number } | null>(null);
  const batchStopRef = useRef(false);

  useEffect(() => {
    api<BrandLite[]>("/api/brands")
      .then(setBrands)
      .catch(() => {});
  }, []);

  const loadPlans = useCallback(async (brandId: string) => {
    setPlansLoading(true);
    try {
      const [marketing, content] = await Promise.all([
        api<MarketingPlanDto[]>(`/api/plans/marketing?brandId=${brandId}`),
        api<ContentPlanDto[]>(`/api/plans/content?brandId=${brandId}`),
      ]);
      setPlan(marketing[0] ?? null);
      setContentPlans(content);
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setPlansLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeBrandId) loadPlans(activeBrandId);
    else { setPlan(null); setContentPlans([]); }
  }, [activeBrandId, loadPlans]);

  const generatePlan = async () => {
    if (!activeBrandId) return;
    setGenerating(true);
    pulseCore("PLANNING");
    try {
      const created = await api<MarketingPlanDto>("/api/plans/marketing", {
        method: "POST",
        body: JSON.stringify({ brandId: activeBrandId }),
      });
      setPlan(created);
      pulseCore("SUCCESS");
      toast.success(t("planner.planGenerated"));
    } catch (e) {
      pulseCore("ERROR");
      toast.error(errMessage(e));
    } finally {
      setGenerating(false);
    }
  };

  const generateContentPlan = async () => {
    if (!activeBrandId) return;
    setGeneratingContent(true);
    pulseCore("PLANNING");
    try {
      const created = await api<ContentPlanDto>("/api/plans/content", {
        method: "POST",
        body: JSON.stringify({ brandId: activeBrandId, language: locale }),
      });
      // POST response has no contentItems relation — normalize before unshifting
      setContentPlans((prev) => [{ ...created, contentItems: created.contentItems ?? [] }, ...prev]);
      pulseCore("SUCCESS");
      toast.success(t("planner.contentGenerated"));
    } catch (e) {
      pulseCore("ERROR");
      toast.error(errMessage(e));
    } finally {
      setGeneratingContent(false);
    }
  };

  const saveSection = async (key: SectionKey) => {
    if (!plan) return;
    setSavingSection(key);
    try {
      const updated = await api<MarketingPlanDto>("/api/plans/marketing", {
        method: "PATCH",
        body: JSON.stringify({ id: plan.id, section: key, value: decodeSection(key, editText) }),
      });
      setPlan(updated);
      setEditing(null);
      pulseCore("SUCCESS");
      toast.success(t("planner.saved"));
    } catch (e) {
      pulseCore("ERROR");
      toast.error(errMessage(e));
    } finally {
      setSavingSection(null);
    }
  };

  const toggleLock = async (key: SectionKey) => {
    if (!plan) return;
    const locked = parseJson<string[]>(plan.lockedSections, []);
    setLocking(key);
    try {
      const updated = await api<MarketingPlanDto>("/api/plans/marketing", {
        method: "PATCH",
        body: JSON.stringify({ id: plan.id, ...(locked.includes(key) ? { unlockSection: key } : { lockSection: key }) }),
      });
      setPlan(updated);
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setLocking(null);
    }
  };

  const approvePlan = async () => {
    if (!plan) return;
    setApproving(true);
    try {
      const updated = await api<MarketingPlanDto>("/api/plans/marketing", {
        method: "PATCH",
        body: JSON.stringify({ id: plan.id, status: "APPROVED" }),
      });
      setPlan(updated);
      toast.success(t("planner.approved"));
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setApproving(false);
    }
  };

  const createItemFromPlan = async (planId: string, itemIndex: number) => {
    const key = `${planId}:${itemIndex}`;
    setCreatingItem(key);
    try {
      await api<unknown>("/api/plans/content", {
        method: "PATCH",
        body: JSON.stringify({ id: planId, itemIndex }),
      });
      setCreatedItems((prev) => ({ ...prev, [key]: true }));
      toast.success(t("planner.itemCreated"));
      if (activeBrandId) {
        const content = await api<ContentPlanDto[]>(`/api/plans/content?brandId=${activeBrandId}`);
        setContentPlans(content);
      }
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setCreatingItem(null);
    }
  };

  // plan items that already have a draft (persisted via meta.itemIndex, falls back to session marks)
  const coveredIndexes = useCallback((cp: ContentPlanDto): Set<number> => {
    const covered = new Set<number>();
    for (const ci of cp.contentItems ?? []) {
      const meta = parseJson<{ itemIndex?: unknown }>(ci.metaJson, {});
      if (typeof meta.itemIndex === "number") covered.add(meta.itemIndex);
    }
    for (const key of Object.keys(createdItems)) {
      if (key.startsWith(`${cp.id}:`) && createdItems[key]) {
        const idx = Number(key.split(":")[1]);
        if (Number.isInteger(idx)) covered.add(idx);
      }
    }
    return covered;
  }, [createdItems]);

  // batch generate: AI drafts for every plan item that does not have one yet
  const generateAllFromPlan = async (cp: ContentPlanDto) => {
    if (batch) return;
    const covered = coveredIndexes(cp);
    const remaining = cp.itemsJson ? parseJson<PlanItem[]>(cp.itemsJson, []).map((_, i) => i).filter((i) => !covered.has(i)) : [];
    if (remaining.length === 0) {
      toast.info(t("planner.batchNone"));
      return;
    }
    batchStopRef.current = false;
    setBatch({ planId: cp.id, done: 0, total: remaining.length });
    let okCount = 0;
    try {
      for (const idx of remaining) {
        if (batchStopRef.current) break;
        try {
          const res = await api<{ created: unknown[] }>("/api/plans/content/batch", {
            method: "POST",
            body: JSON.stringify({ id: cp.id, indexes: [idx], aiWrite: true }),
          });
          okCount += res.created.length;
        } catch (e) {
          toast.error(errMessage(e), { description: `#${idx + 1}` });
        }
        setBatch((prev) => (prev && prev.planId === cp.id ? { ...prev, done: prev.done + 1 } : prev));
      }
    } finally {
      const stopped = batchStopRef.current;
      setBatch(null);
      batchStopRef.current = false;
      if (okCount > 0) {
        toast.success(stopped ? t("planner.batchPartial", { n: okCount }) : t("planner.batchDone", { n: okCount }));
      } else if (stopped) {
        toast.info(t("planner.batchStopped"));
      }
      if (activeBrandId) {
        const content = await api<ContentPlanDto[]>(`/api/plans/content?brandId=${activeBrandId}`);
        setContentPlans(content);
      }
    }
  };

  const lockedSections = useMemo(() => parseJson<string[]>(plan?.lockedSections, []), [plan]);

  // ---------- section body renderer ----------
  const renderBody = (key: SectionKey) => {
    const raw = plan ? sectionRaw(plan, key) : null;
    switch (key) {
      case "objectives":
      case "monthly":
      case "experiments": {
        const items = parseJson<string[]>(raw, []);
        if (items.length === 0) return <p className="text-xs text-muted-foreground">{t("common.empty")}</p>;
        return (
          <ul className="grid gap-2">
            {items.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-snug">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SECTION_NEON[key] }} />
                {s}
              </li>
            ))}
          </ul>
        );
      }
      case "pillars": {
        const items = parseJson<Pillar[]>(raw, []);
        if (items.length === 0) return <p className="text-xs text-muted-foreground">{t("common.empty")}</p>;
        return (
          <div className="grid gap-3">
            {items.map((p, i) => (
              <div key={i} className="grid gap-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{p.share_pct ?? 0}% {t("planner.share")}</span>
                </div>
                <Progress value={Math.min(100, p.share_pct ?? 0)} className="h-1.5 [&>div]:bg-[var(--neon-2)]" aria-label={p.name} />
                {p.description && <p className="text-[11px] leading-snug text-muted-foreground">{p.description}</p>}
              </div>
            ))}
          </div>
        );
      }
      case "channels": {
        const items = parseJson<Channel[]>(raw, []);
        if (items.length === 0) return <p className="text-xs text-muted-foreground">{t("common.empty")}</p>;
        return (
          <ul className="grid gap-2">
            {items.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
                <span className="rounded-md border border-border/60 bg-background/40 px-2 py-0.5 text-[11px] font-semibold text-[var(--neon-3)]">{c.platform}</span>
                {c.role && <span className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">{c.role}</span>}
                <span className="text-[11px] font-medium">{c.cadence_per_week ?? 0}×{t("planner.perWeek")}</span>
              </li>
            ))}
          </ul>
        );
      }
      case "funnel": {
        const items = parseJson<FunnelStage[]>(raw, []);
        if (items.length === 0) return <p className="text-xs text-muted-foreground">{t("common.empty")}</p>;
        return (
          <div className="grid gap-2">
            {items.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span
                  className="rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase"
                  style={{ background: "color-mix(in oklab, var(--neon) 12%, transparent)", color: "var(--neon)" }}
                >
                  {f.stage}
                </span>
                <div className="flex flex-wrap gap-1">
                  {(f.content_types ?? []).map((ct, j) => (
                    <span key={j} className="rounded border border-border/60 bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted-foreground">{ct}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      }
      case "weekly": {
        const items = parseJson<WeeklyRow[]>(raw, []);
        if (items.length === 0) return <p className="text-xs text-muted-foreground">{t("common.empty")}</p>;
        return (
          <div className="overflow-x-auto scrollbar-thin">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 text-xs">{t("planner.day")}</TableHead>
                  <TableHead className="h-8 text-xs">{t("common.platform")}</TableHead>
                  <TableHead className="h-8 text-xs">{t("planner.pillar")}</TableHead>
                  <TableHead className="h-8 text-xs">{t("planner.format")}</TableHead>
                  <TableHead className="h-8 text-xs">{t("planner.topic")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((w, i) => (
                  <TableRow key={i}>
                    <TableCell className="py-1.5 text-xs font-semibold text-[var(--neon-2)]">{w.day}</TableCell>
                    <TableCell className="py-1.5 text-xs">{w.platform}</TableCell>
                    <TableCell className="py-1.5 text-xs">{w.pillar}</TableCell>
                    <TableCell className="py-1.5 text-xs">{w.format}</TableCell>
                    <TableCell className="py-1.5 text-xs text-muted-foreground">{w.topic}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      }
      case "kpis": {
        const items = parseJson<Kpi[]>(raw, []);
        if (items.length === 0) return <p className="text-xs text-muted-foreground">{t("common.empty")}</p>;
        return (
          <ul className="grid gap-2">
            {items.map((k, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-sm">
                <span className="font-medium">{k.name}</span>
                <span className="text-xs font-semibold text-[var(--neon-2)]">{k.target}</span>
              </li>
            ))}
          </ul>
        );
      }
      case "campaigns": {
        const items = parseJson<Campaign[]>(raw, []);
        if (items.length === 0) return <p className="text-xs text-muted-foreground">{t("common.empty")}</p>;
        return (
          <div className="grid gap-2">
            {items.map((c, i) => (
              <div key={i} className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{c.name}</span>
                  {c.platform && (
                    <span className="rounded-md border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] font-semibold text-[var(--neon-3)]">{c.platform}</span>
                  )}
                </div>
                {c.concept && <p className="mt-1 text-xs leading-snug text-muted-foreground">{c.concept}</p>}
              </div>
            ))}
          </div>
        );
      }
    }
  };

  // ---------- content plan item ----------
  const renderContentPlan = (cp: ContentPlanDto, idx: number) => {
    const items = parseJson<PlanItem[]>(cp.itemsJson, []);
    const covered = coveredIndexes(cp);
    const remaining = items.map((_, i) => i).filter((i) => !covered.has(i));
    const batchActive = batch?.planId === cp.id;
    const batchBusy = Boolean(batch);
    const coverage = items.length > 0 ? Math.round(((items.length - remaining.length) / items.length) * 100) : 100;
    return (
      <motion.div key={cp.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}>
        <Card className={`glass rounded-2xl ${batchActive ? "border-[var(--neon)]/50" : ""}`}>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
            <CardTitle className="flex min-w-0 items-center gap-2 text-sm sm:text-base">
              <FileStack className="h-4 w-4 shrink-0 text-[var(--neon-2)]" />
              <span className="truncate">{cp.title}</span>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>{items.length} {t("planner.items")}</span>
              <span>·</span>
              <span className={coverage === 100 && items.length > 0 ? "font-medium text-[var(--neon-2)]" : ""}>{cp.contentItems?.length ?? 0} {t("planner.drafts")}</span>
              {items.length > 0 && (
                <Button
                  size="sm"
                  variant={remaining.length === 0 ? "ghost" : "outline"}
                  className="h-9 gap-1.5"
                  disabled={batchBusy || remaining.length === 0}
                  onClick={() => generateAllFromPlan(cp)}
                  aria-label={t("planner.batchAll", { n: remaining.length })}
                >
                  {batchActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5 text-[var(--neon)]" aria-hidden />}
                  {remaining.length === 0 ? t("planner.batchComplete") : t("planner.batchAll", { n: remaining.length })}
                </Button>
              )}
              {batchActive && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => { batchStopRef.current = true; }}
                  aria-label={t("planner.batchStop")}
                >
                  <Square className="h-3 w-3" aria-hidden /> {t("planner.batchStop")}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            {items.length > 0 && (
              <div className="grid gap-1.5" aria-label={`${t("planner.drafts")} ${coverage}%`}>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{t("planner.coverage")}</span>
                  <span className="font-mono">{items.length - remaining.length}/{items.length}{batchActive ? ` · ${batch!.done}/${batch!.total}` : ""}</span>
                </div>
                <Progress value={batchActive ? (batch!.done / Math.max(1, batch!.total)) * 100 : coverage} className="h-1.5" />
              </div>
            )}
            {items.length === 0 ? (
              <p className="py-2 text-center text-xs text-muted-foreground">{t("common.empty")}</p>
            ) : (
              <div className="grid gap-3 max-h-96 overflow-y-auto scrollbar-thin pr-1 sm:grid-cols-2">
                {items.map((item, i) => {
                  const key = `${cp.id}:${i}`;
                  const done = covered.has(i);
                  return (
                    <div key={key} className={`flex flex-col gap-2 rounded-xl border p-3 ${done ? "border-[var(--neon-2)]/35 bg-[var(--neon-2)]/5" : "border-border/60 bg-muted/20"}`}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {item.day != null && (
                          <span className="rounded-md px-2 py-0.5 text-[10px] font-bold text-[var(--neon)]" style={{ background: "color-mix(in oklab, var(--neon) 12%, transparent)" }}>
                            {t("planner.day", { n: item.day })}
                          </span>
                        )}
                        {item.platform && <span className="rounded border border-border/60 bg-background/40 px-1.5 py-0.5 text-[10px] font-medium">{item.platform}</span>}
                        {item.contentType && <span className="rounded border border-border/60 bg-background/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">{item.contentType}</span>}
                      </div>
                      <p className="text-sm font-medium leading-snug">{item.title ?? `#${i + 1}`}</p>
                      {item.hook && <p className="line-clamp-2 text-xs italic leading-snug text-muted-foreground">“{item.hook}”</p>}
                      {(item.pillar || item.goal) && (
                        <p className="text-[11px] text-muted-foreground">
                          {item.pillar && <><span className="font-medium text-[var(--neon-2)]">{t("planner.pillar")}:</span> {item.pillar} </>}
                          {item.goal && <><span className="font-medium text-[var(--neon-3)]">{t("planner.goal")}:</span> {item.goal}</>}
                        </p>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-auto h-10 gap-1.5"
                        onClick={() => createItemFromPlan(cp.id, i)}
                        disabled={creatingItem === key || done || batchBusy}
                        aria-label={t("planner.createItem")}
                      >
                        {creatingItem === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : done ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--neon-2)]" /> : <Wand2 className="h-3.5 w-3.5" />}
                        {done ? t("planner.itemExists") : t("planner.createItem")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  // ---------- main render ----------
  return (
    <div className="grid gap-5">
      {/* header */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl font-semibold sm:text-2xl">{t("planner.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("planner.subtitle")}</p>
      </motion.section>

      {/* controls */}
      <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="glass rounded-2xl">
          <CardContent className="grid gap-4 p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,260px)_1fr] sm:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="pl-brand">{t("planner.brand")}</Label>
                <Select
                  value={activeBrandId ?? ""}
                  onValueChange={(v) => setActiveBrand(v)}
                >
                  <SelectTrigger id="pl-brand" className="h-11">
                    <SelectValue placeholder={t("planner.pickBrand")} />
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={generatePlan}
                  disabled={!activeBrandId || generating}
                  className="h-11 gap-2 neon-border"
                  aria-label={t("planner.generate")}
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />}
                  {generating ? t("planner.generating") : plan ? t("common.regenerate") : t("planner.generate")}
                </Button>
                <Button
                  variant="outline"
                  onClick={generateContentPlan}
                  disabled={!activeBrandId || generatingContent}
                  className="h-11 gap-2"
                  aria-label={t("planner.generateContent")}
                >
                  {generatingContent ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileStack className="h-4 w-4" />}
                  {generatingContent ? t("planner.generatingContent") : t("planner.generateContent")}
                </Button>
                <p className="text-xs text-muted-foreground" role="note">{t("planner.generateHint")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.section>

      {/* no brand */}
      {!activeBrandId ? (
        <Card className="glass rounded-2xl">
          <CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="rounded-2xl p-3" style={{ background: "color-mix(in oklab, var(--neon) 15%, transparent)" }}>
              <CalendarRange className="h-7 w-7 text-[var(--neon)]" />
            </span>
            <p className="max-w-md text-sm text-muted-foreground" role="note">{t("planner.noBrand")}</p>
          </CardContent>
        </Card>
      ) : plansLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl bg-muted/40" />)}
        </div>
      ) : (
        <>
          {/* plan header */}
          {plan ? (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-strong flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold sm:text-lg">{t("planner.planTitle")}</h2>
                <Badge variant="secondary" className="text-[10px]">{t("planner.version", { v: plan.version })}</Badge>
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  style={
                    plan.status === "APPROVED"
                      ? { color: "var(--neon-2)", borderColor: "color-mix(in oklab, var(--neon-2) 45%, transparent)", background: "color-mix(in oklab, var(--neon-2) 12%, transparent)" }
                      : { color: "var(--neon-3)", borderColor: "color-mix(in oklab, var(--neon-3) 45%, transparent)", background: "color-mix(in oklab, var(--neon-3) 12%, transparent)" }
                  }
                >
                  {t(`planner.status.${plan.status}` as const)}
                </Badge>
              </div>
              {plan.status !== "APPROVED" && (
                <Button onClick={approvePlan} disabled={approving} className="h-10 gap-2" aria-label={t("planner.approve")}>
                  {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {t("planner.approve")}
                </Button>
              )}
            </motion.section>
          ) : (
            <Card className="glass rounded-2xl">
              <CardContent className="p-6 text-center text-sm text-muted-foreground" role="note">{t("planner.noPlan")}</CardContent>
            </Card>
          )}

          {/* sections grid */}
          {plan && (
            <div className="grid gap-4 md:grid-cols-2">
              {SECTION_KEYS.map((key, idx) => {
                const Icon = SECTION_ICON[key];
                const locked = lockedSections.includes(key);
                const isEditing = editing === key;
                return (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx * 0.03, 0.2) }}
                    className={key === "weekly" ? "md:col-span-2" : undefined}
                  >
                    <Card className={`glass h-full rounded-2xl ${locked ? "opacity-90" : ""}`}>
                      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                          <Icon className="h-4 w-4" style={{ color: SECTION_NEON[key] }} />
                          {t(`planner.section.${key}` as const)}
                          {locked && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{ background: "color-mix(in oklab, var(--neon-3) 14%, transparent)", color: "var(--neon-3)" }}
                            >
                              <Lock className="h-3 w-3" /> {t("planner.locked")}
                            </span>
                          )}
                        </CardTitle>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9"
                            onClick={() => toggleLock(key)}
                            disabled={locking === key}
                            aria-label={locked ? t("planner.unlock") : t("planner.lock")}
                            title={locked ? t("planner.unlock") : t("planner.lock")}
                          >
                            {locking === key ? <Loader2 className="h-4 w-4 animate-spin" /> : locked ? <Lock className="h-4 w-4 text-[var(--neon-3)]" /> : <LockOpen className="h-4 w-4 text-muted-foreground" />}
                          </Button>
                          {!isEditing && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9"
                              onClick={() => { setEditing(key); setEditText(encodeSection(key, sectionRaw(plan, key))); }}
                              disabled={locked}
                              aria-label={t("planner.edit")}
                              title={locked ? t("planner.lockedHint") : t("planner.edit")}
                            >
                              <Pencil className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="grid gap-3">
                        {isEditing ? (
                          <>
                            <Textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              className="min-h-40 font-mono text-xs"
                              aria-label={t(`planner.section.${key}` as const)}
                            />
                            <p className="text-[11px] text-muted-foreground" role="note">{t("planner.editHint")}</p>
                            <div className="flex items-center justify-end gap-2">
                              <Button variant="ghost" className="h-10" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
                              <Button className="h-10 gap-1.5" onClick={() => saveSection(key)} disabled={savingSection === key}>
                                {savingSection === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                {t("common.save")}
                              </Button>
                            </div>
                          </>
                        ) : key === "weekly" && plan.cadence ? (
                          <div className="grid gap-3">
                            {renderBody(key)}
                            <p className="flex items-center gap-1.5 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                              <Repeat className="h-3 w-3" /> {t("planner.cadence")}: {plan.cadence}
                            </p>
                          </div>
                        ) : (
                          renderBody(key)
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* content plans */}
          <section aria-label={t("planner.contentPlan")} className="grid gap-4">
            <h2 className="flex items-center gap-2 text-sm font-medium tracking-wide text-muted-foreground">
              <Sparkles className="h-4 w-4 text-[var(--neon-2)]" /> {t("planner.contentPlan")}
            </h2>
            {contentPlans.length === 0 ? (
              <Card className="glass rounded-2xl">
                <CardContent className="p-6 text-center text-sm text-muted-foreground" role="note">{t("planner.noContentPlan")}</CardContent>
              </Card>
            ) : (
              contentPlans.map((cp, i) => renderContentPlan(cp, i))
            )}
          </section>
        </>
      )}
    </div>
  );
}
