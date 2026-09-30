"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Clapperboard, Loader2, Plus, ArrowLeft, Film, Play, RotateCcw, Save,
  Wand2, BookOpen, Palette, User, CheckCircle2, XCircle, X, CircleDashed, Clock,
} from "lucide-react";
import { useApp, pulseCore } from "@/lib/store";
import { useI18n, api } from "@/lib/use-i18n";
import { showStudioError } from "@/components/modules/image-studio";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const LAST_PROJECT_KEY = "haydev-video-last";
const BRIEF_FROM_LIB_KEY = "haydev-prompt-to-video";

interface Scene {
  id: string; order: number; durationSec: number; prompt: string; narration?: string | null;
  status: string; assetId?: string | null; jobId?: string | null; error?: string | null; cost?: number | null; version: number;
}
interface Project {
  id: string; title: string; durationSec: number; aspectRatio: string; language: string;
  script?: string | null; characterBibleJson?: string | null; styleBibleJson?: string | null;
  status: string; createdAt: string; updatedAt: string; scenes?: Scene[]; _count?: { scenes: number };
}
interface JobInfo { id: string; status: string; error?: string | null }

type BibleRows = { key: string; value: string }[];

function parseBible(raw: string | null | undefined): BibleRows {
  if (!raw) return [];
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(obj).map(([key, value]) => ({ key, value: String(value ?? "") }));
  } catch {
    return [];
  }
}

function bibleToObj(rows: BibleRows): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const r of rows) if (r.key.trim()) obj[r.key.trim()] = r.value;
  return obj;
}

const DURATIONS = [15, 30, 60];
const ASPECTS: { id: string; w: number; h: number }[] = [
  { id: "9:16", w: 20, h: 36 },
  { id: "1:1", w: 28, h: 28 },
  { id: "16:9", w: 48, h: 27 },
];

export function VideoStudioModule() {
  const { t, localeLabels } = useI18n();
  const activeBrandId = useApp((s) => s.activeBrandId);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [view, setView] = useState<"list" | "editor">("list");
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef<Project | null>(null);
  projectRef.current = project;

  // create form
  const [title, setTitle] = useState("");
  const [durationSec, setDurationSec] = useState(30);
  const [aspect, setAspect] = useState("9:16");
  const [language, setLanguage] = useState("hy");
  const [brief, setBrief] = useState("");
  const [creating, setCreating] = useState(false);

  // editor state
  const [scriptBrief, setScriptBrief] = useState("");
  const [scripting, setScripting] = useState(false);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [savingPrompt, setSavingPrompt] = useState<string | null>(null);
  const [sceneBusy, setSceneBusy] = useState<string | null>(null);
  const [polls, setPolls] = useState<Record<string, { jobId: string; elapsed: number }>>({});
  const pollsRef = useRef(polls);
  pollsRef.current = polls;
  const [charRows, setCharRows] = useState<BibleRows>([]);
  const [styleRows, setStyleRows] = useState<BibleRows>([]);
  const [savingBible, setSavingBible] = useState<"char" | "style" | null>(null);

  const loadList = useCallback(async () => {
    try {
      const list = await api<Project[]>("/api/video-projects");
      setProjects(list);
    } catch {
      /* list stays empty */
    } finally {
      setLoadingList(false);
    }
  }, []);

  const refreshProject = useCallback(async () => {
    const id = projectRef.current?.id;
    if (!id) return;
    try {
      const fresh = await api<Project>(`/api/video-projects?id=${id}`);
      setProject(fresh);
      loadList();
    } catch {
      /* keep current */
    }
  }, [loadList]);

  const startPoll = useCallback((sceneId: string, jobId: string) => {
    setPolls((prev) => (prev[sceneId] ? prev : { ...prev, [sceneId]: { jobId, elapsed: 0 } }));
  }, []);

  const openProject = useCallback(async (id: string) => {
    try {
      const p = await api<Project>(`/api/video-projects?id=${id}`);
      setProject(p);
      setScriptBrief("");
      setPromptDrafts({});
      setCharRows(parseBible(p.characterBibleJson));
      setStyleRows(parseBible(p.styleBibleJson));
      setView("editor");
      try {
        window.localStorage.setItem(LAST_PROJECT_KEY, id);
      } catch { /* non-critical */ }
      for (const sc of p.scenes ?? []) {
        if (sc.jobId && ["GENERATING", "QUEUED"].includes(sc.status)) startPoll(sc.id, sc.jobId);
      }
    } catch (err) {
      showStudioError(t, err);
    }
  }, [startPoll]);

  // hydrate: list + last opened project + library hand-off
  useEffect(() => {
    (async () => {
      await loadList();
      try {
        const fromLib = window.localStorage.getItem(BRIEF_FROM_LIB_KEY);
        if (fromLib) {
          setBrief(fromLib);
          window.localStorage.removeItem(BRIEF_FROM_LIB_KEY);
          toast.info(t("studio.vid.briefLoaded"));
        }
        const last = window.localStorage.getItem(LAST_PROJECT_KEY);
        if (last) {
          const exists = await api<Project[]>(`/api/video-projects`).catch(() => []);
          if (exists.some((p) => p.id === last)) await openProject(last);
        }
      } catch { /* non-critical */ }
    })();
  }, []);

  // job polling: reconcile every 6s while scenes are in flight
  useEffect(() => {
    const iv = setInterval(async () => {
      const entries = Object.entries(pollsRef.current);
      for (const [sceneId, p] of entries) {
        try {
          const job = await api<JobInfo>(`/api/jobs/${p.jobId}`);
          if (job.status === "COMPLETED") {
            setPolls((prev) => { const n = { ...prev }; delete n[sceneId]; return n; });
            await refreshProject();
            pulseCore("SUCCESS");
            toast.success(t("studio.vid.status.COMPLETED"));
          } else if (["FAILED", "CANCELLED"].includes(job.status)) {
            setPolls((prev) => { const n = { ...prev }; delete n[sceneId]; return n; });
            await refreshProject();
            pulseCore("ERROR");
            toast.error(t("studio.err.generic", { msg: job.error ?? "video generation failed" }));
          }
        } catch { /* transient network/provider error — keep polling */ }
      }
    }, 6000);
    return () => clearInterval(iv);
  }, [refreshProject, t]);

  // elapsed counter for polling display
  useEffect(() => {
    const iv = setInterval(() => {
      setPolls((prev) => {
        const next: Record<string, { jobId: string; elapsed: number }> = {};
        for (const [k, v] of Object.entries(prev)) next[k] = { ...v, elapsed: v.elapsed + 1 };
        return next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const backToList = () => {
    setView("list");
    setProject(null);
    loadList();
  };

  const createProject = async () => {
    if (!title.trim()) {
      toast.warning(t("studio.vid.projectTitle"));
      return;
    }
    setCreating(true);
    pulseCore("PLANNING");
    try {
      const p = await api<Project>("/api/generate/video", {
        method: "POST",
        body: JSON.stringify({
          action: "create_project",
          brandId: activeBrandId ?? undefined,
          title,
          durationSec,
          aspectRatio: aspect,
          language,
          script: brief.trim() || undefined,
          autoShotPlan: true,
        }),
      });
      setTitle("");
      setBrief("");
      toast.success(t("studio.vid.created"));
      await loadList();
      await openProject(p.id);
    } catch (err) {
      pulseCore("ERROR");
      showStudioError(t, err);
    } finally {
      setCreating(false);
    }
  };

  const generateScript = async () => {
    if (!project) return;
    setScripting(true);
    pulseCore("ANALYZING");
    try {
      const updated = await api<Project>("/api/generate/video", {
        method: "POST",
        body: JSON.stringify({ action: "generate_script", projectId: project.id, brief: scriptBrief || undefined }),
      });
      setProject((prev) => (prev ? { ...prev, ...updated, scenes: prev.scenes } : prev));
      setCharRows(parseBible(updated.characterBibleJson));
      setStyleRows(parseBible(updated.styleBibleJson));
      pulseCore("SUCCESS");
      toast.success(t("common.success"));
      loadList();
    } catch (err) {
      pulseCore("ERROR");
      showStudioError(t, err);
    } finally {
      setScripting(false);
    }
  };

  const saveScenePrompt = async (sceneId: string) => {
    if (!project) return;
    const prompt = promptDrafts[sceneId];
    if (prompt === undefined) return;
    setSavingPrompt(sceneId);
    try {
      await api<Project>("/api/video-projects", {
        method: "PATCH",
        body: JSON.stringify({ projectId: project.id, sceneId, prompt }),
      });
      setProject((prev) =>
        prev ? { ...prev, scenes: prev.scenes?.map((s) => (s.id === sceneId ? { ...s, prompt } : s)) } : prev
      );
      toast.success(t("studio.vid.promptSaved"));
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setSavingPrompt(null);
    }
  };

  const generateScene = async (scene: Scene) => {
    if (!project) return;
    setSceneBusy(scene.id);
    try {
      if (scene.status === "COMPLETED" && scene.assetId) {
        // replace: reset scene first (version+1), then submit a fresh job
        await api<Project>("/api/video-projects", {
          method: "PATCH",
          body: JSON.stringify({ projectId: project.id, sceneId: scene.id, reset: true }),
        });
      }
      pulseCore("GENERATING");
      const res = await api<{ jobId: string; assetId?: string; deduplicated?: boolean }>("/api/generate/video", {
        method: "POST",
        body: JSON.stringify({ action: "generate_scene", sceneId: scene.id }),
      });
      if (res.deduplicated && res.assetId) {
        await refreshProject();
        pulseCore("SUCCESS");
        toast.success(t("studio.vid.status.COMPLETED"));
      } else if (res.jobId) {
        startPoll(scene.id, res.jobId);
        await refreshProject();
      }
    } catch (err) {
      pulseCore("ERROR");
      showStudioError(t, err);
    } finally {
      setSceneBusy(null);
    }
  };

  const jobAction = async (scene: Scene, action: "resume" | "cancel") => {
    if (!scene.jobId) return;
    setSceneBusy(scene.id);
    try {
      if (action === "resume") {
        pulseCore("GENERATING");
        await api<JobInfo>(`/api/jobs/${scene.jobId}`, { method: "POST", body: JSON.stringify({ action: "resume" }) });
        startPoll(scene.id, scene.jobId);
        await refreshProject();
      } else {
        await api<JobInfo>(`/api/jobs/${scene.jobId}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) });
        await refreshProject();
        toast.info(t("common.cancel"));
      }
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setSceneBusy(null);
    }
  };

  const saveBible = async (kind: "char" | "style") => {
    if (!project) return;
    setSavingBible(kind);
    try {
      const body = kind === "char"
        ? { projectId: project.id, characterBible: bibleToObj(charRows) }
        : { projectId: project.id, styleBible: bibleToObj(styleRows) };
      await api<Project>("/api/video-projects", { method: "PATCH", body: JSON.stringify(body) });
      toast.success(t("studio.vid.bibleSaved"));
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setSavingBible(null);
    }
  };

  const scenes = project?.scenes ?? [];
  const estTotal = scenes.reduce((sum, s) => sum + (s.cost ?? (s.status === "COMPLETED" ? 0 : 0.1)), 0);

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      COMPLETED: "border-[var(--neon-2)]/50 text-[var(--neon-2)]",
      GENERATING: "border-[var(--neon)]/50 text-[var(--neon)]",
      FAILED: "border-destructive/50 text-destructive",
    };
    return (
      <Badge variant="outline" className={`shrink-0 text-[10px] ${map[status] ?? "text-muted-foreground"}`}>
        {t(`studio.vid.status.${status}` as const)}
      </Badge>
    );
  };

  return (
    <div className="grid gap-5">
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-strong neon-border rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold sm:text-2xl neon-text">{t("studio.vid.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("studio.vid.subtitle")}</p>
          </div>
          {view === "editor" && (
            <Button variant="outline" className="min-h-11 gap-2" onClick={backToList}>
              <ArrowLeft className="h-4 w-4" /> {t("studio.vid.back")}
            </Button>
          )}
        </div>
      </motion.section>

      {view === "list" ? (
        <>
          {/* create form */}
          <Card className="glass-strong neon-border rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="h-4 w-4 text-[var(--neon)]" /> {t("studio.vid.newProject")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="vid-title">{t("studio.vid.projectTitle")}</Label>
                  <Input id="vid-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("studio.vid.titlePh")} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="vid-lang">{t("studio.vid.language")}</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger id="vid-lang" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(localeLabels).map(([id, label]) => (
                        <SelectItem key={id} value={id}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>{t("studio.vid.duration")}</Label>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("studio.vid.duration")}>
                  {DURATIONS.map((d) => (
                    <button
                      key={d}
                      role="radio"
                      aria-checked={durationSec === d}
                      onClick={() => setDurationSec(d)}
                      className={`glass glass-hover min-h-14 rounded-xl text-center transition ${durationSec === d ? "neon-border neon-text" : "border border-border/60"}`}
                    >
                      <span className="text-lg font-bold">{d}s</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-2">
                <Label>{t("studio.vid.aspect")}</Label>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("studio.vid.aspect")}>
                  {ASPECTS.map((a) => (
                    <button
                      key={a.id}
                      role="radio"
                      aria-checked={aspect === a.id}
                      onClick={() => setAspect(a.id)}
                      className={`glass glass-hover flex min-h-11 min-w-11 flex-col items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs transition ${aspect === a.id ? "neon-border neon-text" : "border border-border/60"}`}
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

              <div className="grid gap-2">
                <Label htmlFor="vid-brief">{t("studio.vid.brief")}</Label>
                <Textarea id="vid-brief" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("studio.vid.briefPh")} rows={3} className="resize-none" />
                <p className="text-[11px] text-muted-foreground">
                  {t("studio.vid.brand")}: {activeBrandId ? <span className="neon-text font-medium">{activeBrandId.slice(0, 14)}…</span> : t("studio.vid.brandNone")}
                </p>
              </div>

              <Button onClick={createProject} disabled={creating} size="lg" className="min-h-11 gap-2 font-semibold">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {creating ? t("studio.vid.creating") : t("studio.vid.create")}
              </Button>
            </CardContent>
          </Card>

          {/* project list */}
          <Card className="glass rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Film className="h-4 w-4 text-[var(--neon-3)]" /> {t("studio.vid.projects")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingList ? (
                <div className="grid gap-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl bg-muted/40" />)}</div>
              ) : projects.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("studio.vid.projectsEmpty")}</p>
              ) : (
                <ul className="grid max-h-96 gap-2 overflow-y-auto scrollbar-thin">
                  {projects.map((p) => (
                    <li key={p.id} className="glass glass-hover flex flex-wrap items-center justify-between gap-3 rounded-xl p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.title}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {p.durationSec}s · {p.aspectRatio} · {p.language.toUpperCase()} ·{" "}
                          {t("studio.vid.sceneCount", { n: p._count?.scenes ?? 0 })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {statusBadge(p.status)}
                        <Button variant="outline" size="sm" className="min-h-11 gap-1.5 text-xs" onClick={() => openProject(p.id)}>
                          <Play className="h-3.5 w-3.5 text-[var(--neon)]" /> {t("studio.vid.open")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : project ? (
        <>
          {/* script panel */}
          <Card className="glass-strong neon-border rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <BookOpen className="h-4 w-4 text-[var(--neon)]" /> {project.title}
                <Badge variant="outline" className="text-[10px]">{project.durationSec}s · {project.aspectRatio} · {project.language.toUpperCase()}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {project.script ? (
                <p className="whitespace-pre-wrap rounded-xl border border-border/60 bg-muted/20 p-4 text-sm leading-relaxed">{project.script}</p>
              ) : (
                <p className="py-2 text-sm text-muted-foreground">{t("studio.vid.scriptEmpty")}</p>
              )}
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="grid gap-2">
                  <Label htmlFor="vid-script-brief">{t("studio.vid.briefForScript")}</Label>
                  <Input id="vid-script-brief" value={scriptBrief} onChange={(e) => setScriptBrief(e.target.value)} placeholder={t("studio.vid.briefForScriptPh")} />
                </div>
                <Button variant="outline" className="min-h-11 gap-2" onClick={generateScript} disabled={scripting}>
                  {scripting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4 text-[var(--neon-3)]" />}
                  {scripting ? t("studio.vid.scripting") : project.script ? t("studio.vid.regenScript") : t("studio.vid.genScript")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* timeline summary bar */}
          <div className="glass rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[var(--neon-2)]" />
                <span className="text-sm font-medium">{t("studio.vid.timeline")}</span>
                <div className="flex items-center gap-1" aria-label={t("studio.vid.timeline")}>
                  {scenes.map((s) => (
                    <span
                      key={s.id}
                      title={`${t("studio.vid.scene", { n: s.order + 1 })} — ${t(`studio.vid.status.${s.status}` as const)}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-muted/20"
                    >
                      {s.status === "COMPLETED" && <CheckCircle2 className="h-4 w-4 text-[var(--neon-2)]" />}
                      {s.status === "GENERATING" && <Loader2 className="h-4 w-4 animate-spin text-[var(--neon)]" />}
                      {s.status === "FAILED" && <XCircle className="h-4 w-4 text-destructive" />}
                      {["PENDING", "QUEUED"].includes(s.status) && <CircleDashed className="h-4 w-4 text-muted-foreground/60" />}
                    </span>
                  ))}
                </div>
              </div>
              <Badge variant="outline" className="text-xs">
                {t("studio.vid.estCost")}: <span className="neon-text ml-1 font-mono">${estTotal.toFixed(2)}</span>
              </Badge>
            </div>
          </div>

          {/* scenes strip */}
          <Card className="glass rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clapperboard className="h-4 w-4 text-[var(--neon-3)]" /> {t("studio.vid.scenes")}
                {scenes.length > 0 && <Badge variant="secondary" className="text-[10px]">{scenes.length}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {scenes.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("studio.vid.scenesEmpty")}</p>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin" role="list">
                  {scenes.map((scene) => {
                    const poll = polls[scene.id];
                    const draft = promptDrafts[scene.id] ?? scene.prompt;
                    return (
                      <motion.div
                        key={scene.id}
                        initial={{ opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: scene.order * 0.05 }}
                        role="listitem"
                        className="glass grid w-[300px] shrink-0 gap-2 rounded-xl p-4 sm:w-[340px]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold neon-text">{t("studio.vid.scene", { n: scene.order + 1 })}</span>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px]">{scene.durationSec}s</Badge>
                            {statusBadge(scene.status)}
                          </div>
                        </div>

                        {scene.status === "COMPLETED" && scene.assetId ? (
                          <video controls src={`/api/assets/${scene.assetId}/raw`} className="w-full rounded-lg border border-border/60" aria-label={t("studio.vid.scene", { n: scene.order + 1 })} />
                        ) : (
                          <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/20">
                            {poll ? (
                              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin text-[var(--neon)]" />
                                {t("studio.vid.polling", { sec: poll.elapsed })}
                              </span>
                            ) : (
                              <Film className="h-6 w-6 text-muted-foreground/40" />
                            )}
                          </div>
                        )}

                        <div className="grid gap-1.5">
                          <Label htmlFor={`sc-${scene.id}`} className="text-[11px] text-muted-foreground">{t("studio.vid.scenePrompt")}</Label>
                          <Textarea
                            id={`sc-${scene.id}`}
                            value={draft}
                            onChange={(e) => setPromptDrafts((prev) => ({ ...prev, [scene.id]: e.target.value }))}
                            rows={3}
                            className="resize-none font-mono text-[12px]"
                          />
                        </div>

                        {scene.narration && (
                          <p className="text-[11px] text-muted-foreground"><span className="font-medium">{t("studio.vid.narration")}:</span> {scene.narration}</p>
                        )}
                        {scene.error && <p className="line-clamp-2 text-[11px] text-destructive">{scene.error}</p>}

                        <div className="flex flex-wrap gap-2">
                          {draft !== scene.prompt && (
                            <Button variant="outline" size="sm" className="min-h-11 gap-1.5 text-xs" disabled={savingPrompt === scene.id} onClick={() => saveScenePrompt(scene.id)}>
                              {savingPrompt === scene.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 text-[var(--neon-2)]" />}
                              {t("studio.vid.savePrompt")}
                            </Button>
                          )}
                          {scene.status === "FAILED" && scene.jobId && (
                            <>
                              <Button variant="outline" size="sm" className="min-h-11 gap-1.5 text-xs" disabled={sceneBusy === scene.id} onClick={() => jobAction(scene, "resume")}>
                                <RotateCcw className="h-3.5 w-3.5 text-[var(--neon-3)]" /> {t("common.resume")}
                              </Button>
                              <Button variant="ghost" size="sm" className="min-h-11 gap-1.5 text-xs" disabled={sceneBusy === scene.id} onClick={() => jobAction(scene, "cancel")}>
                                <X className="h-3.5 w-3.5" /> {t("common.cancel")}
                              </Button>
                            </>
                          )}
                          {!(scene.status === "GENERATING") && (
                            <Button
                              size="sm"
                              className="min-h-11 flex-1 gap-1.5 text-xs"
                              disabled={sceneBusy === scene.id || Boolean(poll)}
                              onClick={() => generateScene(scene)}
                              aria-label={scene.status === "COMPLETED" ? t("studio.vid.regenScene") : t("studio.vid.generateScene")}
                            >
                              {sceneBusy === scene.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                              {scene.status === "COMPLETED" ? t("studio.vid.regenScene") : t("studio.vid.generateScene")}
                            </Button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* bibles */}
          <div className="grid gap-5 lg:grid-cols-2">
            {([
              { kind: "char" as const, title: t("studio.vid.charBible"), icon: User, neon: "var(--neon)", rows: charRows, setRows: setCharRows },
              { kind: "style" as const, title: t("studio.vid.styleBible"), icon: Palette, neon: "var(--neon-2)", rows: styleRows, setRows: setStyleRows },
            ]).map(({ kind, title, icon: Icon, neon, rows, setRows }) => (
              <Card key={kind} className="glass rounded-2xl">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="h-4 w-4" style={{ color: neon }} /> {title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {rows.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("studio.vid.bibleEmpty")}</p>
                  ) : (
                    <div className="grid max-h-64 gap-2 overflow-y-auto scrollbar-thin">
                      {rows.map((row, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input
                            value={row.key}
                            aria-label={`${t("studio.vid.key")} ${i + 1}`}
                            onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
                            className="h-11 w-2/5 font-mono text-xs"
                            placeholder={t("studio.vid.key")}
                          />
                          <Input
                            value={row.value}
                            aria-label={`${t("studio.vid.value")} ${i + 1}`}
                            onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
                            className="h-11 flex-1 text-xs"
                            placeholder={t("studio.vid.value")}
                          />
                          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={t("common.delete")} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="min-h-11 gap-1.5 text-xs" onClick={() => setRows([...rows, { key: "", value: "" }])}>
                      <Plus className="h-3.5 w-3.5" /> {t("studio.vid.addKey")}
                    </Button>
                    <Button variant="outline" size="sm" className="min-h-11 gap-1.5 text-xs" disabled={savingBible === kind} onClick={() => saveBible(kind)}>
                      {savingBible === kind ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" style={{ color: neon }} />}
                      {t("common.save")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <Skeleton className="h-64 rounded-2xl bg-muted/40" />
      )}
    </div>
  );
}
