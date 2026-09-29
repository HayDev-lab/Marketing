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
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Settings2, Bot, ScrollText, Wallet, RefreshCw, Loader2, Activity,
  ShieldCheck, ShieldAlert, ShieldX, CircleHelp, Zap, Sparkles, CheckCircle2, TriangleAlert, ListChecks, Eye,
} from "lucide-react";

// ===== types =====
type ProviderStatus = "LIVE_VERIFIED" | "IMPLEMENTED_NOT_LIVE_VERIFIED" | "DEGRADED" | "DISABLED" | "BLOCKED_EXTERNAL";

interface Provider {
  providerId: string; title: string; category: string; capabilities: string[];
  models: { id: string; title: string }[]; requiresExternalKey: boolean;
  supportsHealthCheck?: boolean; statusNote: string | null;
  enabled: boolean; status: ProviderStatus; defaultModel: string | null;
  lastHealthAt?: string | null; lastHealthOk?: boolean | null;
}

interface Policy {
  enabled: boolean; trendDiscovery: boolean; autoPlanning: boolean; autoGeneration: boolean;
  paidGeneration: boolean; autoScheduling: boolean; autoPublishing: boolean; humanApproval: boolean;
  platformsJson: string | null; languagesJson: string | null; forbiddenTopicsJson: string | null; forbiddenClaimsJson: string | null;
  dailyBudget: number; weeklyBudget: number; monthlyBudget: number; maxGenerationCost: number;
  maxRetries: number; maxContentPerDay: number; minQualityThreshold: number;
}

interface AuditLog {
  id: string; actorType: string; action: string; summary: string | null; createdAt: string;
}

interface Usage {
  today: number; week: number; month: number; total: number;
  byProvider: { provider: string; cost: number }[];
  byCapability: { capability: string; cost: number }[];
}

interface BrandLite { id: string; name: string }

interface CycleResult {
  steps: string[]; contentItemId: string | null; trendAdapted: string | null;
  humanApprovalRequired: boolean; note: string;
}

function parseArr(json: string | null | undefined): string[] {
  try { const v = JSON.parse(json ?? "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

function statusBadge(status: ProviderStatus): { style?: React.CSSProperties; className?: string } {
  switch (status) {
    case "LIVE_VERIFIED":
      return { style: { background: "color-mix(in oklab, var(--neon-2) 16%, transparent)", color: "var(--neon-2)", borderColor: "color-mix(in oklab, var(--neon-2) 40%, transparent)" } };
    case "IMPLEMENTED_NOT_LIVE_VERIFIED":
      return { style: { background: "color-mix(in oklab, var(--neon-3) 16%, transparent)", color: "var(--neon-3)", borderColor: "color-mix(in oklab, var(--neon-3) 40%, transparent)" } };
    case "DEGRADED":
      return { className: "bg-destructive/15 text-destructive border-destructive/40" };
    default:
      return { className: "bg-muted/40 text-muted-foreground border-border" };
  }
}

function statusIcon(status: ProviderStatus) {
  switch (status) {
    case "LIVE_VERIFIED": return <ShieldCheck className="h-3.5 w-3.5" aria-hidden />;
    case "IMPLEMENTED_NOT_LIVE_VERIFIED": return <ShieldAlert className="h-3.5 w-3.5" aria-hidden />;
    case "DEGRADED": return <ShieldX className="h-3.5 w-3.5" aria-hidden />;
    default: return <CircleHelp className="h-3.5 w-3.5" aria-hidden />;
  }
}

const CATEGORY_ORDER = ["LLM", "Research", "Image", "Video", "TTS", "VoiceClone", "Music", "Avatar", "Transcription", "Publishing"];
const POLICY_BOOLEANS = ["enabled", "trendDiscovery", "autoPlanning", "autoGeneration", "paidGeneration", "autoScheduling", "autoPublishing", "humanApproval"] as const;
const PLATFORM_CHIPS = ["instagram", "tiktok", "facebook", "telegram"];
const LANG_CHIPS = ["hy", "ru", "en"];
const ACTOR_FILTERS = ["ALL", "WEB_UI", "MCP", "AUTOPILOT", "SYSTEM"] as const;

// ===== main module =====
export function SettingsModule(_props: { onBrandsChanged?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-5">
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-strong neon-border rounded-2xl p-5 sm:p-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
          <Settings2 className="h-5 w-5 text-[var(--neon)]" aria-hidden /> {t("settings.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </motion.section>

      <Tabs defaultValue="providers" className="gap-4">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/30 p-1">
          <TabsTrigger value="providers" className="min-h-11 gap-1.5 px-3"><Activity className="h-4 w-4" aria-hidden /> {t("settings.tab.providers")}</TabsTrigger>
          <TabsTrigger value="autopilot" className="min-h-11 gap-1.5 px-3"><Bot className="h-4 w-4" aria-hidden /> {t("settings.tab.autopilot")}</TabsTrigger>
          <TabsTrigger value="audit" className="min-h-11 gap-1.5 px-3"><ScrollText className="h-4 w-4" aria-hidden /> {t("settings.tab.audit")}</TabsTrigger>
          <TabsTrigger value="budget" className="min-h-11 gap-1.5 px-3"><Wallet className="h-4 w-4" aria-hidden /> {t("settings.tab.budget")}</TabsTrigger>
        </TabsList>
        <TabsContent value="providers"><ProvidersTab /></TabsContent>
        <TabsContent value="autopilot"><AutopilotTab /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
        <TabsContent value="budget"><BudgetTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ===== Providers tab =====
function ProvidersTab() {
  const { t } = useI18n();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [checking, setChecking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProviders(await api<Provider[]>("/api/settings/providers"));
    } catch {
      setProviders([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (p: Provider, enabled: boolean) => {
    try {
      await api("/api/settings/providers", { method: "PATCH", body: JSON.stringify({ providerId: p.providerId, enabled }) });
      setProviders((prev) => (prev ?? []).map((x) => (x.providerId === p.providerId ? { ...x, enabled } : x)));
      toast.success(`${p.title}: ${enabled ? t("common.approve") : t("settings.status.DISABLED")}`);
    } catch (e) {
      // 423 BLOCKED_EXTERNAL — honest refusal, provider stays disabled
      toast.error(t("settings.blockedNote"), { description: (e as Error).message });
    }
  };

  const healthCheck = async (p: Provider) => {
    setChecking(p.providerId);
    try {
      const res = await api<{ ok: boolean; latencyMs: number; reason: string | null; newStatus: ProviderStatus }>(
        "/api/settings/providers", { method: "POST", body: JSON.stringify({ providerId: p.providerId }) }
      );
      setProviders((prev) => (prev ?? []).map((x) => (x.providerId === p.providerId ? { ...x, status: res.newStatus, lastHealthAt: new Date().toISOString(), lastHealthOk: res.ok } : x)));
      if (res.ok) toast.success(t("settings.healthOk", { ms: res.latencyMs }));
      else toast.warning(t("settings.healthFail", { reason: res.reason ?? "unknown" }));
    } catch (e) {
      toast.error(t("settings.healthFail", { reason: (e as Error).message }));
    } finally {
      setChecking(null);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, Provider[]>();
    for (const p of providers ?? []) {
      const arr = map.get(p.category) ?? [];
      arr.push(p);
      map.set(p.category, arr);
    }
    const cats = [...map.keys()].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return cats.map((c) => ({ category: c, providers: map.get(c) ?? [] }));
  }, [providers]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("settings.providersDesc")}</p>
        <Button variant="outline" size="sm" className="min-h-11" onClick={load} aria-label={t("content.refresh")}>
          <RefreshCw className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {!providers ? (
        <div className="grid gap-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl bg-muted/40" />)}</div>
      ) : (
        grouped.map(({ category, providers: list }) => (
          <Card key={category} className="glass rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{t(`settings.cat.${category}`)}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {list.map((p) => {
                const accent = statusBadge(p.status);
                const row = (
                  <div key={p.providerId} className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{p.title}</p>
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className={`cursor-help gap-1 text-[10px] ${accent.className ?? ""}`} style={accent.style}>
                                {statusIcon(p.status)} {t(`settings.status.${p.status}`)}
                              </Badge>
                            </TooltipTrigger>
                            {p.statusNote && (
                              <TooltipContent className="max-w-72 text-xs"><p>{p.statusNote}</p></TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {p.providerId} · {t("settings.models", { n: p.models.length })}
                        {p.lastHealthAt ? ` · ${t("settings.lastHealth", { time: new Date(p.lastHealthAt).toLocaleString() })}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {p.status !== "BLOCKED_EXTERNAL" ? (
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={p.enabled}
                            onCheckedChange={(v) => toggle(p, v)}
                            aria-label={`${p.title}: ${t("settings.status.DISABLED")} / ${t("common.approve")}`}
                          />
                          <Button size="sm" variant="outline" className="min-h-11" disabled={checking === p.providerId} onClick={() => healthCheck(p)}>
                            {checking === p.providerId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Zap className="h-4 w-4 text-[var(--neon-3)]" aria-hidden />}
                            {checking === p.providerId ? t("settings.checking") : t("settings.healthCheck")}
                          </Button>
                        </div>
                      ) : (
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex cursor-not-allowed items-center gap-2 text-[11px] text-muted-foreground" aria-disabled>
                                <Switch checked={false} disabled aria-label={t("settings.blockedNote")} />
                                <TriangleAlert className="h-4 w-4 text-[var(--neon-3)]" aria-hidden />
                                <span className="hidden sm:inline">{t("settings.blockedNote")}</span>
                              </div>
                            </TooltipTrigger>
                            {p.statusNote && <TooltipContent className="max-w-72 text-xs"><p>{p.statusNote}</p></TooltipContent>}
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </div>
                );
                return row;
              })}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

// ===== Autopilot tab =====
function AutopilotTab() {
  const { t } = useI18n();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [cycles, setCycles] = useState<AuditLog[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [forbiddenTopics, setForbiddenTopics] = useState("");
  const [forbiddenClaims, setForbiddenClaims] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [brandId, setBrandId] = useState("");
  const [result, setResult] = useState<CycleResult | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ policy: Policy; cycles: AuditLog[] }>("/api/autopilot");
      setPolicy(data.policy);
      setCycles(data.cycles);
      setPlatforms(parseArr(data.policy.platformsJson));
      setLanguages(parseArr(data.policy.languagesJson));
      setForbiddenTopics(parseArr(data.policy.forbiddenTopicsJson).join(", "));
      setForbiddenClaims(parseArr(data.policy.forbiddenClaimsJson).join(", "));
    } catch {
      // honest empty state
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadBrands = useCallback(async () => {
    try {
      setBrands(await api<BrandLite[]>("/api/brands"));
    } catch {
      setBrands([]);
    }
  }, []);

  useEffect(() => { loadBrands(); }, [loadBrands]);

  const save = async () => {
    if (!policy) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        platforms,
        languages,
        forbiddenTopics: forbiddenTopics.split(",").map((s) => s.trim()).filter(Boolean),
        forbiddenClaims: forbiddenClaims.split(",").map((s) => s.trim()).filter(Boolean),
      };
      for (const b of POLICY_BOOLEANS) body[b] = policy[b];
      body.dailyBudget = Number(policy.dailyBudget) || 0;
      body.weeklyBudget = Number(policy.weeklyBudget) || 0;
      body.monthlyBudget = Number(policy.monthlyBudget) || 0;
      body.maxGenerationCost = Number(policy.maxGenerationCost) || 0;
      body.maxRetries = Math.max(0, Math.floor(Number(policy.maxRetries) || 0));
      body.maxContentPerDay = Math.max(0, Math.floor(Number(policy.maxContentPerDay) || 0));
      body.minQualityThreshold = Math.min(1, Math.max(0, Number(policy.minQualityThreshold) || 0));
      await api("/api/autopilot", { method: "PATCH", body: JSON.stringify(body) });
      toast.success(t("autopilot.saved"));
      await load();
    } catch (e) {
      toast.error(t("common.error"), { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const runCycle = async () => {
    if (!brandId) {
      toast.warning(t("autopilot.brandRequired"));
      return;
    }
    setRunning(true);
    try {
      const res = await api<CycleResult>("/api/autopilot", { method: "POST", body: JSON.stringify({ brandId }) });
      setResult(res);
      await load();
    } catch (e) {
      const code = (e as { code?: string }).code;
      toast.error(code === "AUTOPILOT_DISABLED" ? t("autopilot.err.AUTOPILOT_DISABLED") : code === "BRAND_NOT_ALLOWED" ? t("autopilot.err.BRAND_NOT_ALLOWED") : t("autopilot.err.default"), { description: (e as Error).message });
    } finally {
      setRunning(false);
    }
  };

  const toggleChip = (list: string[], v: string, setter: (l: string[]) => void) => {
    setter(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  };

  const numField = (id: string, label: string, value: number, onChange: (v: number) => void, step = "1") => (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type="number" min={0} step={step} className="min-h-11" value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );

  if (!policy) {
    return <div className="grid gap-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl bg-muted/40" />)}</div>;
  }

  return (
    <div className="grid gap-4">
      <Card className="glass rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4 text-[var(--neon)]" aria-hidden /> {t("autopilot.title")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("autopilot.desc")}</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* switches */}
          <div className="grid gap-3 sm:grid-cols-2">
            {POLICY_BOOLEANS.map((b) => (
              <div key={b} className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 p-3">
                <div className="min-w-0">
                  <Label htmlFor={`ap-${b}`} className="text-sm font-medium">{t(`autopilot.b.${b}`)}</Label>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{t(`autopilot.d.${b}`)}</p>
                </div>
                <Switch
                  id={`ap-${b}`}
                  checked={policy[b]}
                  onCheckedChange={(v) => setPolicy({ ...policy, [b]: v })}
                  className="mt-0.5 shrink-0"
                />
              </div>
            ))}
          </div>

          {/* budgets */}
          <section aria-label={t("autopilot.budgets")} className="grid gap-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("autopilot.budgets")}</h3>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {numField("ap-daily", t("autopilot.dailyBudget"), policy.dailyBudget, (v) => setPolicy({ ...policy, dailyBudget: v }), "0.5")}
              {numField("ap-weekly", t("autopilot.weeklyBudget"), policy.weeklyBudget, (v) => setPolicy({ ...policy, weeklyBudget: v }), "0.5")}
              {numField("ap-monthly", t("autopilot.monthlyBudget"), policy.monthlyBudget, (v) => setPolicy({ ...policy, monthlyBudget: v }), "0.5")}
              {numField("ap-maxgen", t("autopilot.maxGenerationCost"), policy.maxGenerationCost, (v) => setPolicy({ ...policy, maxGenerationCost: v }), "0.05")}
              {numField("ap-retries", t("autopilot.maxRetries"), policy.maxRetries, (v) => setPolicy({ ...policy, maxRetries: v }))}
              {numField("ap-maxday", t("autopilot.maxContentPerDay"), policy.maxContentPerDay, (v) => setPolicy({ ...policy, maxContentPerDay: v }))}
              {numField("ap-quality", t("autopilot.minQualityThreshold"), policy.minQualityThreshold, (v) => setPolicy({ ...policy, minQualityThreshold: v }), "0.05")}
            </div>
          </section>

          {/* platforms + languages */}
          <div className="grid gap-3 sm:grid-cols-2">
            <section aria-label={t("autopilot.platforms")}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("autopilot.platforms")}</h3>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("autopilot.platforms")}>
                {PLATFORM_CHIPS.map((p) => {
                  const active = platforms.includes(p);
                  return (
                    <button key={p} type="button" onClick={() => toggleChip(platforms, p, setPlatforms)} aria-pressed={active}
                      className={`min-h-11 rounded-full border px-4 text-xs font-medium transition ${active ? "neon-border text-foreground" : "border-border/60 text-muted-foreground glass-hover"}`}>
                      {p}
                    </button>
                  );
                })}
              </div>
            </section>
            <section aria-label={t("autopilot.languages")}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("autopilot.languages")}</h3>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("autopilot.languages")}>
                {LANG_CHIPS.map((l) => {
                  const active = languages.includes(l);
                  return (
                    <button key={l} type="button" onClick={() => toggleChip(languages, l, setLanguages)} aria-pressed={active}
                      className={`min-h-11 rounded-full border px-4 text-xs font-medium transition ${active ? "neon-border text-foreground" : "border-border/60 text-muted-foreground glass-hover"}`}>
                      {t(`content.lang.${l}`)}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          {/* forbidden lists */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ap-topics" className="text-xs">{t("autopilot.forbiddenTopics")}</Label>
              <Input id="ap-topics" className="min-h-11" value={forbiddenTopics} onChange={(e) => setForbiddenTopics(e.target.value)} placeholder={t("autopilot.commaHint")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ap-claims" className="text-xs">{t("autopilot.forbiddenClaims")}</Label>
              <Input id="ap-claims" className="min-h-11" value={forbiddenClaims} onChange={(e) => setForbiddenClaims(e.target.value)} placeholder={t("autopilot.commaHint")} />
            </div>
          </div>

          <Button className="min-h-11 w-full sm:w-auto sm:justify-self-end" disabled={saving} onClick={save}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {t("autopilot.save")}
          </Button>
        </CardContent>
      </Card>

      {/* supervised cycle */}
      <Card className="glass rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-[var(--neon-3)]" aria-hidden /> {t("autopilot.runCycle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-1.5">
              <Label className="text-xs">{t("autopilot.selectBrand")}</Label>
              <Select value={brandId} onValueChange={setBrandId}>
                <SelectTrigger className="min-h-11" aria-label={t("autopilot.selectBrand")}><SelectValue placeholder={t("autopilot.selectBrand")} /></SelectTrigger>
                <SelectContent>
                  {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button className="min-h-11" disabled={running} onClick={runCycle}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
              {running ? t("autopilot.running") : t("autopilot.runCycle")}
            </Button>
          </div>

          {result && (
            <div className="grid gap-3 rounded-xl border border-border/60 bg-muted/20 p-4">
              <h3 className="text-sm font-medium">{t("autopilot.cycleResult")}</h3>
              <ol className="grid gap-2">
                {result.steps.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold" style={{ background: "color-mix(in oklab, var(--neon) 16%, transparent)", color: "var(--neon)" }}>
                      {i + 1}
                    </span>
                    <span className="font-mono">{s}</span>
                  </li>
                ))}
                {result.steps.length === 0 && <li className="text-xs text-muted-foreground">—</li>}
              </ol>
              {result.humanApprovalRequired ? (
                <p className="flex items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--neon-2)_50%,transparent)] bg-[color-mix(in_oklab,var(--neon-2)_10%,transparent)] p-3 text-xs" role="status">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--neon-2)]" aria-hidden /> {t("autopilot.humanApprovalNote")}
                </p>
              ) : (
                <p className="flex items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--neon-3)_50%,transparent)] bg-[color-mix(in_oklab,var(--neon-3)_10%,transparent)] p-3 text-xs" role="alert">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--neon-3)]" aria-hidden /> {t("autopilot.noApprovalNote")}
                </p>
              )}
            </div>
          )}

          {/* recent cycles */}
          <section aria-label={t("autopilot.recentCycles")}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <ListChecks className="h-3.5 w-3.5" aria-hidden /> {t("autopilot.recentCycles")}
            </h3>
            {cycles.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("autopilot.noCycles")}</p>
            ) : (
              <ul className="max-h-44 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                {cycles.map((c) => (
                  <li key={c.id} className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">{c.action}</span>
                      <span className="text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
                    </div>
                    {c.summary && <p className="mt-0.5 truncate text-muted-foreground">{c.summary}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

// ===== Audit tab =====
function AuditTab() {
  const { t } = useI18n();
  const [actor, setActor] = useState<(typeof ACTOR_FILTERS)[number]>("ALL");
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const q = actor === "ALL" ? "" : `?actorType=${actor}`;
    api<AuditLog[]>(`/api/audit${q}`)
      .then((d) => { if (!cancelled) setLogs(d); })
      .catch(() => { if (!cancelled) setLogs([]); });
    return () => { cancelled = true; };
  }, [actor, reloadKey]);

  return (
    <Card className="glass rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollText className="h-4 w-4 text-[var(--neon)]" aria-hidden /> {t("settings.audit.title")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t("settings.audit.desc")}</p>
        <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label={t("settings.audit.title")}>
          {ACTOR_FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => { setActor(f); setLogs(null); }} aria-pressed={actor === f}
              className={`min-h-11 rounded-full border px-4 text-xs font-medium transition ${actor === f ? "neon-border text-foreground" : "border-border/60 text-muted-foreground glass-hover"}`}>
              {f === "ALL" ? t("common.all") : f}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="max-h-96 overflow-y-auto scrollbar-thin">
        {logs === null ? (
          <div className="grid gap-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl bg-muted/40" />)}</div>
        ) : logs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("settings.audit.empty")}</p>
        ) : (
          <ul className="grid gap-2">
            {logs.map((l) => (
              <li key={l.id} className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="outline" className="shrink-0 text-[10px]">{l.actorType}</Badge>
                    <span className="truncate font-mono text-xs">{l.action}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</span>
                </div>
                {l.summary && <p className="mt-1 truncate text-xs text-muted-foreground">{l.summary}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ===== Budget tab =====
function BudgetTab() {
  const { t } = useI18n();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [limits, setLimits] = useState<{ dailyBudget: number; weeklyBudget: number; monthlyBudget: number } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<Usage>("/api/costs"),
      api<{ policy: Pick<Policy, "dailyBudget" | "weeklyBudget" | "monthlyBudget"> }>("/api/autopilot"),
    ])
      .then(([u, ap]) => { if (!cancelled) { setUsage(u); setLimits(ap.policy); } })
      .catch(() => { if (!cancelled) setUsage(null); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  if (!usage) {
    return <div className="grid gap-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl bg-muted/40" />)}</div>;
  }

  const periods: { key: "today" | "week" | "month" | "total"; label: string; value: number; limit: number }[] = [
    { key: "today", label: t("settings.budget.today"), value: usage.today, limit: limits?.dailyBudget ?? 0 },
    { key: "week", label: t("settings.budget.week"), value: usage.week, limit: limits?.weeklyBudget ?? 0 },
    { key: "month", label: t("settings.budget.month"), value: usage.month, limit: limits?.monthlyBudget ?? 0 },
    { key: "total", label: t("settings.budget.total"), value: usage.total, limit: usage.total },
  ];
  const maxProvider = Math.max(0.0001, ...(usage.byProvider ?? []).map((p) => p.cost));
  const maxCapability = Math.max(0.0001, ...(usage.byCapability ?? []).map((p) => p.cost));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("settings.budget.desc")}</p>
        <Button variant="outline" size="sm" className="min-h-11" onClick={() => setReloadKey((k) => k + 1)} aria-label={t("content.refresh")}>
          <RefreshCw className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {/* per-period bars */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {periods.map((p) => {
          const pct = p.limit > 0 ? Math.min(100, (p.value / p.limit) * 100) : 100;
          return (
            <Card key={p.key} className="glass rounded-2xl">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{p.label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums neon-text">${p.value.toFixed(3)}</p>
                <Progress value={pct} className="mt-2 h-1.5" aria-label={`${p.label}: $${p.value.toFixed(3)}`} />
                {p.key !== "total" && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {p.limit > 0 ? t("settings.budget.limitLabel", { v: p.limit.toFixed(2) }) : "—"}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* breakdowns */}
      {usage.total === 0 ? (
        <Card className="glass rounded-2xl"><CardContent className="p-6 text-center text-sm text-muted-foreground">{t("settings.budget.noUsage")}</CardContent></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="glass rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{t("settings.budget.byProvider")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {(usage.byProvider ?? []).map((p) => (
                <div key={p.provider}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-mono">{p.provider}</span>
                    <span className="font-medium tabular-nums">${p.cost.toFixed(4)}</span>
                  </div>
                  <Progress value={(p.cost / maxProvider) * 100} className="h-1.5" aria-label={p.provider} />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="glass rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                <Eye className="h-3.5 w-3.5" aria-hidden /> {t("settings.budget.byCapability")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {(usage.byCapability ?? []).map((p) => (
                <div key={p.capability}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-mono">{p.capability}</span>
                    <span className="font-medium tabular-nums">${p.cost.toFixed(4)}</span>
                  </div>
                  <Progress value={(p.cost / maxCapability) * 100} className="h-1.5" aria-label={p.capability} />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
