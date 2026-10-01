"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ScanFace, Loader2, Ban, Settings2, FileText, Wrench, Trash2, Check,
} from "lucide-react";
import { pulseCore } from "@/lib/store";
import { useI18n, api } from "@/lib/use-i18n";
import { showStudioError } from "@/components/modules/image-studio";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ---------- constants ----------

const DRAFT_KEY = "haydev-avatar-draft";
const MAX_SCRIPT = 5000;
const ASPECTS = ["9:16", "1:1", "16:9"] as const;
type Aspect = (typeof ASPECTS)[number];
const SPEEDS = ["0.8", "0.9", "1", "1.1", "1.2"] as const;

// ---------- API shapes ----------

interface ProviderReport {
  providerId: string;
  configured: boolean;
  requiredEnvKeys: string[];
  capabilities: { supportsTalkingHead: boolean; supportsVoiceClone: boolean; maxScriptChars: number; resolution: string[] };
  registryStatus: string;
  statusNote?: string;
  supportsHealthCheck: boolean;
  latencyClass: string | null;
}

interface CapabilitiesResponse {
  providers: ProviderReport[];
  pluginSlot: { interfacePath: string; registryProviderId: string; note: string };
}

interface VoiceOption { id: string; title: string }
interface BlockedDetails { blockedBy?: string[]; requiredSetup?: string[]; pluginSlot?: string }
interface Draft { script: string; voiceId: string; speed: string; aspect: Aspect }

const FALLBACK_VOICES: VoiceOption[] = [{ id: "tongtong", title: "Tongtong (female, warm)" }];

function EnvChip({ k, tone = "amber" }: { k: string; tone?: "amber" | "muted" }) {
  return (
    <span
      className={cn(
        "rounded-md border px-1.5 py-0.5 font-mono text-[10px] leading-relaxed",
        tone === "amber" ? "border-amber-500/40 bg-amber-500/10 text-amber-500" : "border-border/60 bg-muted/30 text-muted-foreground",
      )}
    >
      {k}
    </span>
  );
}

export function AvatarStudioModule() {
  const { t } = useI18n();

  // provider capability strip (honest self-inspection)
  const [caps, setCaps] = useState<CapabilitiesResponse | null>(null);
  const [capsLoading, setCapsLoading] = useState(true);

  // draft
  const [script, setScript] = useState("");
  const [voices, setVoices] = useState<VoiceOption[]>(FALLBACK_VOICES);
  const [voiceId, setVoiceId] = useState("tongtong");
  const [speed, setSpeed] = useState("1");
  const [aspect, setAspect] = useState<Aspect>("9:16");

  // generate
  const [generating, setGenerating] = useState(false);
  const [blocked, setBlocked] = useState<BlockedDetails | null>(null);

  // restore draft + load capabilities + voices (once)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<Draft>;
        if (typeof d.script === "string") setScript(d.script);
        if (typeof d.voiceId === "string" && d.voiceId) setVoiceId(d.voiceId);
        if (typeof d.speed === "string" && (SPEEDS as readonly string[]).includes(d.speed)) setSpeed(d.speed);
        if (typeof d.aspect === "string" && (ASPECTS as readonly string[]).includes(d.aspect)) setAspect(d.aspect as Aspect);
      }
    } catch { /* corrupted draft — ignore */ }

    (async () => {
      try {
        const res = await api<CapabilitiesResponse>("/api/generate/avatar", {
          method: "POST",
          body: JSON.stringify({ action: "capabilities" }),
        });
        setCaps(res);
      } catch { /* capabilities stay unavailable — cards render honestly empty */ }
      finally { setCapsLoading(false); }
    })();

    (async () => {
      try {
        const res = await api<{ voices: VoiceOption[] }>("/api/generate/tts", {
          method: "POST",
          body: JSON.stringify({ action: "list_voices" }),
        });
        if (res.voices?.length) setVoices(res.voices);
      } catch { /* keep static tongtong fallback */ }
    })();
  }, []);

  // auto-persist draft to localStorage (honest: local only, never leaves the browser)
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ script, voiceId, speed, aspect } satisfies Draft));
    } catch { /* storage full — non-critical */ }
  }, [script, voiceId, speed, aspect]);

  const clearDraft = () => {
    setScript("");
    setVoiceId("tongtong");
    setSpeed("1");
    setAspect("9:16");
    try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* non-critical */ }
  };

  const generate = async () => {
    if (!script.trim()) {
      toast.warning(t("studio.ava.needScript"));
      return;
    }
    setGenerating(true);
    setBlocked(null);
    pulseCore("GENERATING");
    try {
      // In this environment this ALWAYS throws 503 BLOCKED_EXTERNAL — the honest
      // panel below is the product. Success is never faked client-side either.
      await api("/api/generate/avatar", {
        method: "POST",
        body: JSON.stringify({ action: "generate", script, voiceId, speed: Number(speed), aspectRatio: aspect }),
      });
      setBlocked(null);
    } catch (err) {
      const e = err as Error & { code?: string; details?: unknown };
      if (e?.code === "BLOCKED_EXTERNAL") setBlocked((e.details ?? {}) as BlockedDetails);
      pulseCore("ERROR");
      showStudioError(t, err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="grid gap-5">
      {/* header */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-strong neon-border rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold sm:text-2xl neon-text">{t("studio.ava.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("studio.ava.subtitle")}</p>
          </div>
          <Badge variant="outline" className="gap-1 border-border/60 text-[10px] text-muted-foreground">
            <Ban className="h-3 w-3" aria-hidden /> BLOCKED_EXTERNAL
          </Badge>
        </div>
      </motion.section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* provider capability strip (honest status) */}
        <Card className="glass rounded-2xl lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-4 w-4 text-[var(--neon)]" /> {t("studio.ava.caps.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {capsLoading ? (
              <>
                <Skeleton className="h-40 rounded-xl bg-muted/40" />
              </>
            ) : !caps?.providers.length ? (
              <p className="py-6 text-center text-xs text-muted-foreground">{t("studio.ava.caps.notReported")}</p>
            ) : (
              caps.providers.map((p) => (
                <div key={p.providerId} className="grid gap-2 rounded-xl border border-border/60 bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-mono text-sm font-medium">
                      <ScanFace className="h-4 w-4 text-[var(--neon)]" aria-hidden /> {p.providerId}
                    </span>
                    <Badge variant="outline" className="border-border/60 text-[10px] text-muted-foreground">
                      {p.registryStatus}
                    </Badge>
                  </div>
                  {p.statusNote && <p className="text-xs leading-relaxed text-muted-foreground">{p.statusNote}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    {p.capabilities.supportsTalkingHead && (
                      <Badge variant="outline" className="gap-1 border-border/60 text-[10px] text-muted-foreground">
                        <Check className="h-3 w-3" aria-hidden /> {t("studio.ava.caps.talkingHead")}
                      </Badge>
                    )}
                    {p.capabilities.supportsVoiceClone && (
                      <Badge variant="outline" className="gap-1 border-border/60 text-[10px] text-muted-foreground">
                        <Check className="h-3 w-3" aria-hidden /> {t("studio.ava.caps.voiceClone")}
                      </Badge>
                    )}
                  </div>
                  <div className="grid gap-1 text-[11px] leading-relaxed text-muted-foreground">
                    <span>{t("studio.ava.caps.maxScript", { n: p.capabilities.maxScriptChars })}</span>
                    <span>{t("studio.ava.caps.resolution")}: {p.capabilities.resolution.join(", ")}</span>
                    <span>{t("studio.ava.caps.latency")}: {p.latencyClass ?? t("studio.ava.caps.notReported")}</span>
                    {!p.supportsHealthCheck && <span className="text-amber-500">{t("studio.ava.caps.healthNo")}</span>}
                  </div>
                  {p.requiredEnvKeys.length > 0 && (
                    <div className="grid gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-500">{t("studio.ava.caps.envRequired")}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {p.requiredEnvKeys.map((k) => <EnvChip key={k} k={k} />)}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* draft (still useful, honest) */}
        <Card className="glass rounded-2xl lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-[var(--neon-2)]" /> {t("studio.ava.draft.title")}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-9 gap-1 text-xs text-muted-foreground"
                onClick={clearDraft}
                aria-label={t("studio.ava.clear")}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("studio.ava.clear")}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="ava-script">{t("studio.ava.script")}</Label>
                <span className={cn("text-[11px]", script.length >= MAX_SCRIPT ? "text-destructive" : "text-muted-foreground")}>
                  {t("studio.ava.counter", { n: script.length })}
                </span>
              </div>
              <Textarea
                id="ava-script"
                value={script}
                onChange={(e) => setScript(e.target.value.slice(0, MAX_SCRIPT))}
                placeholder={t("studio.ava.scriptPh")}
                rows={7}
                maxLength={MAX_SCRIPT}
                className="resize-none"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="ava-voice">{t("studio.ava.voice")}</Label>
                <Select value={voiceId} onValueChange={setVoiceId}>
                  <SelectTrigger id="ava-voice" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {voices.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ava-speed">{t("studio.ava.speed")}</Label>
                <Select value={speed} onValueChange={setSpeed}>
                  <SelectTrigger id="ava-speed" className="min-h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SPEEDS.map((s) => (
                      <SelectItem key={s} value={s}>×{Number(s).toFixed(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>{t("studio.ava.aspect")}</Label>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("studio.ava.aspect")}>
                {ASPECTS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    role="radio"
                    aria-checked={aspect === a}
                    onClick={() => setAspect(a)}
                    className={cn(
                      "focus-glow min-h-11 rounded-full px-4 py-1.5 text-xs font-medium transition-all",
                      aspect === a ? "bg-[var(--neon)]/25 text-foreground neon-border" : "glass text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button onClick={generate} disabled={generating} className="min-h-11 gap-2 font-semibold">
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanFace className="h-4 w-4" />}
                {generating ? t("studio.ava.generating") : t("studio.ava.generate")}
              </Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{t("studio.ava.draftNote")}</p>
            </div>

            {/* honest BLOCKED panel — never shows success */}
            {blocked && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                role="alert"
                className="grid gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-500">
                  <Ban className="h-4 w-4" aria-hidden /> {t("studio.ava.blocked.title")}
                </div>
                <p className="text-xs leading-relaxed text-foreground/80">{t("studio.ava.blocked.body")}</p>
                {blocked.blockedBy && blocked.blockedBy.length > 0 && (
                  <div className="grid gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-500">{t("studio.ava.blocked.blockedBy")}</span>
                    <ul className="grid gap-1">
                      {blocked.blockedBy.map((b) => (
                        <li key={b} className="font-mono text-[11px] leading-relaxed text-muted-foreground">· {b}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {blocked.requiredSetup && blocked.requiredSetup.length > 0 && (
                  <div className="grid gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-500">{t("studio.ava.blocked.requiredSetup")}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {blocked.requiredSetup.map((k) => <EnvChip key={k} k={k} />)}
                    </div>
                  </div>
                )}
                {blocked.pluginSlot && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {t("studio.ava.blocked.pluginSlot")}:{" "}
                    <code className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[10px]">{blocked.pluginSlot}</code>
                  </p>
                )}
              </motion.div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* plugin-slot documentation */}
      <Card className="glass rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="h-4 w-4 text-[var(--neon-3)]" /> {t("studio.ava.plugin.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-xs text-muted-foreground">{t("studio.ava.plugin.intro")}</p>
          <ol className="grid gap-2">
            {[
              {
                label: t("studio.ava.plugin.step1"),
                code: "HEYGEN_API_KEY",
              },
              {
                label: t("studio.ava.plugin.step2"),
                code: "src/lib/avatar/adapter.ts",
              },
              {
                label: t("studio.ava.plugin.step3"),
                code: "providerId \"heygen\"",
              },
            ].map((step, i) => (
              <li key={step.code} className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--neon)]/20 text-[11px] font-semibold text-[var(--neon)]">
                  {i + 1}
                </span>
                <span className="text-xs leading-relaxed">
                  {step.label}{" "}
                  <code className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[10px]">{step.code}</code>
                </span>
              </li>
            ))}
          </ol>
          {caps?.pluginSlot && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">{caps.pluginSlot.note}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
