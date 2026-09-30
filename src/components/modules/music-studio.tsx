"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Music, Music4, Loader2, Upload, Ban, Library, Wand2, Copy, Check, X,
  Download, Settings2, Trash2, Play, Square, FileAudio, RefreshCcw, Mic2,
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
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ---------- types ----------

interface MusicAsset {
  id: string;
  title: string;
  lyrics: string | null;
  stylePrompt: string | null;
  source: string | null; // GENERATED | UPLOADED | LYRICS
  provider: string | null;
  durationSec: number | null;
  cost: number | null;
  createdAt: string;
  meta: Record<string, unknown>;
  asset: { id: string; url: string; mimeType: string; size: number; filename: string } | null;
}

interface EditState {
  volume: number;
  trimStartSec: number;
  trimEndSec: number | null;
  fadeInSec: number;
  fadeOutSec: number;
  loop: boolean;
  duckEnabled: boolean;
  duckDb: number | null;
}

interface GenResult {
  jobId: string; musicId: string; assetId: string; url: string;
  durationSec: number; bars: number; preset: string; tempo: number; seed: number; provider: string;
}

interface Caps { providerId: string | null; capabilities: { durationsSec: number[]; maxDurationSec: number; supportsLyrics: boolean }; presets: { id: string; bpm: number; drums: boolean }[]; lyricsCapableProviders: string[] }

const PRESETS = ["lofi", "ambient", "corporate", "uplifting", "cinematic"] as const;
const DURATIONS = [10, 15, 20, 30, 45, 60];
const DEFAULT_EDIT: EditState = { volume: 1, trimStartSec: 0, trimEndSec: null, fadeInSec: 0, fadeOutSec: 0, loop: false, duckEnabled: false, duckDb: null };

function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ---------- Web Audio preview: apply edit params to a decoded buffer (real DSP) ----------

function renderPreviewBuffer(ctx: AudioContext, src: AudioBuffer, edit: EditState): AudioBuffer {
  const sr = src.sampleRate;
  const trimStart = Math.min(edit.trimStartSec, Math.max(0, src.duration - 0.2));
  const trimEnd = edit.trimEndSec !== null ? Math.min(edit.trimEndSec, src.duration) : src.duration;
  const len = Math.max(1, Math.floor((trimEnd - trimStart) * sr));
  const out = ctx.createBuffer(2, len, sr);
  const fadeInN = Math.min(len, Math.floor(edit.fadeInSec * sr));
  const fadeOutN = Math.min(len, Math.floor(edit.fadeOutSec * sr));
  for (let ch = 0; ch < 2; ch++) {
    const inData = src.getChannelData(Math.min(ch, src.numberOfChannels - 1));
    const outData = out.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      let g = edit.volume;
      if (i < fadeInN) g *= i / fadeInN;
      if (i >= len - fadeOutN) g *= (len - i) / fadeOutN;
      outData[i] = inData[trimStart * sr + i] * g;
    }
  }
  return out;
}

// ---------- module ----------

export function MusicModule() {
  const { t, locale } = useI18n();
  const activeBrandId = useApp((s) => s.activeBrandId);

  const [caps, setCaps] = useState<Caps | null>(null);
  const [mode, setMode] = useState<"description" | "instrumental" | "soundtrack" | "song">("instrumental");
  const [description, setDescription] = useState("");
  const [preset, setPreset] = useState("lofi");
  const [tempo, setTempo] = useState(78);
  const [durationSec, setDurationSec] = useState(20);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);

  // lyrics
  const [theme, setTheme] = useState("");
  const [genre, setGenre] = useState("");
  const [writing, setWriting] = useState(false);
  const [lyrics, setLyrics] = useState("");
  const [lyricsCopied, setLyricsCopied] = useState(false);

  // upload
  const [file, setFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // library
  const [items, setItems] = useState<MusicAsset[]>([]);
  const [libLoading, setLibLoading] = useState(true);
  const [editing, setEditing] = useState<MusicAsset | null>(null);
  const [edit, setEdit] = useState<EditState>(DEFAULT_EDIT);
  const [savingEdit, setSavingEdit] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const loadLibrary = useCallback(async () => {
    try {
      const res = await api<{ items: MusicAsset[] }>("/api/music");
      setItems(res.items ?? []);
    } catch {
      /* library stays — next reload retries */
    } finally {
      setLibLoading(false);
    }
  }, []);

  useEffect(() => {
    api<Caps>("/api/generate/music", { method: "POST", body: JSON.stringify({ action: "capabilities" }) })
      .then(setCaps)
      .catch(() => undefined);
    loadLibrary();
  }, [loadLibrary]);

  const applyPresetBpm = (p: string) => {
    setPreset(p);
    const found = caps?.presets.find((x) => x.id === p);
    if (found) setTempo(found.bpm);
  };

  // ---------- generation ----------
  const generate = async (overrideSeed?: number) => {
    if (mode === "description" && !description.trim()) {
      toast.warning(t("studio.mus.needDescription"));
      return;
    }
    setGenerating(true);
    setResult(null);
    pulseCore("GENERATING");
    try {
      const payload: Record<string, unknown> = { mode, durationSec, brandId: activeBrandId ?? undefined };
      if (overrideSeed !== undefined) payload.seed = overrideSeed;
      if (mode === "description") payload.description = description;
      else { payload.preset = preset; payload.tempo = tempo; }
      const res = await api<GenResult>("/api/generate/music", { method: "POST", body: JSON.stringify(payload) });
      setResult(res);
      pulseCore("SUCCESS");
      toast.success(t("common.success"), { description: `${res.preset} · ${res.tempo} BPM · ${res.durationSec}s` });
      loadLibrary();
    } catch (err) {
      pulseCore("ERROR");
      showStudioError(t, err);
    } finally {
      setGenerating(false);
    }
  };

  // ---------- lyrics ----------
  const writeLyrics = async () => {
    if (!theme.trim()) {
      toast.warning(t("studio.mus.lyrics.needTheme"));
      return;
    }
    setWriting(true);
    setLyrics("");
    pulseCore("GENERATING");
    try {
      const res = await api<{ id: string; lyrics: string }>("/api/generate/music", {
        method: "POST",
        body: JSON.stringify({ action: "lyrics", theme, genre, language: locale, brandId: activeBrandId ?? undefined }),
      });
      setLyrics(res.lyrics);
      pulseCore("SUCCESS");
      toast.success(t("common.success"));
      loadLibrary();
    } catch (err) {
      pulseCore("ERROR");
      showStudioError(t, err);
    } finally {
      setWriting(false);
    }
  };

  const copyLyrics = async () => {
    try {
      await navigator.clipboard.writeText(lyrics);
      setLyricsCopied(true);
      toast.success(t("common.copied"));
      window.setTimeout(() => setLyricsCopied(false), 1600);
    } catch {
      toast.error(t("common.error"));
    }
  };

  // ---------- upload ----------
  const acceptFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!/^audio\//.test(f.type) && !/\.(mp3|wav|ogg|m4a|flac|aac|webm)$/i.test(f.name)) {
      toast.warning(t("studio.mus.upload.formats"), { description: f.name });
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      toast.warning(t("studio.mus.upload.formats"), { description: `${fmtSize(f.size)} > 25 MB` });
      return;
    }
    setFile(f);
  };

  const upload = async () => {
    if (!file) {
      toast.warning(t("studio.mus.upload.needFile"));
      return;
    }
    setUploading(true);
    pulseCore("GENERATING");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("File read failed"));
        reader.readAsDataURL(file);
      });
      await api<{ id: string }>("/api/music", {
        method: "POST",
        body: JSON.stringify({ action: "upload", base64: dataUrl, fileName: file.name, mimeType: file.type, title: uploadTitle, brandId: activeBrandId ?? undefined }),
      });
      setFile(null);
      setUploadTitle("");
      pulseCore("SUCCESS");
      toast.success(t("common.success"));
      loadLibrary();
    } catch (err) {
      pulseCore("ERROR");
      showStudioError(t, err);
    } finally {
      setUploading(false);
    }
  };

  // ---------- edit dialog ----------
  const openEdit = (item: MusicAsset) => {
    const e = (item.meta?.edit ?? {}) as Partial<EditState>;
    setEdit({ ...DEFAULT_EDIT, ...e, trimEndSec: e.trimEndSec ?? null, duckDb: e.duckDb ?? null });
    setEditing(item);
    setPreviewPlaying(false);
  };

  const stopPreview = useCallback(() => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch { /* already stopped */ }
      sourceRef.current = null;
    }
    setPreviewPlaying(false);
  }, []);

  const startPreview = async () => {
    if (!editing?.asset) return;
    stopPreview();
    setDecoding(true);
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      const res = await fetch(assetUrl(editing.asset.url));
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      const preview = renderPreviewBuffer(ctx, buf, edit);
      const source = ctx.createBufferSource();
      source.buffer = preview;
      source.loop = edit.loop;
      source.connect(ctx.destination);
      source.onended = () => { sourceRef.current = null; setPreviewPlaying(false); };
      source.start();
      sourceRef.current = source;
      setPreviewPlaying(true);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setDecoding(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      await api("/api/music", { method: "POST", body: JSON.stringify({ action: "edit", id: editing.id, edit }) });
      toast.success(t("studio.mus.edit.saved"));
      stopPreview();
      setEditing(null);
      loadLibrary();
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setSavingEdit(false);
    }
  };

  const remove = async (item: MusicAsset) => {
    try {
      await api(`/api/music?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      toast.success(t("studio.mus.deleted"));
      loadLibrary();
    } catch (err) {
      showStudioError(t, err);
    }
  };

  const download = (item: MusicAsset) => {
    if (!item.asset) return;
    const a = document.createElement("a");
    a.href = assetUrl(item.asset.url);
    a.download = item.asset.filename || `${item.title}.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const sourceBadge = (s: string | null) => {
    if (s === "UPLOADED") return <Badge variant="outline" className="text-[10px]">{t("studio.mus.lib.source.uploaded")}</Badge>;
    if (s === "LYRICS") return <Badge variant="outline" className="text-[10px]">{t("studio.mus.lib.source.lyrics")}</Badge>;
    return <Badge variant="outline" className="border-[var(--neon)]/40 text-[10px] text-[var(--neon)]">{t("studio.mus.lib.source.generated")}</Badge>;
  };

  return (
    <div className="grid gap-5">
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-strong neon-border rounded-2xl p-5 sm:p-6">
        <h1 className="text-xl font-semibold sm:text-2xl neon-text">{t("studio.mus.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("studio.mus.subtitle")}</p>
      </motion.section>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* generator */}
        <Card className="glass rounded-2xl lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Music4 className="h-4 w-4 text-[var(--neon)]" /> {t("studio.mus.generate")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <Label>{t("studio.mus.mode")}</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="instrumental">{t("studio.mus.mode.instrumental")}</SelectItem>
                  <SelectItem value="soundtrack">{t("studio.mus.mode.soundtrack")}</SelectItem>
                  <SelectItem value="description">{t("studio.mus.mode.description")}</SelectItem>
                  <SelectItem value="song">{t("studio.mus.mode.song")} · 🔒</SelectItem>
                </SelectContent>
              </Select>
              {mode === "song" && (
                <div className="grid gap-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                    <Ban className="h-3.5 w-3.5" /> {t("studio.mus.provider.singing")}
                  </p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {caps?.lyricsCapableProviders.join(" · ") || "—"}
                  </p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{t("studio.mus.lyrics.honestNote")}</p>
                </div>
              )}
            </div>

            {mode === "description" ? (
              <div className="grid gap-2">
                <Label htmlFor="mus-desc">{t("studio.mus.description")}</Label>
                <Textarea
                  id="mus-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
                  placeholder={t("studio.mus.descriptionPh")}
                  rows={3}
                  className="resize-none"
                  maxLength={1000}
                />
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="mus-preset">{t("studio.mus.preset")}</Label>
                  <Select value={preset} onValueChange={applyPresetBpm}>
                    <SelectTrigger id="mus-preset" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRESETS.map((p) => (
                        <SelectItem key={p} value={p}>{t(`studio.mus.preset.${p}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="mus-tempo">{t("studio.mus.tempo")}</Label>
                    <span className="font-mono text-xs text-[var(--neon-2)]">{t("studio.mus.tempoBpm", { n: tempo })}</span>
                  </div>
                  <Slider
                    id="mus-tempo"
                    value={[tempo]}
                    min={60}
                    max={140}
                    step={1}
                    onValueChange={(v) => setTempo(v[0] ?? 78)}
                    aria-label={t("studio.mus.tempo")}
                    className="w-full"
                  />
                </div>
              </>
            )}

            <div className="grid gap-2">
              <Label htmlFor="mus-dur">{t("studio.mus.duration")}</Label>
              <Select value={String(durationSec)} onValueChange={(v) => setDurationSec(Number(v))}>
                <SelectTrigger id="mus-dur" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>{t("studio.mus.durationSec", { n: d })}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => generate()} disabled={generating || mode === "song"} className="min-h-11 flex-1 gap-2 font-semibold">
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {generating ? t("studio.mus.generating") : t("studio.mus.generate")}
              </Button>
              {result && !generating && (
                <Button variant="outline" onClick={() => generate(Math.floor(Math.random() * 2 ** 31))} className="min-h-11 gap-2">
                  <RefreshCcw className="h-4 w-4 text-[var(--neon-2)]" /> {t("studio.mus.reroll")}
                </Button>
              )}
            </div>

            {generating && <Skeleton className="h-14 rounded-xl bg-muted/40" />}
            {result && !generating && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid gap-2 rounded-xl border border-[var(--neon-2)]/40 bg-muted/20 p-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--neon-2)]">{t("studio.mus.result")}</span>
                <audio controls src={assetUrl(result.url)} className="w-full" aria-label={t("studio.mus.result")} />
                <p className="text-[11px] text-muted-foreground">
                  {t("studio.mus.resultNote", { bars: result.bars, seed: result.seed })}
                </p>
              </motion.div>
            )}
          </CardContent>
        </Card>

        {/* right column */}
        <div className="grid content-start gap-5 lg:col-span-2">
          {/* upload */}
          <Card className="glass rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Upload className="h-4 w-4 text-[var(--neon-3)]" /> {t("studio.mus.upload.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div
                role="button"
                tabIndex={0}
                aria-label={t("studio.mus.upload.dropzone")}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptFile(e.dataTransfer.files?.[0]); }}
                className={`dropzone flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-center transition ${
                  dragOver ? "dropzone-active" : "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon)]/60"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac,.webm"
                  className="hidden"
                  aria-hidden
                  tabIndex={-1}
                  onChange={(e) => { acceptFile(e.target.files?.[0]); e.currentTarget.value = ""; }}
                />
                {file ? (
                  <>
                    <FileAudio className="h-7 w-7 text-[var(--neon-2)]" aria-hidden />
                    <p className="max-w-full truncate px-2 text-sm font-medium">{file.name}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtSize(file.size)}</p>
                    <Button
                      size="sm" variant="ghost" className="min-h-9 gap-1 text-xs"
                      onClick={(e) => { e.stopPropagation(); setFile(null); }}
                      aria-label={t("common.delete")}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden /> {t("common.delete")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Upload className="h-5 w-5 text-[var(--neon)]" aria-hidden />
                    <p className="text-sm font-medium">{t("studio.mus.upload.dropzone")}</p>
                    <p className="text-[11px] text-muted-foreground">{t("studio.mus.upload.formats")}</p>
                  </>
                )}
              </div>
              <Input value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value.slice(0, 80))} placeholder={t("studio.mus.upload.namePh")} />
              <Button onClick={upload} disabled={uploading || !file} className="min-h-11 gap-2 font-semibold">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? t("studio.mus.upload.uploading") : t("studio.mus.upload.title")}
              </Button>
            </CardContent>
          </Card>

          {/* honest capability status */}
          <Card className="glass rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Music className="h-4 w-4 text-[var(--neon-2)]" /> {t("studio.mus.provider.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-xs leading-relaxed">
              <p className="flex items-start gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--neon)]" aria-hidden />
                <span>{t("studio.mus.provider.synth")}</span>
              </p>
              <p className="flex items-start gap-2">
                <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                <span>{t("studio.mus.provider.singing")}: {caps?.lyricsCapableProviders.join(" · ") || "—"}</span>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* lyricist */}
      <Card className="glass rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mic2 className="h-4 w-4 text-[var(--neon-3)]" /> {t("studio.mus.lyrics.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="grid content-start gap-4">
            <div className="grid gap-2">
              <Label htmlFor="mus-theme">{t("studio.mus.lyrics.theme")}</Label>
              <Input id="mus-theme" value={theme} onChange={(e) => setTheme(e.target.value.slice(0, 1000))} placeholder={t("studio.mus.lyrics.themePh")} maxLength={1000} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mus-genre">{t("studio.mus.lyrics.genre")}</Label>
              <Input id="mus-genre" value={genre} onChange={(e) => setGenre(e.target.value.slice(0, 60))} placeholder={t("studio.mus.lyrics.genrePh")} maxLength={60} />
            </div>
            <Button onClick={writeLyrics} disabled={writing} className="min-h-11 gap-2 font-semibold">
              {writing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />}
              {writing ? t("studio.mus.lyrics.writing") : t("studio.mus.lyrics.write")}
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t("studio.mus.lyrics.honestNote")}</p>
          </div>
          <div className="grid content-start gap-2">
            <div className="flex items-center justify-between">
              <Label>{t("studio.mus.lib.source.lyrics")}</Label>
              {lyrics && (
                <Button size="icon" variant="outline" className="h-8 w-8" onClick={copyLyrics} aria-label={t("common.copy")}>
                  {lyricsCopied ? <Check className="h-3.5 w-3.5 text-[var(--neon-2)]" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                </Button>
              )}
            </div>
            <Textarea
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder={writing ? t("studio.mus.lyrics.writing") : ""}
              rows={10}
              className="resize-none font-mono text-xs"
              disabled={writing}
            />
          </div>
        </CardContent>
      </Card>

      {/* library */}
      <Card className="glass rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Library className="h-4 w-4 text-[var(--neon-2)]" /> {t("studio.mus.lib.title")}
            {items.length > 0 && <Badge variant="outline" className="text-[10px]">{items.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {libLoading ? (
            <div className="grid gap-2">
              <Skeleton className="h-20 rounded-xl bg-muted/40" />
              <Skeleton className="h-20 rounded-xl bg-muted/40" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("studio.mus.lib.empty")}</p>
          ) : (
            <ul className="grid max-h-96 gap-3 overflow-y-auto scrollbar-thin">
              {items.map((item) => (
                <li key={item.id} className="grid gap-3 rounded-xl border border-border/60 bg-muted/20 p-4 lg:grid-cols-[1fr_240px] lg:items-center">
                  <div className="grid min-w-0 gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      {sourceBadge(item.source)}
                      {item.durationSec != null && (
                        <span className="font-mono text-[10px] text-muted-foreground">{Math.round(item.durationSec)}s</span>
                      )}
                    </div>
                    {item.stylePrompt && <p className="line-clamp-1 text-[11px] text-muted-foreground">{item.stylePrompt}</p>}
                    {item.lyrics && (
                      <p className="line-clamp-2 whitespace-pre-line text-[11px] text-muted-foreground">{item.lyrics}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {item.asset && (
                        <>
                          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => openEdit(item)}>
                            <Settings2 className="h-3 w-3" /> {t("studio.mus.lib.edit")}
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => download(item)}>
                            <Download className="h-3 w-3" /> {t("studio.mus.lib.download")}
                          </Button>
                        </>
                      )}
                      {item.lyrics && (
                        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={async () => { await navigator.clipboard.writeText(item.lyrics ?? ""); toast.success(t("common.copied")); }}>
                          <Copy className="h-3 w-3" /> {t("studio.mus.lib.copyLyrics")}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs text-destructive hover:text-destructive" onClick={() => remove(item)}>
                        <Trash2 className="h-3 w-3" /> {t("common.delete")}
                      </Button>
                    </div>
                  </div>
                  {item.asset ? (
                    <audio controls src={assetUrl(item.asset.url)} className="h-10 w-full lg:w-[240px]" aria-label={item.title} />
                  ) : (
                    <span className="text-[11px] text-muted-foreground lg:text-right">{t("studio.mus.lib.noAudio")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) { stopPreview(); setEditing(null); } }}>
        <DialogContent className="glass-strong max-h-[90vh] overflow-y-auto rounded-2xl border-border/60 scrollbar-thin">
          <DialogHeader>
            <DialogTitle className="neon-text">{t("studio.mus.edit.title")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-5 py-1">
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="mus-vol">{t("studio.mus.edit.volume")}</Label>
                <span className="font-mono text-xs text-[var(--neon-2)]">{Math.round(edit.volume * 100)}%</span>
              </div>
              <Slider id="mus-vol" value={[edit.volume]} min={0} max={2} step={0.05}
                onValueChange={(v) => setEdit({ ...edit, volume: v[0] ?? 1 })}
                aria-label={t("studio.mus.edit.volume")} className="w-full" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="mus-trim-start">{t("studio.mus.edit.trimStart")}</Label>
                <Input id="mus-trim-start" type="number" min={0} max={600} step={0.5} value={edit.trimStartSec}
                  onChange={(e) => setEdit({ ...edit, trimStartSec: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mus-trim-end">{t("studio.mus.edit.trimEnd")}</Label>
                <Input id="mus-trim-end" type="number" min={0} max={600} step={0.5}
                  value={edit.trimEndSec ?? ""}
                  placeholder={t("studio.mus.edit.trimNone")}
                  onChange={(e) => setEdit({ ...edit, trimEndSec: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mus-fade-in">{t("studio.mus.edit.fadeIn")}</Label>
                <Input id="mus-fade-in" type="number" min={0} max={10} step={0.5} value={edit.fadeInSec}
                  onChange={(e) => setEdit({ ...edit, fadeInSec: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mus-fade-out">{t("studio.mus.edit.fadeOut")}</Label>
                <Input id="mus-fade-out" type="number" min={0} max={10} step={0.5} value={edit.fadeOutSec}
                  onChange={(e) => setEdit({ ...edit, fadeOutSec: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
              <Label htmlFor="mus-loop" className="cursor-pointer">{t("studio.mus.edit.loop")}</Label>
              <Switch id="mus-loop" checked={edit.loop} onCheckedChange={(v) => setEdit({ ...edit, loop: v })} />
            </div>
            <div className="grid gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="mus-duck" className="cursor-pointer">{t("studio.mus.edit.duck")}</Label>
                <Switch id="mus-duck" checked={edit.duckEnabled} onCheckedChange={(v) => setEdit({ ...edit, duckEnabled: v, duckDb: v ? (edit.duckDb ?? -12) : null })} />
              </div>
              {edit.duckEnabled && (
                <>
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="mus-duck-db">{t("studio.mus.edit.duckDb")}</Label>
                      <span className="font-mono text-xs text-[var(--neon-2)]">{edit.duckDb ?? -12} dB</span>
                    </div>
                    <Slider id="mus-duck-db" value={[edit.duckDb ?? -12]} min={-24} max={-3} step={1}
                      onValueChange={(v) => setEdit({ ...edit, duckDb: v[0] ?? -12 })}
                      aria-label={t("studio.mus.edit.duckDb")} className="w-full" />
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{t("studio.mus.edit.duckNote")}</p>
                </>
              )}
            </div>
            {decoding && <p className="text-center text-xs text-muted-foreground">{t("studio.mus.edit.decoding")}</p>}
          </div>
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <Button variant="outline" onClick={previewPlaying ? stopPreview : startPreview} disabled={!editing?.asset || decoding} className="min-h-11 gap-2">
              {previewPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {previewPlaying ? t("studio.mus.edit.stop") : t("studio.mus.edit.preview")}
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" className="min-h-11" onClick={() => { stopPreview(); setEditing(null); }}>{t("common.cancel")}</Button>
              <Button className="min-h-11 gap-2" onClick={saveEdit} disabled={savingEdit}>
                {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t("common.save")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
