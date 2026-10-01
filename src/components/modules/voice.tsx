"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  AudioLines, Loader2, Save, Music, Music4, UserSquare, Ban, History, BookmarkCheck,
  Mic, FileAudio, Copy, X, Check, ScanFace,
} from "lucide-react";
import { useApp, pulseCore } from "@/lib/store";
import { useI18n, api, assetUrl } from "@/lib/use-i18n";
import { showStudioError } from "@/components/modules/image-studio";
import { PROVIDER_REGISTRY } from "@/lib/ai/registry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const RECENT_KEY = "haydev-voice-recent";
const PROFILES_KEY = "haydev-voice-profiles";

interface Voice { id: string; title: string; language: string[] | string }
interface TtsResponse { jobId: string; assetId: string; url: string }
interface RecentVoice { assetId: string; url: string; text: string; voice: string; speed: number; ts: number }
interface LocalProfile { id: string; name: string; voiceId: string; language: string; speed: number; ts: number }

const ASR_MAX_BYTES = 25 * 1024 * 1024;
const ASR_EXT = /\.(wav|mp3|m4a|flac|ogg|webm|aac)$/i;

function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function VoiceModule() {
  const { t, locale } = useI18n();
  const activeBrandId = useApp((s) => s.activeBrandId);

  const [text, setText] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voicesBlocked, setVoicesBlocked] = useState(false);
  const [voiceId, setVoiceId] = useState("tongtong");
  const [speed, setSpeed] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [lastResult, setLastResult] = useState<TtsResponse | null>(null);
  const [recent, setRecent] = useState<RecentVoice[]>([]);
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // speech-to-text (ASR)
  const [asrFile, setAsrFile] = useState<File | null>(null);
  const [asrBusy, setAsrBusy] = useState(false);
  const [asrDragOver, setAsrDragOver] = useState(false);
  const [asrResult, setAsrResult] = useState("");
  const [asrCopied, setAsrCopied] = useState(false);
  const asrInputRef = useRef<HTMLInputElement>(null);

  // honest registry statuses (BLOCKED_EXTERNAL honesty is a product requirement)
  const avatarProvider = PROVIDER_REGISTRY.find((p) => p.providerId === "heygen");
  const asrProvider = PROVIDER_REGISTRY.find((p) => p.providerId === "zai-asr");

  const loadVoices = useCallback(async () => {
    try {
      const res = await api<{ voices: Voice[]; providerBlocked?: boolean }>("/api/generate/tts", {
        method: "POST",
        body: JSON.stringify({ action: "list_voices" }),
      });
      if (res.providerBlocked) {
        setVoicesBlocked(true);
      } else {
        setVoices(res.voices ?? []);
        if (res.voices?.length) setVoiceId(res.voices[0].id);
      }
    } catch {
      /* voices stay empty */
    } finally {
      setVoicesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVoices();
    try {
      const r = window.localStorage.getItem(RECENT_KEY);
      if (r) setRecent(JSON.parse(r) as RecentVoice[]);
      const p = window.localStorage.getItem(PROFILES_KEY);
      if (p) setProfiles(JSON.parse(p) as LocalProfile[]);
    } catch { /* corrupted storage — ignore */ }
  }, [loadVoices]);

  const persistRecent = (list: RecentVoice[]) => {
    setRecent(list);
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12)));
    } catch { /* storage full — non-critical */ }
  };

  const generate = async () => {
    if (!text.trim()) {
      toast.warning(t("studio.voc.needText"));
      return;
    }
    setGenerating(true);
    setLastResult(null);
    pulseCore("GENERATING");
    try {
      const res = await api<TtsResponse>("/api/generate/tts", {
        method: "POST",
        body: JSON.stringify({ text, voice: voiceId, speed, brandId: activeBrandId ?? undefined }),
      });
      setLastResult(res);
      persistRecent([{ assetId: res.assetId, url: res.url, text, voice: voiceId, speed, ts: Date.now() }, ...recent]);
      pulseCore("SUCCESS");
      toast.success(t("common.success"));
    } catch (err) {
      pulseCore("ERROR");
      showStudioError(t, err);
    } finally {
      setGenerating(false);
    }
  };

  // ---------- ASR: speech-to-text ----------
  const acceptAsrFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!ASR_EXT.test(file.name)) {
      toast.warning(t("studio.voc.asr.badType"), { description: file.name });
      return;
    }
    if (file.size > ASR_MAX_BYTES) {
      toast.warning(t("studio.voc.asr.tooBig"), { description: `${fmtSize(file.size)} > 25 MB` });
      return;
    }
    setAsrFile(file);
    setAsrResult("");
  };

  const transcribe = async () => {
    if (!asrFile) {
      toast.warning(t("studio.voc.asr.needFile"));
      return;
    }
    setAsrBusy(true);
    pulseCore("GENERATING");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("File read failed"));
        reader.readAsDataURL(asrFile);
      });
      const res = await api<{ text: string; provider?: string; deduplicated?: boolean }>("/api/generate/asr", {
        method: "POST",
        body: JSON.stringify({ base64: dataUrl, fileName: asrFile.name, sizeBytes: asrFile.size, brandId: activeBrandId ?? undefined }),
      });
      setAsrResult(res.text);
      setAsrCopied(false);
      pulseCore("SUCCESS");
      toast.success(t("studio.voc.asr.done"), { description: `${asrFile.name}${res.deduplicated ? " · cached" : ""}` });
    } catch (err) {
      pulseCore("ERROR");
      showStudioError(t, err);
    } finally {
      setAsrBusy(false);
    }
  };

  const copyAsr = async () => {
    if (!asrResult) return;
    try {
      await navigator.clipboard.writeText(asrResult);
      setAsrCopied(true);
      toast.success(t("common.copied"));
      window.setTimeout(() => setAsrCopied(false), 1600);
    } catch {
      toast.error(t("common.error"));
    }
  };

  const saveProfile = async () => {
    if (!profileName.trim()) {
      toast.warning(t("studio.voc.profileName"));
      return;
    }
    setSavingProfile(true);
    try {
      const profile = await api<{ id: string }>("/api/generate/tts", {
        method: "POST",
        body: JSON.stringify({ action: "save_voice_profile", name: profileName, voiceId, language: locale, params: { speed } }),
      });
      const local: LocalProfile = { id: profile.id, name: profileName, voiceId, language: locale, speed, ts: Date.now() };
      const list = [local, ...profiles];
      setProfiles(list);
      try {
        window.localStorage.setItem(PROFILES_KEY, JSON.stringify(list.slice(0, 20)));
      } catch { /* non-critical */ }
      setProfileOpen(false);
      setProfileName("");
      toast.success(t("studio.voc.profileSaved"));
    } catch (err) {
      showStudioError(t, err);
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="grid gap-5">
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-strong neon-border rounded-2xl p-5 sm:p-6">
        <h1 className="text-xl font-semibold sm:text-2xl neon-text">{t("studio.voc.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("studio.voc.subtitle")}</p>
      </motion.section>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* TTS composer */}
        <Card className="glass rounded-2xl lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AudioLines className="h-4 w-4 text-[var(--neon)]" /> {t("studio.voc.generate")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="voc-text">{t("studio.voc.text")}</Label>
                <span className={`text-[11px] ${text.length > 2000 ? "text-destructive" : "text-muted-foreground"}`}>
                  {t("studio.voc.counter", { n: text.length })}
                </span>
              </div>
              <Textarea
                id="voc-text"
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 2000))}
                placeholder={t("studio.voc.textPh")}
                rows={7}
                className="resize-none"
                maxLength={2000}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="voc-voice">{t("studio.voc.voice")}</Label>
              {voicesLoading ? (
                <Skeleton className="h-11 rounded-lg bg-muted/40" />
              ) : voices.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("studio.voc.voicesEmpty")}</p>
              ) : (
                <Select value={voiceId} onValueChange={setVoiceId}>
                  <SelectTrigger id="voc-voice" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {voices.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.title}
                        {Array.isArray(v.language) ? ` · ${v.language.join(", ")}` : typeof v.language === "string" ? ` · ${v.language}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="voc-speed">{t("studio.voc.speed")}</Label>
                <span className="font-mono text-xs text-[var(--neon-2)]">{speed.toFixed(1)}×</span>
              </div>
              <Slider
                id="voc-speed"
                value={[speed]}
                min={0.5}
                max={2}
                step={0.1}
                onValueChange={(v) => setSpeed(v[0] ?? 1)}
                aria-label={t("studio.voc.speed")}
                className="w-full"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={generate} disabled={generating} className="min-h-11 flex-1 gap-2 font-semibold">
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />}
                {generating ? t("studio.voc.generating") : t("studio.voc.generate")}
              </Button>
              <Button variant="outline" onClick={() => setProfileOpen(true)} disabled={!voices.length} className="min-h-11 gap-2">
                <Save className="h-4 w-4 text-[var(--neon-3)]" /> {t("studio.voc.saveProfile")}
              </Button>
            </div>

            {generating && <Skeleton className="h-14 rounded-xl bg-muted/40" />}
            {lastResult && !generating && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid gap-2 rounded-xl border border-[var(--neon-2)]/40 bg-muted/20 p-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--neon-2)]">{t("studio.voc.result")}</span>
                <audio controls src={assetUrl(lastResult.url)} className="w-full" aria-label={t("studio.voc.result")} />
              </motion.div>
            )}
          </CardContent>
        </Card>

        {/* right column: profiles + honest statuses */}
        <div className="grid content-start gap-5 lg:col-span-2">
          <Card className="glass rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <BookmarkCheck className="h-4 w-4 text-[var(--neon-3)]" /> {t("studio.voc.profiles")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {profiles.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">{t("studio.voc.profilesEmpty")}</p>
              ) : (
                <ul className="grid max-h-64 gap-2 overflow-y-auto scrollbar-thin">
                  {profiles.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground">{p.voiceId} · {p.language.toUpperCase()} · {p.speed.toFixed(1)}×</p>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[10px]">NATIVE</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* honest capability cards: music → live module, avatar → still blocked */}
          <Card className="glass rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Music className="h-4 w-4 text-[var(--neon-3)]" /> {t("studio.voc.music")}
                <Badge variant="outline" className="gap-1 border-[var(--neon)]/40 text-[10px] text-[var(--neon)]">
                  <Check className="h-3 w-3" /> {t("studio.voc.available")}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <p className="text-xs leading-relaxed text-muted-foreground">{t("studio.voc.musicNote")}</p>
              <Button
                onClick={() => useApp.getState().setView("music")}
                className="min-h-11 gap-2 font-semibold"
              >
                <Music4 className="h-4 w-4" /> {t("studio.voc.openMusic")}
              </Button>
            </CardContent>
          </Card>
          <Card className="glass rounded-2xl opacity-90">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <UserSquare className="h-4 w-4 text-[var(--neon)]" /> {t("studio.voc.avatar")}
                <Badge variant="destructive" className="gap-1 text-[10px]"><Ban className="h-3 w-3" /> {t("studio.voc.blocked")}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <p className="text-xs leading-relaxed text-muted-foreground">{t("studio.voc.blockedNote")}</p>
              {avatarProvider?.statusNote && (
                <p className="rounded-lg border border-border/60 bg-muted/20 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {avatarProvider.status}: {avatarProvider.statusNote}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 gap-2"
                onClick={() => useApp.getState().setView("avatar")}
              >
                <ScanFace className="h-4 w-4 text-[var(--neon)]" /> {t("studio.voc.openAvatar")}
              </Button>
              <Textarea disabled rows={2} placeholder={t("studio.voc.disabledHint")} aria-label={t("studio.voc.disabledHint")} className="resize-none opacity-50" />
              <Button disabled className="min-h-11 gap-2 opacity-50">
                <Ban className="h-4 w-4" /> {t("common.generate")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* speech-to-text (ASR) */}
      <Card className="glass rounded-2xl">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mic className="h-4 w-4 text-[var(--neon)]" aria-hidden /> {t("studio.voc.asr.title")}
          </CardTitle>
          {asrProvider && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground" title={asrProvider.statusNote ?? undefined}>
              {asrProvider.providerId} · {asrProvider.status}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {/* dropzone */}
          <div
            role="button"
            tabIndex={0}
            aria-label={t("studio.voc.asr.dropzone")}
            onClick={() => asrInputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); asrInputRef.current?.click(); } }}
            onDragOver={(e) => { e.preventDefault(); setAsrDragOver(true); }}
            onDragLeave={() => setAsrDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setAsrDragOver(false);
              acceptAsrFile(e.dataTransfer.files?.[0]);
            }}
            className={`dropzone flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition ${
              asrDragOver ? "dropzone-active" : "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon)]/60"
            }`}
          >
            <input
              ref={asrInputRef}
              type="file"
              accept=".wav,.mp3,.m4a,.flac,.ogg,.webm,.aac,audio/*"
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => { acceptAsrFile(e.target.files?.[0]); e.currentTarget.value = ""; }}
            />
            {asrFile ? (
              <>
                <FileAudio className="h-8 w-8 text-[var(--neon-2)]" aria-hidden />
                <p className="max-w-full truncate px-2 text-sm font-medium">{asrFile.name}</p>
                <p className="text-[11px] text-muted-foreground">{fmtSize(asrFile.size)}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-9 gap-1 text-xs"
                  onClick={(e) => { e.stopPropagation(); setAsrFile(null); setAsrResult(""); }}
                  aria-label={t("common.delete")}
                >
                  <X className="h-3.5 w-3.5" aria-hidden /> {t("common.delete")}
                </Button>
              </>
            ) : (
              <>
                <motion.span
                  animate={{ y: asrDragOver ? -4 : 0 }}
                  className="rounded-full p-3"
                  style={{ background: "color-mix(in oklab, var(--neon) 12%, transparent)" }}
                >
                  <Mic className="h-6 w-6 text-[var(--neon)]" aria-hidden />
                </motion.span>
                <p className="text-sm font-medium">{t("studio.voc.asr.dropzone")}</p>
                <p className="text-[11px] text-muted-foreground">{t("studio.voc.asr.formats")}</p>
              </>
            )}
          </div>

          {/* result */}
          <div className="grid content-start gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="asr-result">{t("studio.voc.asr.result")}</Label>
              <div className="flex items-center gap-2">
                {asrResult && (
                  <>
                    <span className="text-[11px] text-muted-foreground">
                      {t("studio.voc.asr.words", { n: asrResult.trim().split(/\s+/).filter(Boolean).length })}
                    </span>
                    <Button size="icon" variant="outline" className="h-8 w-8" onClick={copyAsr} aria-label={t("common.copy")}>
                      {asrCopied ? <Check className="h-3.5 w-3.5 text-[var(--neon-2)]" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    </Button>
                  </>
                )}
              </div>
            </div>
            <Textarea
              id="asr-result"
              value={asrResult}
              onChange={(e) => setAsrResult(e.target.value)}
              placeholder={asrBusy ? t("studio.voc.asr.working") : t("studio.voc.asr.resultPh")}
              rows={6}
              className="resize-none"
              disabled={asrBusy}
            />
            <Button onClick={transcribe} disabled={asrBusy || !asrFile} className="min-h-11 gap-2 font-semibold">
              {asrBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
              {asrBusy ? t("studio.voc.asr.working") : t("studio.voc.asr.cta")}
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t("studio.voc.asr.note")}</p>
          </div>
        </CardContent>
      </Card>

      {/* recent voiceovers */}
      <Card className="glass rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-[var(--neon-2)]" /> {t("studio.voc.recent")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("studio.voc.recentEmpty")}</p>
          ) : (
            <ul className="grid max-h-96 gap-2 overflow-y-auto scrollbar-thin">
              {recent.map((r) => (
                <li key={r.assetId} className="grid gap-2 rounded-xl border border-border/60 bg-muted/20 p-3 sm:grid-cols-[1fr_260px] sm:items-center">
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-xs">{r.text}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {r.voice} · {r.speed.toFixed(1)}× · {new Date(r.ts).toLocaleString()}
                    </p>
                  </div>
                  <audio controls src={assetUrl(r.url)} className="h-10 w-full" aria-label={t("studio.voc.recent")} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* save profile dialog */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="glass-strong rounded-2xl border-border/60">
          <DialogHeader>
            <DialogTitle className="neon-text">{t("studio.voc.profileTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="voc-profile-name">{t("studio.voc.profileName")}</Label>
            <Input id="voc-profile-name" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder={t("studio.voc.profileNamePh")} />
            <p className="text-[11px] text-muted-foreground">
              {t("studio.voc.voice")}: {voiceId} · {t("studio.voc.speed")}: {speed.toFixed(1)}× · {locale.toUpperCase()}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="min-h-11" onClick={() => setProfileOpen(false)}>{t("common.cancel")}</Button>
            <Button className="min-h-11 gap-2" onClick={saveProfile} disabled={savingProfile}>
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
