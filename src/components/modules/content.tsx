"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { useI18n, api } from "@/lib/use-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileStack, Instagram, Music2, Facebook, Send, RefreshCw, Search, History,
  ImageIcon, Film, AudioLines, Trash2, Loader2, ShieldCheck, CircleAlert, CheckCircle2, Globe,
  Package, Copy, FileDown, FileJson,
} from "lucide-react";

// ===== types =====
export type ApprovalState =
  | "DRAFT" | "GENERATING" | "READY_FOR_REVIEW" | "CHANGES_REQUESTED"
  | "APPROVED" | "SCHEDULED" | "PUBLISHED" | "FAILED";

export interface ContentItem {
  id: string;
  brandId: string;
  title: string;
  platform: string;
  language: string;
  contentType: string;
  hook: string | null;
  script: string | null;
  caption: string | null;
  hashtags: string | null;
  approvalState: ApprovalState;
  assetId: string | null;
  videoProjectId: string | null;
  contentVersion: number;
  updatedAt: string;
}

interface MediaAsset { id: string; kind: string; filename: string; mimeType: string }

interface VideoScene { id: string; order: number; text?: string | null; narration?: string | null }

interface ContentDetail extends ContentItem {
  asset: MediaAsset | null;
  videoProject: { id: string; scenes: VideoScene[] } | null;
}

interface ApprovalEvent {
  id: string; fromState: string; toState: string; actorType: string; note: string | null; createdAt: string;
}

interface BrandLite { id: string; name: string }

const STATES: ApprovalState[] = ["DRAFT", "GENERATING", "READY_FOR_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED", "FAILED"];
const PLATFORMS = ["instagram", "tiktok", "facebook", "telegram"];
const LANGS = ["hy", "ru", "en"];
const TYPES = ["IMAGE_POST", "VIDEO_REEL", "STORY", "CAROUSEL", "POST"];

// Honest color-coding: emerald=approved flow, amber=attention, red=problem, fuchsia=in-flight
function stateAccent(s: ApprovalState): { style: React.CSSProperties; className?: string } {
  switch (s) {
    case "APPROVED":
      return { style: { background: "color-mix(in oklab, var(--neon-2) 16%, transparent)", color: "var(--neon-2)", borderColor: "color-mix(in oklab, var(--neon-2) 40%, transparent)" } };
    case "PUBLISHED":
      return { style: { background: "color-mix(in oklab, var(--neon-2) 26%, transparent)", color: "var(--neon-2)", borderColor: "color-mix(in oklab, var(--neon-2) 55%, transparent)" } };
    case "SCHEDULED":
      return { style: { background: "color-mix(in oklab, var(--neon) 16%, transparent)", color: "var(--neon)", borderColor: "color-mix(in oklab, var(--neon) 40%, transparent)" } };
    case "GENERATING":
      return { style: { background: "color-mix(in oklab, var(--neon-3) 14%, transparent)", color: "var(--neon-3)", borderColor: "color-mix(in oklab, var(--neon-3) 40%, transparent)" } };
    case "READY_FOR_REVIEW":
      return { style: { background: "color-mix(in oklab, var(--neon-3) 22%, transparent)", color: "var(--neon-3)", borderColor: "color-mix(in oklab, var(--neon-3) 55%, transparent)" } };
    case "CHANGES_REQUESTED":
    case "FAILED":
      return { style: {}, className: "bg-destructive/15 text-destructive border-destructive/40" };
    default:
      return { style: {}, className: "bg-muted/40 text-muted-foreground border-border" };
  }
}

export function StateBadge({ state }: { state: ApprovalState }) {
  const { t } = useI18n();
  const a = stateAccent(state);
  return (
    <Badge variant="outline" className={`shrink-0 text-[10px] ${a.className ?? ""}`} style={a.style}>
      {t(`content.state.${state}`)}
    </Badge>
  );
}

export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const cls = className ?? "h-3.5 w-3.5";
  switch (platform) {
    case "instagram": return <Instagram className={cls} aria-hidden />;
    case "tiktok": return <Music2 className={cls} aria-hidden />;
    case "facebook": return <Facebook className={cls} aria-hidden />;
    case "telegram": return <Send className={cls} aria-hidden />;
    default: return <Globe className={cls} aria-hidden />;
  }
}

function errText(e: unknown, fallback: string, known: string[], tr: (k: string) => string): string {
  const code = (e as { code?: string })?.code ?? "";
  return known.includes(code) ? tr(`content.err.${code}`) : tr(fallback);
}

// ---------- content package export ----------
function buildMarkdown(d: ContentDetail, brandName: string): string {
  const assetUrl = d.asset ? `${window.location.origin}/api/assets/${d.asset.id}/raw` : null;
  const lines: string[] = [
    `# ${d.title}`,
    "",
    `- **Brand:** ${brandName || "—"}`,
    `- **Platform:** ${d.platform}`,
    `- **Type:** ${d.contentType}`,
    `- **Language:** ${d.language}`,
    `- **State:** ${d.approvalState}`,
    `- **Version:** v${d.contentVersion}`,
    `- **Updated:** ${new Date(d.updatedAt).toISOString()}`,
    "",
  ];
  if (d.hook) lines.push("## Hook", "", d.hook, "");
  if (d.caption) lines.push("## Caption", "", d.caption, "");
  if (d.hashtags) lines.push("## Hashtags", "", d.hashtags, "");
  if (d.script) lines.push("## Script", "", d.script, "");
  if (d.videoProject?.scenes?.length) {
    lines.push("## Video scenes", "");
    d.videoProject.scenes
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((s, i) => lines.push(`${i + 1}. ${s.text ?? s.narration ?? ""}`));
    lines.push("");
  }
  if (assetUrl) lines.push(`## Media`, "", `${d.asset?.filename ?? "asset"} (${d.asset?.mimeType ?? ""}) — ${assetUrl}`, "");
  lines.push("---", "", `Exported from ՀայDev Marketing — ${new Date().toISOString()}`);
  return lines.join("\n");
}

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function safeFileStem(s: string): string {
  return (s || "content").toLowerCase().replace(/[^a-z0-9\u0561-\u0587\u0430-\u044f]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "content";
}

// ===== main module =====
export function ContentModule(_props: { onBrandsChanged?: () => void }) {
  const { t } = useI18n();
  const activeBrandId = useApp((s) => s.activeBrandId);

  const [items, setItems] = useState<ContentItem[]>([]);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<ApprovalState | null>(null);
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [query, setQuery] = useState("");

  // detail dialog
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContentDetail | null>(null);
  const [history, setHistory] = useState<ApprovalEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [form, setForm] = useState({ title: "", hook: "", caption: "", hashtags: "", script: "", platform: "instagram", language: "hy", contentType: "IMAGE_POST" });
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [invalidation, setInvalidation] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, b] = await Promise.all([
        api<ContentItem[]>("/api/content"),
        api<BrandLite[]>("/api/brands"),
      ]);
      setItems(c);
      setBrands(b);
    } catch {
      // keep previous data; honest empty state remains
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setBrandFilter(activeBrandId ?? "all"); }, [activeBrandId]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of items) map[it.approvalState] = (map[it.approvalState] ?? 0) + 1;
    return map;
  }, [items]);

  // brand display name for package export
  const detailBrandName = useMemo(
    () => brands.find((b) => b.id === detail?.brandId)?.name ?? "",
    [brands, detail?.brandId]
  );

  const filtered = useMemo(() => items.filter((it) => {
    if (stateFilter && it.approvalState !== stateFilter) return false;
    if (brandFilter !== "all" && it.brandId !== brandFilter) return false;
    if (query && !it.title.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [items, stateFilter, brandFilter, query]);

  const openDetail = useCallback(async (id: string) => {
    setOpenId(id);
    setDetailLoading(true);
    setInvalidation(null);
    try {
      const [d, h] = await Promise.all([
        api<ContentDetail>(`/api/content/${id}`),
        api<ApprovalEvent[]>(`/api/content/${id}/transition`),
      ]);
      setDetail(d);
      setHistory(h);
      setForm({
        title: d.title, hook: d.hook ?? "", caption: d.caption ?? "", hashtags: d.hashtags ?? "",
        script: d.script ?? "", platform: d.platform, language: d.language, contentType: d.contentType,
      });
    } catch (e) {
      toast.error(t("content.err.default"), { description: (e as Error).message });
      setOpenId(null);
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  // Trend → Content bridge: auto-open the AI draft that was just created in Trends (consumed once)
  const contentSeed = useApp((s) => s.contentSeed);
  const setContentSeed = useApp((s) => s.setContentSeed);
  useEffect(() => {
    if (contentSeed) {
      const id = contentSeed;
      setContentSeed(null);
      openDetail(id);
    }
  }, [contentSeed, setContentSeed, openDetail]);

  const saveEdits = async () => {
    if (!detail) return;
    setSaving(true);
    const patch: Record<string, string> = {};
    if (form.title !== detail.title) patch.title = form.title;
    if (form.hook !== (detail.hook ?? "")) patch.hook = form.hook;
    if (form.caption !== (detail.caption ?? "")) patch.caption = form.caption;
    if (form.hashtags !== (detail.hashtags ?? "")) patch.hashtags = form.hashtags;
    if (form.script !== (detail.script ?? "")) patch.script = form.script;
    if (form.platform !== detail.platform) patch.platform = form.platform;
    if (form.language !== detail.language) patch.language = form.language;
    if (form.contentType !== detail.contentType) patch.contentType = form.contentType;
    if (Object.keys(patch).length === 0) { setSaving(false); return; }
    const wasApproved = detail.approvalState === "APPROVED";
    try {
      const updated = await api<ContentItem>(`/api/content/${detail.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setItems((prev) => prev.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)));
      setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
      if (wasApproved && updated.approvalState === "CHANGES_REQUESTED") {
        setInvalidation(t("content.invalidated", { v: updated.contentVersion }));
        toast.warning(t("content.invalidated", { v: updated.contentVersion }));
      } else {
        toast.success(t("content.saved"));
      }
      const h = await api<ApprovalEvent[]>(`/api/content/${detail.id}/transition`);
      setHistory(h);
    } catch (e) {
      toast.error(t("content.err.default"), { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const transition = async (to: string) => {
    if (!detail) return;
    setTransitioning(true);
    try {
      const updated = await api<ContentItem>(`/api/content/${detail.id}/transition`, { method: "POST", body: JSON.stringify({ to }) });
      setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
      setItems((prev) => prev.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)));
      const h = await api<ApprovalEvent[]>(`/api/content/${detail.id}/transition`);
      setHistory(h);
      toast.success(`${t("content.field.state")}: ${t(`content.state.${updated.approvalState}`)}`);
    } catch (e) {
      toast.error(errText(e, "content.err.default", ["INVALID_TRANSITION", "NO_MEDIA", "NOT_APPROVED"], t), {
        description: (e as Error).message,
      });
    } finally {
      setTransitioning(false);
    }
  };

  const removeItem = async () => {
    if (!detail) return;
    try {
      await api(`/api/content/${detail.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((it) => it.id !== detail.id));
      setOpenId(null);
      setConfirmDelete(false);
      toast.success(t("content.deleted"));
    } catch (e) {
      toast.error(t("content.err.default"), { description: (e as Error).message });
    }
  };

  const editable = detail && detail.approvalState !== "GENERATING" && detail.approvalState !== "PUBLISHED";

  return (
    <div className="grid gap-5">
      {/* header */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-strong neon-border rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
              <FileStack className="h-5 w-5 text-[var(--neon)]" aria-hidden /> {t("content.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("content.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} aria-label={t("content.refresh")} className="min-h-11">
              <RefreshCw className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      </motion.section>

      {/* filters */}
      <Card className="glass rounded-2xl">
        <CardContent className="grid gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("content.field.state")}>
            <button
              onClick={() => setStateFilter(null)}
              className={`min-h-11 rounded-full border px-4 text-xs font-medium transition glass-hover ${stateFilter === null ? "neon-border text-foreground" : "border-border/60 text-muted-foreground"}`}
              aria-pressed={stateFilter === null}
            >
              {t("content.filterAll")} · {items.length}
            </button>
            {STATES.map((s) => {
              const a = stateAccent(s);
              const active = stateFilter === s;
              return (
                <button
                  key={s}
                  onClick={() => setStateFilter(active ? null : s)}
                  aria-pressed={active}
                  className={`min-h-11 rounded-full border px-4 text-xs font-medium transition ${active ? (a.className ?? "") : "border-border/60 text-muted-foreground glass-hover"}`}
                  style={active ? a.style : undefined}
                >
                  {t(`content.state.${s}`)} · {counts[s] ?? 0}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("content.searchPlaceholder")} className="min-h-11 pl-9" aria-label={t("content.searchPlaceholder")} />
            </div>
            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger className="min-h-11 sm:w-56" aria-label={t("content.brandAll")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("content.brandAll")}</SelectItem>
                {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* list */}
      {loading ? (
        <div className="grid gap-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl bg-muted/40" />)}</div>
      ) : filtered.length === 0 ? (
        <Card className="glass rounded-2xl"><CardContent className="p-6 text-center text-sm text-muted-foreground">{t("content.empty")}</CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((it, i) => (
            <motion.button
              key={it.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
              onClick={() => openDetail(it.id)}
              className="glass glass-hover rounded-2xl p-4 text-left"
              aria-label={`${t("content.open")}: ${it.title}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="line-clamp-1 text-sm font-semibold">{it.title}</p>
                <StateBadge state={it.approvalState} />
              </div>
              <p className="mt-1 line-clamp-2 min-h-8 text-xs text-muted-foreground">{it.hook ?? "—"}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <PlatformIcon platform={it.platform} /> {it.platform}
                </Badge>
                <Badge variant="outline" className="text-[10px]">{t(`content.lang.${it.language}`)}</Badge>
                <Badge variant="outline" className="text-[10px]">{t(`content.type.${it.contentType}`)}</Badge>
                <span className="ml-auto">v{it.contentVersion}</span>
                <span>{new Date(it.updatedAt).toLocaleString()}</span>
              </div>
            </motion.button>
          ))}
        </div>
      )}

      {/* detail dialog */}
      <Dialog open={openId !== null} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileStack className="h-4 w-4 text-[var(--neon)]" aria-hidden /> {t("content.detailTitle")}
            </DialogTitle>
            <DialogDescription className="sr-only">{t("content.detailTitle")}</DialogDescription>
          </DialogHeader>

          {detailLoading || !detail ? (
            <div className="grid gap-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl bg-muted/40" />)}</div>
          ) : (
            <div className="grid gap-4">
              {/* meta row */}
              <div className="flex flex-wrap items-center gap-2">
                <StateBadge state={detail.approvalState} />
                <Badge variant="outline" className="gap-1 text-[10px]"><PlatformIcon platform={detail.platform} /> {detail.platform}</Badge>
                <Badge variant="outline" className="text-[10px]">{t(`content.lang.${detail.language}`)}</Badge>
                <Badge variant="outline" className="text-[10px]">{t(`content.type.${detail.contentType}`)}</Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {t("content.field.version")} v{detail.contentVersion} · {t("content.field.updated")}: {new Date(detail.updatedAt).toLocaleString()}
                </span>
              </div>

              {/* invalidation notice (approval honestly invalidated) */}
              {invalidation && (
                <div className="rounded-xl border border-[color-mix(in_oklab,var(--neon-3)_50%,transparent)] bg-[color-mix(in_oklab,var(--neon-3)_10%,transparent)] p-3 text-xs text-foreground" role="alert">
                  <CircleAlert className="mr-1 inline h-4 w-4 text-[var(--neon-3)]" aria-hidden />
                  {invalidation}
                </div>
              )}

              {/* state-specific honest notes */}
              {detail.approvalState === "APPROVED" && (
                <div className="rounded-xl border border-[color-mix(in_oklab,var(--neon-2)_50%,transparent)] bg-[color-mix(in_oklab,var(--neon-2)_10%,transparent)] p-3 text-xs" role="status">
                  <CheckCircle2 className="mr-1 inline h-4 w-4 text-[var(--neon-2)]" aria-hidden /> {t("content.approvedNote")}
                </div>
              )}
              {detail.approvalState === "GENERATING" && (
                <div className="rounded-xl border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground" role="status">
                  <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-hidden /> {t("content.generatingNote")}
                </div>
              )}

              {/* approval actions */}
              <section aria-label={t("content.approvalActions")}>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("content.approvalActions")}</h3>
                <div className="flex flex-wrap gap-2">
                  {(detail.approvalState === "DRAFT" || detail.approvalState === "FAILED") && (
                    <Button size="sm" className="min-h-11" disabled={transitioning} onClick={() => transition("READY_FOR_REVIEW")}>
                      {transitioning ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
                      {t("content.submitReview")}
                    </Button>
                  )}
                  {detail.approvalState === "READY_FOR_REVIEW" && (
                    <>
                      <Button size="sm" className="min-h-11" disabled={transitioning} onClick={() => transition("APPROVED")}>
                        {transitioning ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                        {t("content.approve")}
                      </Button>
                      <Button size="sm" variant="outline" className="min-h-11" disabled={transitioning} onClick={() => transition("CHANGES_REQUESTED")}>
                        {t("content.requestChanges")}
                      </Button>
                      <Button size="sm" variant="ghost" className="min-h-11" disabled={transitioning} onClick={() => transition("DRAFT")}>
                        {t("content.backToDraft")}
                      </Button>
                    </>
                  )}
                  {detail.approvalState === "CHANGES_REQUESTED" && (
                    <>
                      <Button size="sm" className="min-h-11" disabled={transitioning} onClick={() => transition("READY_FOR_REVIEW")}>
                        {t("content.submitReview")}
                      </Button>
                      <Button size="sm" variant="ghost" className="min-h-11" disabled={transitioning} onClick={() => transition("DRAFT")}>
                        {t("content.backToDraft")}
                      </Button>
                    </>
                  )}
                  {(detail.approvalState === "SCHEDULED" || detail.approvalState === "PUBLISHED") && (
                    <p className="text-xs text-muted-foreground">{t("content.readonlyNote")}</p>
                  )}
                </div>
              </section>

              {/* media preview */}
              <section aria-label={t("content.media")}>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("content.media")}</h3>
                {detail.asset ? (
                  detail.asset.kind === "IMAGE" ? (
                    <img src={`/api/assets/${detail.asset.id}/raw`} alt={detail.asset.filename} className="max-h-72 w-full rounded-xl border border-border/60 object-cover" />
                  ) : detail.asset.kind === "VIDEO" ? (
                    <video src={`/api/assets/${detail.asset.id}/raw`} controls className="max-h-72 w-full rounded-xl border border-border/60" aria-label={detail.asset.filename} />
                  ) : (
                    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 p-3">
                      <AudioLines className="h-5 w-5 text-[var(--neon-2)]" aria-hidden />
                      <audio src={`/api/assets/${detail.asset.id}/raw`} controls className="w-full" aria-label={detail.asset.filename} />
                    </div>
                  )
                ) : detail.videoProject ? (
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Film className="h-4 w-4 text-[var(--neon)]" aria-hidden /> {detail.videoProject.scenes.length} scenes
                    </p>
                    <ul className="max-h-40 space-y-1 overflow-y-auto scrollbar-thin text-xs">
                      {detail.videoProject.scenes.map((sc) => (
                        <li key={sc.id} className="truncate rounded-lg bg-muted/30 px-2 py-1">{sc.text ?? sc.narration ?? "—"}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground"><ImageIcon className="h-4 w-4" aria-hidden /> {t("content.noMedia")}</p>
                )}
              </section>

              <Separator />

              {/* editable fields */}
              <section aria-label={t("content.field.title")} className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="c-title">{t("content.field.title")}</Label>
                  <Input id="c-title" className="min-h-11" value={form.title} disabled={!editable} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-hook">{t("content.field.hook")}</Label>
                  <Input id="c-hook" className="min-h-11" value={form.hook} disabled={!editable} onChange={(e) => setForm({ ...form, hook: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-caption">{t("content.field.caption")}</Label>
                  <Textarea id="c-caption" rows={3} value={form.caption} disabled={!editable} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-tags">{t("content.field.hashtags")}</Label>
                  <Input id="c-tags" className="min-h-11" value={form.hashtags} disabled={!editable} onChange={(e) => setForm({ ...form, hashtags: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-script">{t("content.field.script")}</Label>
                  <Textarea id="c-script" rows={5} value={form.script} disabled={!editable} onChange={(e) => setForm({ ...form, script: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="grid gap-1.5">
                    <Label>{t("content.field.platform")}</Label>
                    <Select value={form.platform} disabled={!editable} onValueChange={(v) => setForm({ ...form, platform: v })}>
                      <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("content.field.language")}</Label>
                    <Select value={form.language} disabled={!editable} onValueChange={(v) => setForm({ ...form, language: v })}>
                      <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LANGS.map((l) => <SelectItem key={l} value={l}>{t(`content.lang.${l}`)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("content.field.contentType")}</Label>
                    <Select value={form.contentType} disabled={!editable} onValueChange={(v) => setForm({ ...form, contentType: v })}>
                      <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TYPES.map((tp) => <SelectItem key={tp} value={tp}>{t(`content.type.${tp}`)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {editable ? (
                  <Button className="min-h-11 w-full sm:w-auto sm:justify-self-end" disabled={saving} onClick={saveEdits}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                    {t("common.save")}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("content.readonlyNote")}</p>
                )}
              </section>

              {/* approval history */}
              <section aria-label={t("content.history")}>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <History className="h-3.5 w-3.5" aria-hidden /> {t("content.history")}
                </h3>
                {history.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("content.noHistory")}</p>
                ) : (
                  <ol className="max-h-44 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                    {history.map((ev) => (
                      <li key={ev.id} className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{ev.fromState} → {ev.toState}</span>
                          <span className="text-muted-foreground">{new Date(ev.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-muted-foreground">
                          <Badge variant="outline" className="text-[10px]">{ev.actorType}</Badge>
                          {ev.note && <span className="truncate">{ev.note}</span>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <Separator />

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                {/* content package export (markdown / json / clipboard) */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="min-h-11 gap-1.5">
                      <Package className="h-4 w-4 text-[var(--neon-2)]" aria-hidden /> {t("content.export")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">{detail.title.slice(0, 40)}{detail.title.length > 40 ? "…" : ""}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={async () => {
                        const md = buildMarkdown(detail, detailBrandName);
                        try {
                          await navigator.clipboard.writeText(md);
                          toast.success(t("content.exportCopied"));
                        } catch {
                          downloadText(`${safeFileStem(detail.title)}.md`, md, "text/markdown");
                          toast.success(t("content.exportDone"));
                        }
                      }}
                    >
                      <Copy className="mr-2 h-4 w-4" aria-hidden /> {t("content.exportCopy")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        downloadText(`${safeFileStem(detail.title)}.md`, buildMarkdown(detail, detailBrandName), "text/markdown");
                        toast.success(t("content.exportDone"));
                      }}
                    >
                      <FileDown className="mr-2 h-4 w-4" aria-hidden /> {t("content.exportMd")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        const pkg = { ...detail, brand: detailBrandName, exportedAt: new Date().toISOString(), assetUrl: detail.asset ? `/api/assets/${detail.asset.id}/raw` : null };
                        downloadText(`${safeFileStem(detail.title)}.json`, JSON.stringify(pkg, null, 2), "application/json");
                        toast.success(t("content.exportDone"));
                      }}
                    >
                      <FileJson className="mr-2 h-4 w-4" aria-hidden /> {t("content.exportJson")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button variant="destructive" className="min-h-11 sm:w-auto" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-4 w-4" aria-hidden /> {t("content.delete")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("content.delete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("content.deleteConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={removeItem}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
