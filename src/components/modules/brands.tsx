"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useApp, pulseCore } from "@/lib/store";
import { useI18n, api } from "@/lib/use-i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Building2, Globe, Plus, Sparkles, RefreshCw, Loader2, ExternalLink, Trash2,
  Cpu, UserRound, ShieldAlert, Lightbulb, Target, CircleCheck, StickyNote, Mic2, Layers,
} from "lucide-react";

// ---------- types (server API shapes) ----------
interface BrandProfileDto {
  version: number;
  summary: string | null;
  positioning: string | null;
  tone: string | null;
  usp: string | null;
  targetAudiences: string | null;
  priceInfo: string | null;
  opportunities: string | null;
  risks: string | null;
  contentOpportunities: string | null;
}
interface FactDto {
  id: string;
  kind: string; // SOURCE_FACT | AI_INFERENCE | USER_PROVIDED
  category: string;
  content: string;
  provenanceUrl: string | null;
  provenanceTitle: string | null;
  createdAt: string;
}
interface BrandListItem {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  industry: string | null;
  geography: string | null;
  stage: string; // DRAFT | ANALYZED | READY
  profile: BrandProfileDto | null;
  _count: { facts: number; contentItems: number };
}
interface BrandFull extends Omit<BrandListItem, "_count"> {
  facts: FactDto[];
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
function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const FACT_KINDS = ["SOURCE_FACT", "AI_INFERENCE", "USER_PROVIDED"] as const;
const FACT_KIND_STYLE: Record<string, { color: string; icon: typeof Globe }> = {
  SOURCE_FACT: { color: "var(--neon-2)", icon: Globe },
  AI_INFERENCE: { color: "var(--neon)", icon: Cpu },
  USER_PROVIDED: { color: "var(--neon-3)", icon: UserRound },
};
const FACT_CATEGORIES = ["product", "service", "audience", "pricing", "positioning", "tone", "geo", "other"] as const;

const STAGE_COLOR: Record<string, string> = {
  DRAFT: "var(--neon-3)",
  ANALYZED: "var(--neon)",
  READY: "var(--neon-2)",
};

// ---------- component ----------
export function BrandsModule(_props: { onBrandsChanged?: () => void }) {
  const { t } = useI18n();
  const activeBrandId = useApp((s) => s.activeBrandId);
  const setActiveBrand = useApp((s) => s.setActiveBrand);

  const [brands, setBrands] = useState<BrandListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<BrandFull | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // wizard
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [wName, setWName] = useState("");
  const [wDesc, setWDesc] = useState("");
  const [wSite, setWSite] = useState("");
  const [wMaterials, setWMaterials] = useState("");
  const [wSocial, setWSocial] = useState("");
  const [creating, setCreating] = useState(false);
  const [analyzingNew, setAnalyzingNew] = useState(false);

  // re-run analyzer + facts
  const [rerunning, setRerunning] = useState(false);
  const [factText, setFactText] = useState("");
  const [factCat, setFactCat] = useState<string>("other");
  const [addingFact, setAddingFact] = useState(false);

  const loadBrands = useCallback(async () => {
    try {
      const list = await api<BrandListItem[]>("/api/brands");
      setBrands(list);
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const full = await api<BrandFull>(`/api/brands/${id}`);
      setDetail(full);
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "BRAND_NOT_FOUND") {
        // Stale id (deleted brand / other account) — heal silently, no scary toast.
        useApp.getState().setActiveBrand(null);
      } else {
        toast.error(errMessage(e));
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBrands();
  }, [loadBrands]);

  useEffect(() => {
    if (activeBrandId) loadDetail(activeBrandId);
    else setDetail(null);
  }, [activeBrandId, loadDetail]);

  const refreshAll = useCallback(async () => {
    await loadBrands();
    if (activeBrandId) await loadDetail(activeBrandId);
  }, [loadBrands, loadDetail, activeBrandId]);

  // ---------- wizard ----------
  const openWizard = () => {
    setStep(1); setWName(""); setWDesc(""); setWSite(""); setWMaterials(""); setWSocial("");
    setWizardOpen(true);
  };

  const websiteLooksValid = (v: string) => v === "" || /^https?:\/\//.test(v);

  const createBrand = async (runAnalyzer: boolean) => {
    if (!wName.trim()) {
      toast.error(t("brands.nameRequired"));
      setStep(1);
      return;
    }
    if (!websiteLooksValid(wSite.trim())) {
      toast.error(t("brands.websiteInvalid"));
      setStep(2);
      return;
    }
    setCreating(true);
    try {
      const brand = await api<BrandListItem>("/api/brands", {
        method: "POST",
        body: JSON.stringify({
          name: wName.trim(),
          description: wDesc.trim() || undefined,
          website: wSite.trim() || undefined,
          socialProfiles: wSocial.trim() || undefined,
        }),
      });
      toast.success(t("brands.created"));
      setActiveBrand(brand.id);
      _props.onBrandsChanged?.();
      await loadBrands();

      if (runAnalyzer) {
        setAnalyzingNew(true);
        pulseCore("ANALYZING");
        try {
          const res = await api<{ factsCreated: number }>(`/api/brands/${brand.id}/analyze`, {
            method: "POST",
            body: JSON.stringify({ extraContext: wMaterials.trim() || undefined }),
          });
          pulseCore("SUCCESS");
          toast.success(t("brands.analyzed", { count: res.factsCreated }));
        } catch (e) {
          pulseCore("ERROR");
          toast.error(t("brands.analyzeFailed"), { description: errMessage(e) });
        } finally {
          setAnalyzingNew(false);
        }
      } else {
        pulseCore("SUCCESS");
      }
      setWizardOpen(false);
    } catch (e) {
      pulseCore("ERROR");
      toast.error(errMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const rerunAnalyzer = async () => {
    if (!detail) return;
    setRerunning(true);
    pulseCore("ANALYZING");
    try {
      const res = await api<{ factsCreated: number }>(`/api/brands/${detail.id}/analyze`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      pulseCore("SUCCESS");
      toast.success(t("brands.analyzed", { count: res.factsCreated }));
      await refreshAll();
    } catch (e) {
      pulseCore("ERROR");
      toast.error(t("brands.analyzeFailed"), { description: errMessage(e) });
    } finally {
      setRerunning(false);
    }
  };

  const addFact = async () => {
    if (!detail || !factText.trim()) return;
    setAddingFact(true);
    try {
      await api(`/api/brands/${detail.id}/facts`, {
        method: "POST",
        body: JSON.stringify({ content: factText.trim(), category: factCat, kind: "USER_PROVIDED" }),
      });
      toast.success(t("brands.factAdded"));
      setFactText("");
      await refreshAll();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setAddingFact(false);
    }
  };

  const deleteFact = async (factId: string) => {
    if (!detail) return;
    try {
      await api(`/api/brands/${detail.id}/facts?factId=${factId}`, { method: "DELETE" });
      toast.success(t("brands.factDeleted"));
      await refreshAll();
    } catch (e) {
      toast.error(errMessage(e));
    }
  };

  // duplicate detection: same normalized text within a brand (case/whitespace-insensitive)
  // returns Map<factId, groupSize> — only facts that belong to a duplicated group
  const dupeMap = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const groups = new Map<string, FactDto[]>();
    for (const f of detail?.facts ?? []) {
      const k = norm(f.content);
      if (!k) continue;
      const arr = groups.get(k) ?? [];
      arr.push(f);
      groups.set(k, arr);
    }
    const dupes = new Map<string, number>();
    for (const arr of groups.values()) {
      if (arr.length > 1) {
        // keep the newest fact, mark the older ones as duplicates
        const sorted = [...arr].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
        sorted.slice(1).forEach((f) => dupes.set(f.id, arr.length));
      }
    }
    return dupes;
  }, [detail?.facts]);
  const dupeIds = dupeMap;

  const dedupFacts = async () => {
    if (!detail || dupeMap.size === 0) {
      toast.info(t("brands.dedupNone"));
      return;
    }
    try {
      const ids = [...dupeMap.keys()];
      for (const id of ids) {
        await api(`/api/brands/${detail.id}/facts?factId=${id}`, { method: "DELETE" });
      }
      toast.success(t("brands.dedupDone", { count: ids.length }));
      await refreshAll();
    } catch (e) {
      toast.error(errMessage(e));
      await refreshAll();
    }
  };

  // ---------- derived ----------
  const uspList = parseJson<string[]>(detail?.profile?.usp, []);
  const opportunities = parseJson<string[]>(detail?.profile?.opportunities, []);
  const risks = parseJson<string[]>(detail?.profile?.risks, []);
  const contentOpps = parseJson<string[]>(detail?.profile?.contentOpportunities, []);
  const hasProfile = Boolean(detail?.profile?.summary || detail?.profile?.positioning);

  // ---------- render helpers ----------
  const stageBadge = (stage: string) => {
    const color = STAGE_COLOR[stage] ?? "var(--neon-3)";
    return (
      <Badge
        variant="outline"
        className="text-[10px]"
        style={{
          color,
          borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
          background: `color-mix(in oklab, ${color} 12%, transparent)`,
        }}
      >
        {t(`brands.stage.${stage}` as const)}
      </Badge>
    );
  };

  const chips = (items: string[], color: string, icon: typeof Target) => (
    <div className="flex flex-wrap gap-1.5">
      {items.map((c, i) => {
        const Icon = icon;
        return (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] leading-tight"
            style={{
              color,
              borderColor: `color-mix(in oklab, ${color} 35%, transparent)`,
              background: `color-mix(in oklab, ${color} 10%, transparent)`,
            }}
          >
            <Icon className="h-3 w-3 shrink-0" />
            {c}
          </span>
        );
      })}
    </div>
  );

  // ---------- wizard step content ----------
  const wizardStep = (
    <>
      {step === 1 && (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="w-name">{t("brands.name")}</Label>
            <Input
              id="w-name"
              value={wName}
              onChange={(e) => setWName(e.target.value)}
              placeholder={t("brands.namePlaceholder")}
              className="h-11"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="w-desc">{t("brands.description")}</Label>
            <Textarea
              id="w-desc"
              value={wDesc}
              onChange={(e) => setWDesc(e.target.value)}
              placeholder={t("brands.descriptionPlaceholder")}
              className="min-h-28"
            />
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="grid gap-2">
          <Label htmlFor="w-site">{t("brands.website")}</Label>
          <Input
            id="w-site"
            value={wSite}
            onChange={(e) => setWSite(e.target.value)}
            placeholder="https://example.com"
            className="h-11"
            type="url"
          />
          <p className="text-xs text-muted-foreground" role="note">{t("brands.websiteHint")}</p>
        </div>
      )}
      {step === 3 && (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="w-mat">{t("brands.materials")}</Label>
            <Textarea
              id="w-mat"
              value={wMaterials}
              onChange={(e) => setWMaterials(e.target.value)}
              placeholder={t("brands.materialsPlaceholder")}
              className="min-h-24"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="w-social">{t("brands.social")}</Label>
            <Input
              id="w-social"
              value={wSocial}
              onChange={(e) => setWSocial(e.target.value)}
              placeholder={t("brands.socialPlaceholder")}
              className="h-11"
            />
          </div>
        </div>
      )}
      {step === 4 && (
        <div className="grid gap-4">
          <div className="grid gap-2 rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
            <p><span className="text-muted-foreground">{t("brands.name")}:</span> <span className="font-medium">{wName}</span></p>
            {wDesc && <p className="line-clamp-3"><span className="text-muted-foreground">{t("brands.description")}:</span> {wDesc}</p>}
            <p><span className="text-muted-foreground">{t("brands.website")}:</span> {wSite || t("brands.noWebsite")}</p>
            {wSocial && <p><span className="text-muted-foreground">{t("brands.social")}:</span> {wSocial}</p>}
            {wMaterials && <p className="line-clamp-3"><span className="text-muted-foreground">{t("brands.materials")}:</span> {wMaterials}</p>}
          </div>
          <p className="text-xs text-muted-foreground" role="note">{t("brands.step4Hint")}</p>
        </div>
      )}
    </>
  );

  const busy = creating || analyzingNew;

  return (
    <div className="grid gap-5">
      {/* header */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{t("brands.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("brands.subtitle")}</p>
        </div>
        <Button onClick={openWizard} className="h-11 gap-2 neon-border" aria-label={t("brands.create")}>
          <Plus className="h-4 w-4" /> {t("brands.create")}
        </Button>
      </motion.section>

      {/* loading */}
      {loading ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_1fr]">
          <div className="grid content-start gap-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl bg-muted/40" />)}
          </div>
          <Skeleton className="h-72 rounded-2xl bg-muted/40" />
        </div>
      ) : brands.length === 0 ? (
        /* empty state */
        <motion.section
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-strong neon-border flex flex-col items-center gap-4 rounded-2xl px-6 py-14 text-center"
        >
          <span className="rounded-2xl p-4" style={{ background: "color-mix(in oklab, var(--neon) 15%, transparent)" }}>
            <Building2 className="h-10 w-10 text-[var(--neon)]" />
          </span>
          <h2 className="text-lg font-semibold">{t("brands.emptyTitle")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{t("brands.emptyDesc")}</p>
          <Button onClick={openWizard} className="mt-2 h-11 gap-2 neon-border">
            <Sparkles className="h-4 w-4" /> {t("brands.create")}
          </Button>
        </motion.section>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,340px)_1fr]">
          {/* brand list */}
          <section aria-label={t("brands.title")} className="grid content-start gap-3">
            {brands.map((b, i) => {
              const isActive = b.id === activeBrandId;
              return (
                <motion.button
                  key={b.id}
                  type="button"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => setActiveBrand(b.id)}
                  className={`glass glass-hover w-full rounded-2xl p-4 text-left ${isActive ? "neon-border" : ""}`}
                  aria-pressed={isActive}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                        style={{ background: "color-mix(in oklab, var(--neon) 15%, transparent)" }}
                      >
                        <Building2 className="h-4.5 w-4.5 text-[var(--neon)]" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{b.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {b.website ? b.website.replace(/^https?:\/\//, "") : t("brands.noWebsite")}
                        </p>
                      </div>
                    </div>
                    {stageBadge(b.stage)}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><StickyNote className="h-3 w-3" /> {b._count.facts} {t("brands.facts")}</span>
                      <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> {b._count.contentItems} {t("brands.content")}</span>
                    </div>
                    {isActive ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--neon-2)]">
                        <CircleCheck className="h-3.5 w-3.5" /> {t("brands.active")}
                      </span>
                    ) : (
                      <span
                        className="inline-flex h-8 items-center rounded-md border px-3 text-[11px] font-medium transition hover:bg-accent"
                        role="button"
                        tabIndex={0}
                        aria-label={`${t("brands.setActive")}: ${b.name}`}
                        onClick={(e) => { e.stopPropagation(); setActiveBrand(b.id); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setActiveBrand(b.id); } }}
                      >
                        {t("brands.setActive")}
                      </span>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </section>

          {/* detail */}
          <section aria-label={t("brands.profileTitle")} className="grid gap-5">
            {!activeBrandId ? (
              <Card className="glass rounded-2xl">
                <CardContent className="flex min-h-56 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  {t("brands.pickHint")}
                </CardContent>
              </Card>
            ) : detailLoading && !detail ? (
              <div className="grid gap-5">
                <Skeleton className="h-64 rounded-2xl bg-muted/40" />
                <Skeleton className="h-48 rounded-2xl bg-muted/40" />
              </div>
            ) : detail ? (
              <>
                {/* profile */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <Card className="glass rounded-2xl">
                    <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Sparkles className="h-4 w-4 text-[var(--neon)]" /> {t("brands.profileTitle")}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {detail.profile && (
                          <Badge variant="secondary" className="text-[10px]">
                            {t("brands.profileV", { v: detail.profile.version })}
                          </Badge>
                        )}
                        {stageBadge(detail.stage)}
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-4">
                      {hasProfile && detail.profile ? (
                        <>
                          {detail.profile.summary && (
                            <div>
                              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("brands.summary")}</p>
                              <p className="text-sm leading-relaxed">{detail.profile.summary}</p>
                            </div>
                          )}
                          <div className="grid gap-3 sm:grid-cols-2">
                            {detail.profile.positioning && (
                              <div>
                                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("brands.positioning")}</p>
                                <p className="text-sm leading-relaxed">{detail.profile.positioning}</p>
                              </div>
                            )}
                            {detail.profile.tone && (
                              <div>
                                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  <Mic2 className="h-3 w-3" /> {t("brands.tone")}
                                </p>
                                <p className="text-sm leading-relaxed">{detail.profile.tone}</p>
                              </div>
                            )}
                          </div>
                          {uspList.length > 0 && (
                            <div>
                              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("brands.usp")}</p>
                              {chips(uspList, "var(--neon)", Target)}
                            </div>
                          )}
                          {opportunities.length > 0 && (
                            <div>
                              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("brands.opportunities")}</p>
                              {chips(opportunities, "var(--neon-2)", Lightbulb)}
                            </div>
                          )}
                          {risks.length > 0 && (
                            <div>
                              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("brands.risks")}</p>
                              {chips(risks, "var(--neon-3)", ShieldAlert)}
                            </div>
                          )}
                          {contentOpps.length > 0 && (
                            <div>
                              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("brands.contentOpps")}</p>
                              {chips(contentOpps, "var(--neon)", Sparkles)}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground" role="note">{t("brands.notAnalyzed")}</p>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                        <p className="text-[11px] text-muted-foreground">{t("brands.rerunHint")}</p>
                        <Button
                          onClick={rerunAnalyzer}
                          disabled={rerunning}
                          className="h-10 gap-2"
                          variant="outline"
                          aria-label={t("brands.rerun")}
                        >
                          {rerunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          {rerunning ? t("brands.rerunning") : t("brands.rerun")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>

                {/* facts */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                  <Card className="glass rounded-2xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        <StickyNote className="h-4 w-4 text-[var(--neon-2)]" /> {t("brands.factsTitle")}
                        <Badge variant="secondary" className="text-[10px]">{detail.facts.length}</Badge>
                        {dupeIds.size > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="ml-auto h-8 gap-1.5 border-[color-mix(in_oklab,var(--neon-3)_45%,transparent)] text-[11px] text-[var(--neon-3)] hover:bg-[color-mix(in_oklab,var(--neon-3)_12%,transparent)]"
                            onClick={dedupFacts}
                          >
                            <Layers className="h-3.5 w-3.5" aria-hidden />
                            {t("brands.dedup")}
                          </Button>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4">
                      {/* add fact form */}
                      <form
                        className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center"
                        onSubmit={(e) => { e.preventDefault(); addFact(); }}
                      >
                        <Input
                          value={factText}
                          onChange={(e) => setFactText(e.target.value)}
                          placeholder={t("brands.addFact")}
                          className="h-11"
                          aria-label={t("brands.addFact")}
                        />
                        <Select value={factCat} onValueChange={setFactCat}>
                          <SelectTrigger className="h-11 w-full sm:w-40" aria-label={t("brands.factCategory")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FACT_CATEGORIES.map((c) => (
                              <SelectItem key={c} value={c}>{t(`brands.cat.${c}` as const)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button type="submit" className="h-11 gap-1.5" disabled={addingFact || !factText.trim()}>
                          {addingFact ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                          {t("brands.addFactBtn")}
                        </Button>
                      </form>

                      {detail.facts.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">{t("brands.noFacts")}</p>
                      ) : (
                        <div className="grid max-h-96 gap-4 overflow-y-auto scrollbar-thin pr-1">
                          {FACT_KINDS.filter((k) => detail.facts.some((f) => f.kind === k)).map((kind) => {
                            const style = FACT_KIND_STYLE[kind];
                            const Icon = style.icon;
                            const items = detail.facts.filter((f) => f.kind === kind);
                            return (
                              <div key={kind}>
                                <p
                                  className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide"
                                  style={{ color: style.color }}
                                >
                                  <Icon className="h-3.5 w-3.5" /> {t(`brands.kind.${kind}` as const)}
                                  <span className="text-muted-foreground">· {items.length}</span>
                                </p>
                                <ul className="grid gap-2">
                                  {items.map((f) => (
                                    <li key={f.id} className={`rounded-xl border px-3 py-2.5 ${dupeMap.has(f.id) ? "border-[color-mix(in_oklab,var(--neon-3)_45%,transparent)] bg-[color-mix(in_oklab,var(--neon-3)_7%,transparent)]" : "border-border/60 bg-muted/20"}`}>
                                      <div className="flex items-start justify-between gap-2">
                                        <p className="text-sm leading-snug">{f.content}</p>
                                        <div className="flex shrink-0 items-center gap-1">
                                          {dupeMap.has(f.id) && (
                                            <span
                                              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                                              style={{
                                                color: "var(--neon-3)",
                                                background: "color-mix(in oklab, var(--neon-3) 14%, transparent)",
                                              }}
                                              title={t("brands.dupes")}
                                            >
                                              ×{dupeMap.get(f.id)}
                                            </span>
                                          )}
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                            onClick={() => deleteFact(f.id)}
                                            aria-label={`${t("common.delete")}: ${f.content.slice(0, 40)}`}
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </Button>
                                        </div>
                                      </div>
                                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                        <span
                                          className="rounded px-1.5 py-0.5"
                                          style={{ background: `color-mix(in oklab, ${style.color} 12%, transparent)`, color: style.color }}
                                        >
                                          {t(`brands.cat.${FACT_CATEGORIES.includes(f.category as (typeof FACT_CATEGORIES)[number]) ? f.category : "other"}` as const)}
                                        </span>
                                        {f.kind === "SOURCE_FACT" && f.provenanceUrl && (
                                          <a
                                            href={f.provenanceUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                                            style={{ color: "var(--neon-2)" }}
                                          >
                                            <ExternalLink className="h-3 w-3" />
                                            {f.provenanceTitle || t("brands.provenance")}
                                          </a>
                                        )}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              </>
            ) : null}
          </section>
        </div>
      )}

      {/* create wizard dialog */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="glass-strong max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--neon)]" /> {t("brands.wizardTitle")}
            </DialogTitle>
            <DialogDescription>{t("brands.wizardDesc")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t("brands.step", { step })}</span>
                <span>{step * 25}%</span>
              </div>
              <Progress value={step * 25} className="h-1.5" />
            </div>
            <h3 className="text-sm font-semibold">{t(`brands.step${step}Title` as const)}</h3>
            {wizardStep}
          </div>

          <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
            <Button
              variant="ghost"
              className="h-10"
              onClick={() => (step > 1 ? setStep(step - 1) : setWizardOpen(false))}
              disabled={busy}
            >
              {step > 1 ? t("common.back") : t("common.cancel")}
            </Button>
            {step < 4 ? (
              <Button
                className="h-10 min-w-24"
                onClick={() => {
                  if (step === 1 && !wName.trim()) { toast.error(t("brands.nameRequired")); return; }
                  if (step === 2 && !websiteLooksValid(wSite.trim())) { toast.error(t("brands.websiteInvalid")); return; }
                  setStep(step + 1);
                }}
              >
                {t("common.next")}
              </Button>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="outline" className="h-10" onClick={() => createBrand(false)} disabled={busy}>
                  {t("brands.createOnly")}
                </Button>
                <Button className="h-10 gap-2 neon-border" onClick={() => createBrand(true)} disabled={busy}>
                  {analyzingNew ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {analyzingNew ? t("brands.rerunning") : t("brands.runAnalyzer")}
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
