"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Library, Search, Star, Copy, Layers, Plus, Loader2, Clapperboard, ImageIcon,
  Sparkles, Tags, Variable,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { useI18n, api } from "@/lib/use-i18n";
import { showStudioError } from "@/components/modules/image-studio";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PROMPT_TO_IMAGE_KEY = "haydev-prompt-to-studio";
const PROMPT_TO_VIDEO_KEY = "haydev-prompt-to-video";

interface Template {
  id: string; niche: string; type: string; title: string; body: string;
  isFavorite: boolean; isCustom: boolean; usageCount: number; variablesJson?: string | null;
}
interface LibData { templates: Template[]; niches: string[] }

// {{variable}} highlighter — neon spans for dynamic placeholders
function HighlightedBody({ body }: { body: string }) {
  const parts = body.split(/(\{\{[^}]+\}\})/g);
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {parts.map((part, i) =>
        /^\{\{[^}]+\}\}$/.test(part) ? (
          <span key={i} className="text-[var(--neon)] font-medium">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}

function extractVariables(tpl: Template): string[] {
  if (tpl.variablesJson) {
    try {
      const parsed = JSON.parse(tpl.variablesJson) as string[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch { /* fall back to regex */ }
  }
  return [...tpl.body.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1].trim());
}

export function PromptLibraryModule() {
  const { t } = useI18n();
  const setView = useApp((s) => s.setView);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [niche, setNiche] = useState("");
  const [type, setType] = useState<"ALL" | "IMAGE" | "VIDEO">("ALL");
  const [favOnly, setFavOnly] = useState(false);
  const [data, setData] = useState<LibData>({ templates: [], niches: [] });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Template | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // create custom dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [cTitle, setCTitle] = useState("");
  const [cBody, setCBody] = useState("");
  const [cNiche, setCNiche] = useState("");
  const [cType, setCType] = useState("IMAGE");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const iv = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(iv);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedQ) params.set("q", debouncedQ);
      if (niche) params.set("niche", niche);
      if (type !== "ALL") params.set("type", type);
      if (favOnly) params.set("favorite", "1");
      const res = await api<LibData>(`/api/prompts?${params.toString()}`);
      setData({ templates: res.templates ?? [], niches: res.niches ?? [] });
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, niche, type, favOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleFavorite = async (tpl: Template) => {
    setBusyId(tpl.id);
    // optimistic
    setData((prev) => ({
      ...prev,
      templates: prev.templates.map((x) => (x.id === tpl.id ? { ...x, isFavorite: !x.isFavorite } : x)),
    }));
    try {
      await api<Template>("/api/prompts", { method: "POST", body: JSON.stringify({ action: "favorite", id: tpl.id }) });
    } catch (err) {
      setData((prev) => ({
        ...prev,
        templates: prev.templates.map((x) => (x.id === tpl.id ? { ...x, isFavorite: !x.isFavorite } : x)),
      }));
      showStudioError(t, err);
    } finally {
      setBusyId(null);
    }
  };

  const duplicate = async (tpl: Template) => {
    setBusyId(tpl.id);
    try {
      await api<Template>("/api/prompts", { method: "POST", body: JSON.stringify({ action: "duplicate", id: tpl.id }) });
      toast.success(t("studio.pr.duplicated"));
      load();
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (tpl: Template) => {
    try {
      await navigator.clipboard.writeText(tpl.body);
      toast.success(t("studio.pr.copied"));
    } catch {
      toast.error(t("studio.err.generic", { msg: "clipboard unavailable" }));
    }
  };

  const sendToImageStudio = (tpl: Template) => {
    try {
      window.localStorage.setItem(PROMPT_TO_IMAGE_KEY, tpl.body);
    } catch { /* non-critical */ }
    setDetail(null);
    setView("image");
    toast.success(t("studio.pr.sentToImage"));
  };

  const sendToVideoStudio = (tpl: Template) => {
    try {
      window.localStorage.setItem(PROMPT_TO_VIDEO_KEY, tpl.body);
    } catch { /* non-critical */ }
    setDetail(null);
    setView("video");
    toast.success(t("studio.pr.sentToVideo"));
  };

  const createCustom = async () => {
    if (!cTitle.trim() || !cBody.trim()) {
      toast.warning(t("studio.pr.needFields"));
      return;
    }
    setCreating(true);
    try {
      await api<Template>("/api/prompts", {
        method: "POST",
        body: JSON.stringify({ action: "create", title: cTitle, body: cBody, niche: cNiche || undefined, type: cType }),
      });
      setCreateOpen(false);
      setCTitle("");
      setCBody("");
      setCNiche("");
      toast.success(t("studio.pr.created"));
      load();
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setCreating(false);
    }
  };

  const typeToggle = (v: "ALL" | "IMAGE" | "VIDEO") => (
    <button
      key={v}
      role="radio"
      aria-checked={type === v}
      onClick={() => setType(v)}
      className={`flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition ${
        type === v ? "neon-border neon-text glass-strong" : "glass glass-hover border border-border/60"
      }`}
    >
      {v === "IMAGE" && <ImageIcon className="h-3.5 w-3.5" />}
      {v === "VIDEO" && <Clapperboard className="h-3.5 w-3.5" />}
      {t(v === "ALL" ? "studio.pr.all" : v === "IMAGE" ? "studio.pr.image" : "studio.pr.video")}
    </button>
  );

  return (
    <div className="grid gap-5">
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-strong neon-border rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold sm:text-2xl neon-text">{t("studio.pr.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("studio.pr.subtitle")}</p>
          </div>
          <Button className="min-h-11 gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> {t("studio.pr.create")}
          </Button>
        </div>
      </motion.section>

      {/* filters */}
      <Card className="glass rounded-2xl">
        <CardContent className="grid gap-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("studio.pr.searchPh")}
                aria-label={t("common.search")}
                className="min-h-11 pl-9"
              />
            </div>
            <div className="flex items-center gap-1.5" role="radiogroup" aria-label={t("studio.pr.cType")}>
              {typeToggle("ALL")}
              {typeToggle("IMAGE")}
              {typeToggle("VIDEO")}
            </div>
            <button
              aria-pressed={favOnly}
              onClick={() => setFavOnly(!favOnly)}
              className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-medium transition ${
                favOnly ? "neon-border neon-text glass-strong" : "glass glass-hover border border-border/60"
              }`}
              aria-label={t("studio.pr.favorites")}
            >
              <Star className={`h-4 w-4 ${favOnly ? "fill-[var(--neon-3)] text-[var(--neon-3)]" : ""}`} />
              <span className="hidden sm:inline">{t("studio.pr.favorites")}</span>
            </button>
          </div>
          {data.niches.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin" role="group" aria-label={t("studio.pr.niches")}>
              <Tags className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <button
                onClick={() => setNiche("")}
                aria-pressed={niche === ""}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${niche === "" ? "neon-border neon-text" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
              >
                {t("studio.pr.all")}
              </button>
              {data.niches.map((n) => (
                <button
                  key={n}
                  onClick={() => setNiche(niche === n ? "" : n)}
                  aria-pressed={niche === n}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${niche === n ? "neon-border neon-text" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{t("studio.pr.count", { n: data.templates.length })}</p>
        </CardContent>
      </Card>

      {/* templates grid */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl bg-muted/40" />)}
        </div>
      ) : data.templates.length === 0 ? (
        <Card className="glass rounded-2xl">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Library className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("studio.pr.empty")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.templates.map((tpl, i) => (
            <motion.button
              key={tpl.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
              onClick={() => setDetail(tpl)}
              className="glass glass-hover flex flex-col gap-2.5 rounded-2xl border border-border/60 p-4 text-left"
              aria-label={tpl.title}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] text-[var(--neon-3)]">{tpl.niche}</Badge>
                <Badge variant="outline" className={`gap-1 text-[10px] ${tpl.type === "VIDEO" ? "text-[var(--neon)]" : "text-[var(--neon-2)]"}`}>
                  {tpl.type === "VIDEO" ? <Clapperboard className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                  {t(tpl.type === "VIDEO" ? "studio.pr.video" : "studio.pr.image")}
                </Badge>
                {tpl.isCustom && <Badge variant="secondary" className="text-[10px]">{t("studio.pr.custom")}</Badge>}
              </div>
              <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{tpl.title}</h3>
              <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{tpl.body}</p>
              <div className="mt-auto flex items-center justify-between gap-1 pt-1">
                <span className="text-[10px] text-muted-foreground">{t("studio.pr.usage", { n: tpl.usageCount })}</span>
                <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    aria-label={tpl.isFavorite ? t("studio.pr.favRemove") : t("studio.pr.favAdd")}
                    disabled={busyId === tpl.id}
                    onClick={() => toggleFavorite(tpl)}
                  >
                    <Star className={`h-4 w-4 ${tpl.isFavorite ? "fill-[var(--neon-3)] text-[var(--neon-3)]" : "text-muted-foreground"}`} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={t("studio.pr.copy")} onClick={() => copy(tpl)}>
                    <Copy className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={t("studio.pr.duplicate")} disabled={busyId === tpl.id} onClick={() => duplicate(tpl)}>
                    {busyId === tpl.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      )}

      {/* detail dialog */}
      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="glass-strong max-h-[85vh] rounded-2xl border-border/60">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-6 text-base leading-snug">{detail.title}</DialogTitle>
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Badge variant="outline" className="text-[10px] text-[var(--neon-3)]">{detail.niche}</Badge>
                  <Badge variant="outline" className="text-[10px]">{detail.type}</Badge>
                  {detail.isCustom && <Badge variant="secondary" className="text-[10px]">{t("studio.pr.custom")}</Badge>}
                </div>
              </DialogHeader>
              <div className="grid max-h-[50vh] gap-4 overflow-y-auto scrollbar-thin">
                <div className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("studio.pr.body")}</span>
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                    <HighlightedBody body={detail.body} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Variable className="h-3.5 w-3.5" /> {t("studio.pr.variables")}
                  </span>
                  {extractVariables(detail).length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("studio.pr.noVars")}</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {extractVariables(detail).map((v) => (
                        <Badge key={v} variant="outline" className="font-mono text-[10px] text-[var(--neon)]">{`{{${v}}}`}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button variant="outline" className="min-h-11 gap-2" onClick={() => copy(detail)}>
                  <Copy className="h-4 w-4" /> {t("studio.pr.copy")}
                </Button>
                <Button variant="outline" className="min-h-11 gap-2" onClick={() => duplicate(detail).then(() => setDetail(null))}>
                  <Layers className="h-4 w-4" /> {t("studio.pr.duplicate")}
                </Button>
                {detail.type === "VIDEO" ? (
                  <Button className="min-h-11 gap-2" onClick={() => sendToVideoStudio(detail)}>
                    <Clapperboard className="h-4 w-4" /> {t("studio.pr.openInVideo")}
                  </Button>
                ) : (
                  <Button className="min-h-11 gap-2" onClick={() => sendToImageStudio(detail)}>
                    <Sparkles className="h-4 w-4" /> {t("studio.pr.openInImage")}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* create custom dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="glass-strong rounded-2xl border-border/60">
          <DialogHeader>
            <DialogTitle className="neon-text">{t("studio.pr.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="pr-c-title">{t("studio.pr.cTitle")}</Label>
              <Input id="pr-c-title" value={cTitle} onChange={(e) => setCTitle(e.target.value)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="pr-c-niche">{t("studio.pr.cNiche")}</Label>
                <Input id="pr-c-niche" value={cNiche} onChange={(e) => setCNiche(e.target.value)} placeholder={t("studio.pr.cNichePh")} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pr-c-type">{t("studio.pr.cType")}</Label>
                <Select value={cType} onValueChange={setCType}>
                  <SelectTrigger id="pr-c-type" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IMAGE">{t("studio.pr.image")}</SelectItem>
                    <SelectItem value="VIDEO">{t("studio.pr.video")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pr-c-body">{t("studio.pr.cBody")}</Label>
              <Textarea id="pr-c-body" value={cBody} onChange={(e) => setCBody(e.target.value)} placeholder={t("studio.pr.cBodyPh")} rows={5} className="resize-none font-mono text-[13px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="min-h-11" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button>
            <Button className="min-h-11 gap-2" onClick={createCustom} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
