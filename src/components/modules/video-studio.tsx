"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Clapperboard, Loader2, Plus, ArrowLeft, Film, Play, RotateCcw, Save,
  Wand2, BookOpen, Palette, User, CheckCircle2, XCircle, X, CircleDashed, Clock,
  FileVideo, Download, Music4, Info, Layers, Mic, Trash2, Captions,
} from "lucide-react";
import { useApp, pulseCore } from "@/lib/store";
import { useI18n, api, assetUrl } from "@/lib/use-i18n";
import { showStudioError } from "@/components/modules/image-studio";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const LAST_PROJECT_KEY = "haydev-video-last";
const BRIEF_FROM_LIB_KEY = "haydev-prompt-to-video";

interface Scene {
  id: string; order: number; durationSec: number; prompt: string; narration?: string | null;
  status: string; assetId?: string | null; jobId?: string | null; error?: string | null; cost?: number | null; version: number;
  voiceAssetId?: string | null; voiceDurationSec?: number | null;
}
interface Project {
  id: string; title: string; durationSec: number; aspectRatio: string; language: string;
  script?: string | null; characterBibleJson?: string | null; styleBibleJson?: string | null;
  status: string; createdAt: string; updatedAt: string; scenes?: Scene[]; _count?: { scenes: number };
  finalAssetId?: string | null; metaJson?: string | null;
  subtitleTracks?: SubTrackInfo[];
}
interface JobInfo { id: string; status: string; error?: string | null }
interface Cue { index: number; start: number; end: number; text: string; timing: string }
interface SubTrackInfo { id: string; language: string; format: string; cueCount: number; measured?: number; estimated?: number; createdAt: string; cues?: Cue[] }
interface MusicEdit {
  volume: number; trimStartSec: number; trimEndSec: number | null;
  fadeInSec: number; fadeOutSec: number; loop: boolean; duckEnabled: boolean; duckDb: number | null;
}
interface MusicItem {
  id: string; title: string; source: string | null; durationSec: number | null;
  meta: { edit?: Partial<MusicEdit> };
  asset: { id: string; url: string; mimeType: string; size: number } | null;
}
interface VoiceoverMeta {
  assetId?: string; enabled?: boolean; duckMusic?: boolean; mode?: string;
  text?: string; textSource?: string; voice?: string; speed?: number; generatedAt?: string;
}
interface SubtitlesConfig { trackId?: string; enabled?: boolean; burnIn?: boolean }

const VOICEOVER_LIMIT = 2000;

function parseProjectMeta(raw: string | null | undefined): { soundtrack?: { musicAssetId: string; loopOverride: boolean }; voiceover?: VoiceoverMeta | null; subtitles?: SubtitlesConfig | null; assembly?: { voiceMode?: string | null; subtitlesBurnedIn?: boolean; hasVoice?: boolean; durationSec?: number } | Record<string, unknown> } {
  try { return raw ? (JSON.parse(raw) as Record<string, never>) : {}; } catch { return {}; }
}

/** Default narration text: scene narrations (in order) → full script → empty. */
function defaultVoiceText(p: Project | null): string {
  if (!p) return "";
  const narrations = (p.scenes ?? []).map((s) => (s.narration ?? "").trim()).filter(Boolean);
  if (narrations.length) return narrations.join("\n\n");
  return p.script?.trim() ?? "";
}

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
  const [narrDrafts, setNarrDrafts] = useState<Record<string, string>>({});
  const [savingNarr, setSavingNarr] = useState<string | null>(null);
  const [sceneBusy, setSceneBusy] = useState<string | null>(null);
  const [polls, setPolls] = useState<Record<string, { jobId: string; elapsed: number }>>({});
  const pollsRef = useRef(polls);
  pollsRef.current = polls;
  const [charRows, setCharRows] = useState<BibleRows>([]);
  const [styleRows, setStyleRows] = useState<BibleRows>([]);
  const [savingBible, setSavingBible] = useState<"char" | "style" | null>(null);

  // final assembly state
  const [musicList, setMusicList] = useState<MusicItem[]>([]);
  const [soundtrackId, setSoundtrackId] = useState<string>("");
  const [loopOverride, setLoopOverride] = useState(false);
  const [savingTrack, setSavingTrack] = useState(false);
  const [assembleJob, setAssembleJob] = useState<{ jobId: string; elapsed: number } | null>(null);
  const assembleJobRef = useRef(assembleJob);
  assembleJobRef.current = assembleJob;

  // voiceover state
  const [voiceText, setVoiceText] = useState("");
  const [voiceSpeed, setVoiceSpeed] = useState("1");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceAssetId, setVoiceAssetId] = useState<string | null>(null);
  const [voiceInfo, setVoiceInfo] = useState<{ textSource?: string; generatedAt?: string; chars?: number } | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceDuck, setVoiceDuck] = useState(true);
  const [voiceDur, setVoiceDur] = useState<number | null>(null);
  const [savingVoice, setSavingVoice] = useState(false);

  // per-scene voiceover (§ per-scene) + §23 subtitles state
  const [voiceMode, setVoiceMode] = useState<"single" | "perScene">("single");
  const [sceneVoiceBusy, setSceneVoiceBusy] = useState<string | null>(null);
  const [genAll, setGenAll] = useState<{ done: number; total: number } | null>(null);
  const [subTracks, setSubTracks] = useState<SubTrackInfo[]>([]);
  const [subTrackId, setSubTrackId] = useState<string>("");
  const [subCues, setSubCues] = useState<Cue[]>([]);
  const [subCuesDirty, setSubCuesDirty] = useState(false);
  const [subBusy, setSubBusy] = useState(false);
  const [subBurnIn, setSubBurnIn] = useState(false);
  const [savingSubs, setSavingSubs] = useState(false);

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

  const loadMusic = useCallback(async () => {
    try {
      const lib = await api<{ items: MusicItem[] }>("/api/music");
      setMusicList(lib.items ?? []);
    } catch {
      /* music list is optional for assembly — honest empty select */
    }
  }, []);

  const loadSubTracks = useCallback(async (projectId: string, preferId?: string) => {
    try {
      const p = await api<Project>(`/api/video-projects?id=${projectId}`);
      const tracks = p.subtitleTracks ?? [];
      setSubTracks(tracks);
      const nextId = preferId && tracks.some((tr) => tr.id === preferId) ? preferId : (tracks[0]?.id ?? "");
      setSubTrackId(nextId);
      setSubCues(tracks.find((tr) => tr.id === nextId)?.cues ?? []);
      setSubCuesDirty(false);
    } catch {
      /* subtitle tracks are optional — keep current state */
    }
  }, []);

  const openProject = useCallback(async (id: string) => {
    try {
      const p = await api<Project>(`/api/video-projects?id=${id}`);
      setProject(p);
      setScriptBrief("");
      setPromptDrafts({});
      setCharRows(parseBible(p.characterBibleJson));
      setStyleRows(parseBible(p.styleBibleJson));
      const meta = parseProjectMeta(p.metaJson);
      setSoundtrackId(meta.soundtrack?.musicAssetId ?? "");
      setLoopOverride(Boolean(meta.soundtrack?.loopOverride));
      const vo = meta.voiceover ?? null;
      setVoiceAssetId(vo?.assetId ?? null);
      setVoiceInfo(vo ? { textSource: vo.textSource, generatedAt: vo.generatedAt } : null);
      setVoiceText(vo?.text ?? defaultVoiceText(p));
      setVoiceEnabled(vo ? vo.enabled !== false : true);
      setVoiceDuck(vo ? vo.duckMusic !== false : true);
      setVoiceDur(null);
      setVoiceMode(vo?.mode === "perScene" ? "perScene" : "single");
      setSubBurnIn(Boolean(meta.subtitles?.burnIn));
      setView("editor");
      void loadMusic();
      void loadSubTracks(id, meta.subtitles?.trackId);
      try {
        window.localStorage.setItem(LAST_PROJECT_KEY, id);
      } catch { /* non-critical */ }
      for (const sc of p.scenes ?? []) {
        if (sc.jobId && ["GENERATING", "QUEUED"].includes(sc.status)) startPoll(sc.id, sc.jobId);
      }
    } catch (err) {
      showStudioError(t, err);
    }
  }, [startPoll, loadMusic, loadSubTracks]);

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

  // § per-scene voiceover: narration is the TTS / subtitle source text.
  // Server honestly detaches a stale voice clip when the text actually changed.
  const saveSceneNarration = async (sceneId: string) => {
    if (!project) return;
    const narration = narrDrafts[sceneId];
    if (narration === undefined) return;
    setSavingNarr(sceneId);
    try {
      const before = project.scenes?.find((s) => s.id === sceneId);
      const voiceDetached = Boolean(before?.voiceAssetId) && narration.trim() !== (before?.narration ?? "").trim();
      const updated = await api<Project>("/api/video-projects", {
        method: "PATCH",
        body: JSON.stringify({ projectId: project.id, sceneId, narration }),
      });
      if (updated?.scenes) setProject((prev) => (prev ? { ...prev, scenes: updated.scenes } : prev));
      setNarrDrafts((prev) => {
        const next = { ...prev };
        delete next[sceneId];
        return next;
      });
      toast.success(t("studio.vid.narrSaved"), {
        description: voiceDetached ? t("studio.vid.narrVoiceStale") : undefined,
      });
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setSavingNarr(null);
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
  const readyScenes = scenes.filter((s) => s.status === "COMPLETED" && s.assetId);
  const estVideoDur = scenes.reduce((sum, s) => sum + s.durationSec, 0);
  const selectedMusic = musicList.find((m) => m.id === soundtrackId) ?? null;
  const selectedEdit = selectedMusic?.meta?.edit ?? null;
  const estTotal = scenes.reduce((sum, s) => sum + (s.cost ?? (s.status === "COMPLETED" ? 0 : 0.1)), 0);
  const voicedScenes = scenes.filter((s) => s.voiceAssetId);
  const voicelessWithNarration = scenes.filter((s) => (s.narration ?? "").trim() && !s.voiceAssetId);
  const selectedSubTrack = subTracks.find((tr) => tr.id === subTrackId) ?? null;
  const measuredCues = subCues.filter((c) => c.timing === "measured").length;
  const estimatedCues = subCues.filter((c) => c.timing !== "measured").length;
  const assemblyInfo = project ? (parseProjectMeta(project.metaJson).assembly ?? null) : null;
  const assemblyVoiceMode = (assemblyInfo as { voiceMode?: string | null } | null)?.voiceMode ?? null;
  const subsBurned = Boolean((assemblyInfo as { subtitlesBurnedIn?: boolean } | null)?.subtitlesBurnedIn);

  const saveSoundtrack = async (musicId: string, loop: boolean) => {
    if (!project) return;
    setSavingTrack(true);
    try {
      await api<Project>("/api/video-projects", {
        method: "PATCH",
        body: JSON.stringify({ projectId: project.id, soundtrack: musicId ? { musicAssetId: musicId, loopOverride: loop } : null }),
      });
      toast.success(t("studio.vid.assembly.trackSaved"));
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setSavingTrack(false);
    }
  };

  const changeSoundtrack = (musicId: string) => {
    const id = musicId === "none" ? "" : musicId;
    setSoundtrackId(id);
    const item = musicList.find((m) => m.id === id);
    setLoopOverride(Boolean(item?.meta?.edit?.loop));
    void saveSoundtrack(id, Boolean(item?.meta?.edit?.loop));
  };

  const toggleLoop = (checked: boolean) => {
    setLoopOverride(checked);
    void saveSoundtrack(soundtrackId, checked);
  };

  const generateVoiceover = async () => {
    if (!project) return;
    const text = voiceText.trim();
    if (text.length > VOICEOVER_LIMIT) {
      toast.warning(t("studio.vid.voice.tooLong", { n: text.length, max: VOICEOVER_LIMIT }));
      return;
    }
    setVoiceBusy(true);
    pulseCore("GENERATING");
    try {
      const res = await api<{ assetId: string; chars: number; textSource: string }>("/api/generate/video", {
        method: "POST",
        body: JSON.stringify({
          action: "generate_voiceover",
          projectId: project.id,
          text: text || undefined, // empty → server builds from scene narrations / script
          speed: Number(voiceSpeed) || 1,
        }),
      });
      setVoiceAssetId(res.assetId);
      setVoiceInfo({ textSource: res.textSource, chars: res.chars, generatedAt: new Date().toISOString() });
      setVoiceEnabled(true);
      setVoiceDur(null);
      pulseCore("SUCCESS");
      toast.success(t("studio.vid.voice.generated"));
      await refreshProject();
    } catch (err) {
      pulseCore("ERROR");
      showStudioError(t, err);
    } finally {
      setVoiceBusy(false);
    }
  };

  const saveVoiceConfig = async (patch: { enabled?: boolean; duckMusic?: boolean; remove?: boolean }) => {
    if (!project) return;
    setSavingVoice(true);
    try {
      await api<Project>("/api/video-projects", {
        method: "PATCH",
        body: JSON.stringify({ projectId: project.id, voiceover: patch }),
      });
      await refreshProject();
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setSavingVoice(false);
    }
  };

  const toggleVoiceEnabled = (checked: boolean) => {
    setVoiceEnabled(checked);
    void saveVoiceConfig({ enabled: checked });
  };

  const toggleVoiceDuck = (checked: boolean) => {
    setVoiceDuck(checked);
    void saveVoiceConfig({ duckMusic: checked });
  };

  const detachVoiceover = async () => {
    setVoiceAssetId(null);
    setVoiceInfo(null);
    setVoiceDur(null);
    await saveVoiceConfig({ remove: true });
    toast.info(t("studio.vid.voice.detached"));
  };

  // ---- voiceover mode (single vs per-scene) — config-only PATCH, settable before audio exists
  const changeVoiceMode = async (mode: "single" | "perScene") => {
    if (!project || mode === voiceMode) return;
    setVoiceMode(mode);
    try {
      await api<Project>("/api/video-projects", {
        method: "PATCH",
        body: JSON.stringify({ projectId: project.id, voiceover: { mode } }),
      });
    } catch (err) {
      showStudioError(t, err);
    }
  };

  // ---- per-scene voiceover: TTS for ONE scene (uses the shared speed selector)
  const generateSceneVoiceover = async (scene: Scene) => {
    if (!project) return;
    setSceneVoiceBusy(scene.id);
    pulseCore("GENERATING");
    try {
      const res = await api<{ assetId: string; voiceDurationSec: number | null }>("/api/generate/video", {
        method: "POST",
        body: JSON.stringify({ action: "generate_scene_voiceover", sceneId: scene.id, speed: Number(voiceSpeed) || 1 }),
      });
      pulseCore("SUCCESS");
      toast.success(
        res.voiceDurationSec != null
          ? t("studio.vid.sceneVoice.duration", { sec: res.voiceDurationSec.toFixed(1) })
          : t("studio.vid.voice.generated")
      );
      await refreshProject();
    } catch (err) {
      pulseCore("ERROR");
      showStudioError(t, err);
    } finally {
      setSceneVoiceBusy(null);
    }
  };

  // ---- sequential "voice all scenes": honest progress, stops on the first real failure
  const generateAllVoices = async () => {
    if (!project) return;
    const targets = (project.scenes ?? []).filter((s) => (s.narration ?? "").trim() && !s.voiceAssetId);
    if (targets.length === 0) return;
    setGenAll({ done: 0, total: targets.length });
    pulseCore("GENERATING");
    let done = 0;
    for (const scene of targets) {
      try {
        await api("/api/generate/video", {
          method: "POST",
          body: JSON.stringify({ action: "generate_scene_voiceover", sceneId: scene.id, speed: Number(voiceSpeed) || 1 }),
        });
        done += 1;
        setGenAll({ done, total: targets.length });
      } catch (err) {
        showStudioError(t, err);
        pulseCore("ERROR");
        break;
      }
    }
    setGenAll(null);
    pulseCore("SUCCESS");
    await refreshProject();
  };

  const removeSceneVoice = async (scene: Scene) => {
    if (!project) return;
    setSceneVoiceBusy(scene.id);
    try {
      await api<Project>("/api/video-projects", {
        method: "PATCH",
        body: JSON.stringify({ projectId: project.id, sceneId: scene.id, voice: { remove: true } }),
      });
      toast.info(t("studio.vid.sceneVoice.remove"));
      await refreshProject();
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setSceneVoiceBusy(null);
    }
  };

  // ---- §23 subtitles manager ----
  const generateSubs = async () => {
    if (!project) return;
    setSubBusy(true);
    try {
      const res = await api<{ id: string; cues: Cue[] }>("/api/video-projects/subtitles", {
        method: "POST",
        body: JSON.stringify({ projectId: project.id }),
      });
      await loadSubTracks(project.id, res.id);
      toast.success(t("studio.vid.sub.cues", { n: res.cues.length }));
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setSubBusy(false);
    }
  };

  const selectSubTrack = (id: string) => {
    const track = subTracks.find((tr) => tr.id === id);
    setSubTrackId(id);
    setSubCues(track?.cues ?? []);
    setSubCuesDirty(false);
  };

  const updateCue = (index: number, field: "start" | "end" | "text", value: string | number) => {
    setSubCues((prev) =>
      prev.map((c, i) => {
        if (i !== index) return c;
        if (field === "text") return { ...c, text: String(value) };
        const num = Number(value);
        return { ...c, [field]: Number.isFinite(num) ? num : c[field] } as Cue;
      })
    );
    setSubCuesDirty(true);
  };

  const saveSubCues = async () => {
    if (!subTrackId) return;
    setSubBusy(true);
    try {
      const res = await api<{ cues: Cue[] }>("/api/video-projects/subtitles", {
        method: "PATCH",
        body: JSON.stringify({
          trackId: subTrackId,
          cues: subCues.map((c) => ({ start: c.start, end: c.end, text: c.text })),
        }),
      });
      setSubCues(res.cues);
      setSubCuesDirty(false);
      toast.success(t("studio.vid.sub.saved"));
      await refreshProject();
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setSubBusy(false);
    }
  };

  const toggleBurnIn = async (checked: boolean) => {
    if (!project) return;
    setSubBurnIn(checked);
    if (!subTrackId) return;
    setSavingSubs(true);
    try {
      await api<Project>("/api/video-projects", {
        method: "PATCH",
        body: JSON.stringify({ projectId: project.id, subtitles: { trackId: subTrackId, burnIn: checked } }),
      });
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setSavingSubs(false);
    }
  };

  const deleteSubTrack = async () => {
    if (!project || !subTrackId) return;
    setSubBusy(true);
    try {
      await api(`/api/video-projects/subtitles?id=${subTrackId}`, { method: "DELETE" });
      toast.info(t("studio.vid.sub.deleted"));
      await loadSubTracks(project.id);
      await refreshProject();
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setSubBusy(false);
    }
  };

  const startAssembly = async () => {
    if (!project) return;
    pulseCore("GENERATING");
    try {
      const res = await api<{ jobId: string }>("/api/generate/video", {
        method: "POST",
        body: JSON.stringify({ action: "assemble_project", projectId: project.id }),
      });
      setAssembleJob({ jobId: res.jobId, elapsed: 0 });
    } catch (err) {
      pulseCore("ERROR");
      showStudioError(t, err);
    }
  };

  // assembly job polling: 3s — ffmpeg runs server-side in the durable ASSEMBLE job.
  // Depends on the boolean, NOT the object: the elapsed counter rewrites the object
  // every second, and an object identity dependency would reset this 3s interval
  // before it ever fires (discovered in browser QA — polls never ran).
  const assembleActive = Boolean(assembleJob);
  useEffect(() => {
    if (!assembleActive) return;
    const iv = setInterval(async () => {
      const cur = assembleJobRef.current;
      if (!cur) return;
      try {
        const job = await api<JobInfo>(`/api/jobs/${cur.jobId}`);
        if (job.status === "COMPLETED") {
          setAssembleJob(null);
          await refreshProject();
          pulseCore("SUCCESS");
          toast.success(t("studio.vid.assembly.done"));
        } else if (["FAILED", "CANCELLED", "NEEDS_USER_ACTION"].includes(job.status)) {
          setAssembleJob(null);
          pulseCore("ERROR");
          toast.error(t("studio.err.generic", { msg: job.error ?? "assembly failed" }));
        }
      } catch {
        /* transient — keep polling */
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [assembleActive, refreshProject, t]);

  // assembly elapsed counter
  useEffect(() => {
    if (!assembleActive) return;
    const iv = setInterval(() => setAssembleJob((prev) => (prev ? { ...prev, elapsed: prev.elapsed + 1 } : prev)), 1000);
    return () => clearInterval(iv);
  }, [assembleActive]);

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
    // grid-cols-1 (minmax(0,1fr)) — без неё implicit track растягивается под
    // max-content горизонтального стрипа сцен и ломает mobile-layout
    <div className="grid grid-cols-1 gap-5">
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
                          <video controls src={assetUrl(`/api/assets/${scene.assetId}/raw`)} className="w-full rounded-lg border border-border/60" aria-label={t("studio.vid.scene", { n: scene.order + 1 })} />
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

                        {/* § narration — editable TTS/subtitle source text */}
                        <div className="grid gap-1.5">
                          <Label htmlFor={`scnarr-${scene.id}`} className="text-[11px] text-muted-foreground">
                            {t("studio.vid.narration")}
                          </Label>
                          <Textarea
                            id={`scnarr-${scene.id}`}
                            value={narrDrafts[scene.id] ?? scene.narration ?? ""}
                            onChange={(e) => setNarrDrafts((prev) => ({ ...prev, [scene.id]: e.target.value }))}
                            rows={2}
                            maxLength={1000}
                            placeholder={t("studio.vid.narrationPlaceholder")}
                            className="resize-none text-[12px]"
                          />
                          {(narrDrafts[scene.id] ?? scene.narration ?? "") !== (scene.narration ?? "") && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-9 gap-1.5 text-xs"
                              disabled={savingNarr === scene.id}
                              onClick={() => saveSceneNarration(scene.id)}
                            >
                              {savingNarr === scene.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 text-[var(--neon-2)]" />}
                              {t("studio.vid.saveNarration")}
                            </Button>
                          )}
                        </div>

                        {/* per-scene voice clip (§ per-scene voiceover) */}
                        {voiceMode === "perScene" && (
                          <div className="grid gap-1.5 rounded-lg border border-border/60 bg-muted/10 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                                <Mic className="h-3 w-3" aria-hidden /> {t("studio.vid.voice.title")}
                              </span>
                              {scene.voiceAssetId ? (
                                <div className="flex items-center gap-1">
                                  {scene.voiceDurationSec != null && (
                                    <Badge variant="outline" className="text-[10px] border-[var(--neon-2)]/50 text-[var(--neon-2)]">
                                      {t("studio.vid.sceneVoice.duration", { sec: scene.voiceDurationSec.toFixed(1) })}
                                    </Badge>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    aria-label={t("studio.vid.sceneVoice.regen")}
                                    title={t("studio.vid.sceneVoice.regen")}
                                    disabled={sceneVoiceBusy === scene.id || Boolean(genAll)}
                                    onClick={() => generateSceneVoiceover(scene)}
                                  >
                                    <RotateCcw className="h-3 w-3 text-[var(--neon-3)]" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    aria-label={t("studio.vid.sceneVoice.remove")}
                                    title={t("studio.vid.sceneVoice.remove")}
                                    disabled={sceneVoiceBusy === scene.id}
                                    onClick={() => removeSceneVoice(scene)}
                                  >
                                    <Trash2 className="h-3 w-3 text-destructive" />
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="min-h-9 gap-1 px-2 text-[11px]"
                                  disabled={sceneVoiceBusy === scene.id || Boolean(genAll) || !(scene.narration ?? "").trim()}
                                  onClick={() => generateSceneVoiceover(scene)}
                                >
                                  {sceneVoiceBusy === scene.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mic className="h-3 w-3 text-[var(--neon-3)]" />}
                                  {sceneVoiceBusy === scene.id
                                    ? t("studio.vid.sceneVoice.busy")
                                    : (scene.narration ?? "").trim()
                                      ? t("studio.vid.sceneVoice.generate")
                                      : t("studio.vid.sceneVoice.noNarration")}
                                </Button>
                              )}
                            </div>
                            {scene.voiceAssetId && (
                              <audio
                                controls
                                preload="metadata"
                                src={assetUrl(`/api/assets/${scene.voiceAssetId}/raw`)}
                                className="h-8 w-full"
                                aria-label={t("studio.vid.voice.title")}
                              />
                            )}
                          </div>
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

          {/* final assembly */}
          <Card className="glass-strong neon-border rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <FileVideo className="h-4 w-4 text-[var(--neon)]" /> {t("studio.vid.assembly.title")}
                <Badge variant="outline" className={`text-[10px] ${readyScenes.length > 0 ? "border-[var(--neon-2)]/50 text-[var(--neon-2)]" : "text-muted-foreground"}`}>
                  {t("studio.vid.assembly.ready", { ready: readyScenes.length, total: scenes.length })}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {/* soundtrack picker */}
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end sm:gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="vid-track" className="flex items-center gap-1.5">
                    <Music4 className="h-3.5 w-3.5 text-[var(--neon-3)]" /> {t("studio.vid.assembly.soundtrack")}
                  </Label>
                  <Select value={soundtrackId} onValueChange={changeSoundtrack}>
                    <SelectTrigger id="vid-track" className="min-h-11 w-full">
                      <SelectValue placeholder={t("studio.vid.assembly.soundtrackNone")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("studio.vid.assembly.soundtrackNone")}</SelectItem>
                      {musicList.map((m) => (
                        <SelectItem key={m.id} value={m.id} disabled={!m.asset}>
                          {m.title}
                          {m.durationSec ? ` · ${Math.round(m.durationSec)}s` : ""}
                          {!m.asset ? ` · ${t("studio.vid.assembly.lyricsOnly")}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedMusic && (
                  <div className="flex items-center gap-2 pb-1">
                    <Switch id="vid-loop" checked={loopOverride} onCheckedChange={toggleLoop} disabled={savingTrack} />
                    <Label htmlFor="vid-loop" className="text-xs text-muted-foreground">{t("studio.vid.assembly.loop")}</Label>
                  </div>
                )}
              </div>

              {/* applied edit-intents (§20) — honest: these are applied by ffmpeg at assembly time */}
              {selectedEdit && selectedMusic?.asset && (
                <div className="grid gap-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {selectedEdit.volume !== undefined && selectedEdit.volume !== 1 && (
                      <Badge variant="outline" className="text-[10px]">vol ×{selectedEdit.volume}</Badge>
                    )}
                    {Boolean(selectedEdit.trimStartSec || selectedEdit.trimEndSec) && (
                      <Badge variant="outline" className="text-[10px]">trim {selectedEdit.trimStartSec ?? 0}–{selectedEdit.trimEndSec ?? "∞"}s</Badge>
                    )}
                    {Boolean(selectedEdit.fadeInSec) && <Badge variant="outline" className="text-[10px]">fade-in {selectedEdit.fadeInSec}s</Badge>}
                    {Boolean(selectedEdit.fadeOutSec) && <Badge variant="outline" className="text-[10px]">fade-out {selectedEdit.fadeOutSec}s</Badge>}
                    {loopOverride && <Badge variant="outline" className="text-[10px]">loop</Badge>}
                    {selectedEdit.duckEnabled && <Badge variant="outline" className="text-[10px] text-muted-foreground">duck ⏸</Badge>}
                  </div>
                  <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    <Info className="mt-0.5 h-3 w-3 shrink-0 text-[var(--neon-2)]" />
                    {t("studio.vid.assembly.chipsNote")}
                  </p>
                  {selectedEdit.duckEnabled && (
                    <p className="text-[11px] text-muted-foreground">{t("studio.vid.assembly.duckNote")}</p>
                  )}
                  {!loopOverride && selectedMusic.durationSec != null && selectedMusic.durationSec < estVideoDur && (
                    <p className="text-[11px] text-amber-500">{t("studio.vid.assembly.shortHint", { music: Math.round(selectedMusic.durationSec), video: Math.round(estVideoDur) })}</p>
                  )}
                </div>
              )}
              {!soundtrackId && (
                <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" /> {t("studio.vid.assembly.silentNote")}
                </p>
              )}

              {/* voiceover (TTS narration) — mixed into the final MP4 with real sidechain ducking */}
              <div className="grid gap-3 rounded-xl border border-border/60 bg-muted/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="flex items-center gap-1.5 text-sm font-medium">
                    <Mic className="h-4 w-4 text-[var(--neon-3)]" /> {t("studio.vid.voice.title")}
                  </Label>
                  <div className="flex items-center gap-2">
                    {voiceAssetId && (
                      <>
                        <Badge variant="outline" className={`text-[10px] ${voiceEnabled ? "border-[var(--neon-2)]/50 text-[var(--neon-2)]" : "text-muted-foreground"}`}>
                          {voiceEnabled ? t("studio.vid.voice.included") : t("studio.vid.voice.excluded")}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={savingVoice}
                          aria-label={t("studio.vid.voice.detach")}
                          title={t("studio.vid.voice.detach")}
                          onClick={detachVoiceover}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* voiceover mode: single track vs per-scene clips (§ per-scene voiceover) */}
                <div className="grid gap-2">
                  <Label className="text-[11px] text-muted-foreground">{t("studio.vid.voice.mode")}</Label>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("studio.vid.voice.mode")}>
                    {(["single", "perScene"] as const).map((m) => (
                      <button
                        key={m}
                        role="radio"
                        aria-checked={voiceMode === m}
                        onClick={() => changeVoiceMode(m)}
                        className={`glass glass-hover min-h-11 rounded-xl px-4 text-xs transition ${voiceMode === m ? "neon-border neon-text" : "border border-border/60"}`}
                      >
                        {t(`studio.vid.voice.mode.${m}` as const)}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t("studio.vid.voice.modeNote")}</p>
                </div>

                {voiceMode === "perScene" && (
                  <div className="grid gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-2.5">
                    {voiceAssetId && (
                      <p className="flex items-start gap-1.5 text-[11px] text-amber-500">
                        <Info className="mt-0.5 h-3 w-3 shrink-0" /> {t("studio.vid.voice.perSceneActive")}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        {t("studio.vid.voice.voicedCount", { voiced: voicedScenes.length, total: scenes.length })}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 gap-1.5 text-xs"
                        disabled={Boolean(genAll) || voicelessWithNarration.length === 0}
                        onClick={generateAllVoices}
                      >
                        {genAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5 text-[var(--neon-3)]" />}
                        {genAll
                          ? t("studio.vid.voice.generateAllProgress", { done: genAll.done, total: genAll.total })
                          : t("studio.vid.voice.generateAll")}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="vid-vo-text" className="text-[11px] text-muted-foreground">{t("studio.vid.voice.text")}</Label>
                    <span className={`text-[10px] ${voiceText.length > VOICEOVER_LIMIT ? "text-destructive" : "text-muted-foreground"}`}>
                      {voiceText.length}/{VOICEOVER_LIMIT}
                    </span>
                  </div>
                  <Textarea
                    id="vid-vo-text"
                    value={voiceText}
                    onChange={(e) => setVoiceText(e.target.value)}
                    rows={3}
                    className="resize-none text-[13px] leading-relaxed"
                    placeholder={t("studio.vid.voice.textPh")}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="vid-vo-speed" className="text-[11px] text-muted-foreground">{t("studio.vid.voice.speed")}</Label>
                      <Select value={voiceSpeed} onValueChange={setVoiceSpeed}>
                        <SelectTrigger id="vid-vo-speed" className="h-9 w-[92px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["0.8", "0.9", "1", "1.1", "1.2"].map((s) => (
                            <SelectItem key={s} value={s}>×{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 gap-1.5 text-xs"
                      disabled={voiceBusy || !voiceText.trim() || voiceText.length > VOICEOVER_LIMIT}
                      onClick={generateVoiceover}
                    >
                      {voiceBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5 text-[var(--neon-3)]" />}
                      {voiceAssetId ? t("studio.vid.voice.regen") : t("studio.vid.voice.generate")}
                    </Button>
                  </div>
                  {!voiceText.trim() && (
                    <p className="text-[11px] text-muted-foreground">{t("studio.vid.voice.emptyHint")}</p>
                  )}
                  {voiceText.length > VOICEOVER_LIMIT && (
                    <p className="text-[11px] text-destructive">{t("studio.vid.voice.tooLong", { n: voiceText.length, max: VOICEOVER_LIMIT })}</p>
                  )}
                </div>

                {voiceAssetId && (
                  <div className="grid gap-2">
                    <audio
                      controls
                      preload="metadata"
                      src={assetUrl(`/api/assets/${voiceAssetId}/raw`)}
                      className="h-9 w-full"
                      onLoadedMetadata={(e) => {
                        const el = e.currentTarget;
                        if (Number.isFinite(el.duration)) {
                          setVoiceDur(el.duration);
                          return;
                        }
                        // Streamed audio reports Infinity — force a metadata seek (standard workaround)
                        el.currentTime = 1e101;
                        const handler = () => {
                          el.removeEventListener("timeupdate", handler);
                          if (Number.isFinite(el.duration)) setVoiceDur(el.duration);
                          el.currentTime = 0;
                        };
                        el.addEventListener("timeupdate", handler);
                      }}
                      aria-label={t("studio.vid.voice.title")}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] text-muted-foreground">
                        {voiceInfo?.chars ? `${voiceInfo.chars} ${t("studio.vid.voice.charsUnit")}` : ""}
                        {voiceInfo?.textSource ? ` · ${t(`studio.vid.voice.source.${voiceInfo.textSource === "narrations" ? "narrations" : voiceInfo.textSource === "script" ? "script" : "user"}` as const)}` : ""}
                        {voiceDur != null && Number.isFinite(voiceDur) ? ` · ${voiceDur.toFixed(1)}s` : ""}
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <Switch id="vid-vo-include" checked={voiceEnabled} onCheckedChange={toggleVoiceEnabled} disabled={savingVoice} />
                          <Label htmlFor="vid-vo-include" className="text-[11px] text-muted-foreground">{t("studio.vid.voice.include")}</Label>
                        </div>
                        {soundtrackId && (
                          <div className="flex items-center gap-1.5">
                            <Switch id="vid-vo-duck" checked={voiceDuck} onCheckedChange={toggleVoiceDuck} disabled={savingVoice} />
                            <Label htmlFor="vid-vo-duck" className="text-[11px] text-muted-foreground">{t("studio.vid.voice.duck")}</Label>
                          </div>
                        )}
                      </div>
                    </div>
                    {voiceDuck && soundtrackId && (
                      <p className="text-[11px] text-muted-foreground">{t("studio.vid.voice.duckNote")}</p>
                    )}
                    {voiceDur != null && estVideoDur > 0 && voiceDur > estVideoDur + 0.5 && (
                      <p className="text-[11px] text-amber-500">{t("studio.vid.voice.longerThanVideo", { voice: voiceDur.toFixed(0), video: Math.round(estVideoDur) })}</p>
                    )}
                  </div>
                )}
              </div>

              {/* §23 subtitles manager: deterministic cues from ready scenes, editable, SRT/VTT sidecar, burn-in */}
              <div className="grid gap-3 rounded-xl border border-border/60 bg-muted/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="flex items-center gap-1.5 text-sm font-medium">
                    <Captions className="h-4 w-4 text-[var(--neon-2)]" /> {t("studio.vid.sub.title")}
                  </Label>
                  {selectedSubTrack && (
                    <Badge variant="outline" className="text-[10px] border-[var(--neon-2)]/50 text-[var(--neon-2)]">
                      {t("studio.vid.sub.cues", { n: subCues.length })}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">{t("studio.vid.sub.subtitle")}</p>
                {scenes.length > 0 && readyScenes.length < scenes.length && (
                  <p className="text-[11px] text-amber-500">{t("studio.vid.sub.pendingNote", { ready: readyScenes.length, total: scenes.length })}</p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" className="min-h-11 gap-1.5 text-xs" disabled={subBusy} onClick={generateSubs}>
                    {subBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Captions className="h-3.5 w-3.5 text-[var(--neon-2)]" />}
                    {subBusy ? t("studio.vid.sub.generating") : t("studio.vid.sub.generate")}
                  </Button>
                  {subTracks.length > 1 && (
                    <Select value={subTrackId} onValueChange={selectSubTrack}>
                      <SelectTrigger className="h-11 w-[190px] text-xs" aria-label={t("studio.vid.sub.trackSelect")}>
                        <SelectValue placeholder={t("studio.vid.sub.trackSelect")} />
                      </SelectTrigger>
                      <SelectContent>
                        {subTracks.map((tr) => (
                          <SelectItem key={tr.id} value={tr.id}>
                            {new Date(tr.createdAt).toLocaleTimeString()} · {tr.language.toUpperCase()} · {t("studio.vid.sub.cues", { n: tr.cueCount })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {selectedSubTrack && (
                    <>
                      <a
                        href={assetUrl(`/api/video-projects/subtitles?id=${subTrackId}&format=srt`)}
                        download
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border/60 px-3 text-xs transition hover:bg-muted/40"
                      >
                        <Download className="h-3.5 w-3.5 text-[var(--neon)]" /> SRT
                      </a>
                      <a
                        href={assetUrl(`/api/video-projects/subtitles?id=${subTrackId}&format=vtt`)}
                        download
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border/60 px-3 text-xs transition hover:bg-muted/40"
                      >
                        <Download className="h-3.5 w-3.5 text-[var(--neon-3)]" /> VTT
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11"
                        aria-label={t("studio.vid.sub.delete")}
                        title={t("studio.vid.sub.delete")}
                        disabled={subBusy}
                        onClick={deleteSubTrack}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>

                {selectedSubTrack ? (
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Switch id="vid-sub-burn" checked={subBurnIn} onCheckedChange={toggleBurnIn} disabled={savingSubs || subBusy} />
                      <Label htmlFor="vid-sub-burn" className="text-[11px] text-muted-foreground">{t("studio.vid.sub.burnIn")}</Label>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{t("studio.vid.sub.burnInNote")}</p>

                    <div className="grid max-h-72 gap-2 overflow-y-auto scrollbar-thin pr-1">
                      {subCues.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t("studio.vid.sub.empty")}</p>
                      ) : (
                        subCues.map((cue, i) => (
                          <div key={`${i}-${cue.index}`} className="grid grid-cols-[64px_64px_1fr] items-center gap-1.5 sm:grid-cols-[72px_72px_1fr]">
                            <Input
                              type="number"
                              step="0.1"
                              min="0"
                              value={cue.start}
                              onChange={(e) => updateCue(i, "start", e.target.value)}
                              className="h-9 text-[11px] font-mono"
                              aria-label={`${t("studio.vid.sub.cueStart")} ${i + 1}`}
                            />
                            <Input
                              type="number"
                              step="0.1"
                              min="0"
                              value={cue.end}
                              onChange={(e) => updateCue(i, "end", e.target.value)}
                              className="h-9 text-[11px] font-mono"
                              aria-label={`${t("studio.vid.sub.cueEnd")} ${i + 1}`}
                            />
                            <div className="flex items-center gap-1.5">
                              <Input
                                value={cue.text}
                                onChange={(e) => updateCue(i, "text", e.target.value)}
                                className="h-9 text-xs"
                                aria-label={`${t("studio.vid.sub.cues", { n: i + 1 })}`}
                              />
                              <Badge
                                variant="outline"
                                className={`shrink-0 text-[9px] ${cue.timing === "measured" ? "border-[var(--neon-2)]/50 text-[var(--neon-2)]" : cue.timing === "edited" ? "border-[var(--neon)]/50 text-[var(--neon)]" : "text-muted-foreground"}`}
                              >
                                {t(`studio.vid.sub.timing.${cue.timing}` as const)}
                              </Badge>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] text-muted-foreground">
                        {t("studio.vid.sub.measuredInfo", { measured: measuredCues, estimated: estimatedCues })}
                      </p>
                      {subCuesDirty && (
                        <Button size="sm" className="min-h-11 gap-1.5 text-xs" onClick={saveSubCues} disabled={subBusy}>
                          {subBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          {t("studio.vid.sub.saveCues")}
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("studio.vid.sub.trackNone")}</p>
                )}
              </div>

              {/* readiness + action */}
              <div className="grid gap-2">
                {readyScenes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("studio.vid.assembly.noScenes")}</p>
                ) : readyScenes.length < scenes.length ? (
                  <p className="text-sm text-amber-500">{t("studio.vid.assembly.skipNote", { ready: readyScenes.length, total: scenes.length, pending: scenes.length - readyScenes.length })}</p>
                ) : null}
                {assembleJob ? (
                  <Button variant="outline" size="lg" className="min-h-11 gap-2" disabled>
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--neon)]" />
                    {t("studio.vid.assembly.assembling", { sec: assembleJob.elapsed })}
                  </Button>
                ) : (
                  <Button size="lg" className="min-h-11 gap-2 font-semibold" disabled={readyScenes.length === 0} onClick={startAssembly}>
                    <Layers className="h-4 w-4" />
                    {project?.finalAssetId ? t("studio.vid.assembly.reassemble") : t("studio.vid.assembly.assemble")}
                  </Button>
                )}
              </div>

              {/* final result */}
              {project?.finalAssetId ? (
                <div className="grid gap-2 rounded-xl border border-border/60 bg-muted/10 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4 text-[var(--neon-2)]" /> {t("studio.vid.assembly.final")}
                  </p>
                  <video
                    controls
                    src={assetUrl(`/api/assets/${project.finalAssetId}/raw`)}
                    className="mx-auto w-full max-w-xs rounded-lg border border-border/60"
                    aria-label={t("studio.vid.assembly.final")}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {project.aspectRatio} · 30fps · h264+aac
                      {assemblyVoiceMode === "perScene" && (
                        <Badge variant="outline" className="text-[10px] border-[var(--neon-3)]/50 text-[var(--neon-3)]">
                          {t("studio.vid.voice.mode.perScene")}
                        </Badge>
                      )}
                      {subsBurned && (
                        <Badge variant="outline" className="text-[10px] border-[var(--neon-2)]/50 text-[var(--neon-2)]">
                          {t("studio.vid.sub.title")}
                        </Badge>
                      )}
                    </p>
                    <a
                      href={assetUrl(`/api/assets/${project.finalAssetId}/raw`)}
                      download
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border/60 px-3 text-xs transition hover:bg-muted/40"
                    >
                      <Download className="h-3.5 w-3.5 text-[var(--neon)]" /> {t("studio.vid.assembly.download")}
                    </a>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("studio.vid.assembly.finalEmpty")}</p>
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
