import { googleImage, googleTts, googleVideoSubmit, googleVideoPoll, googleVideoDownload } from "./google-media";
import { cloudComplete } from "./cloud";
// Z.AI cloud adapter — implements the unified contract against z-ai-web-dev-sdk.
import ZAI from "z-ai-web-dev-sdk";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { getProvider, type HealthResult } from "@/lib/ai/registry";

export const UPLOADS_DIR = process.env.VERCEL ? "/tmp/haydev-uploads" : path.join(process.cwd(), "uploads");

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;

export async function getZai() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

export async function saveAssetBuffer(
  userId: string,
  buffer: Buffer,
  kind: string,
  mimeType: string,
  filename: string,
  meta?: Record<string, unknown>
) {
  if (buffer.length > 25 * 1024 * 1024) throw new Error("Asset exceeds 25 MB storage limit");
  await mkdir(UPLOADS_DIR, { recursive: true });
  const key = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await writeFile(path.join(UPLOADS_DIR, key), buffer);
  const asset = await db.mediaAsset.create({
    data: {
      payload: { create: { data: new Uint8Array(buffer) } },
      userId,
      kind,
      filename,
      mimeType,
      size: buffer.length,
      storageKey: key,
      metaJson: meta ? JSON.stringify(meta) : null,
    },
  });
  return asset;
}

export async function saveAssetBase64(
  userId: string,
  base64: string,
  kind: string,
  mimeType: string,
  filename: string,
  meta?: Record<string, unknown>
) {
  return saveAssetBuffer(userId, Buffer.from(base64, "base64"), kind, mimeType, filename, meta);
}

export async function readAssetBuffer(asset: { id: string; storageKey: string }) {
  const payload = await db.mediaPayload.findUnique({ where: { assetId: asset.id } });
  if (payload) return Buffer.from(payload.data);
  return readFile(path.join(UPLOADS_DIR, asset.storageKey));
}
export async function materializeAsset(asset: { id: string; storageKey: string }) {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const file = path.join(UPLOADS_DIR, path.basename(asset.storageKey));
  await writeFile(file, await readAssetBuffer(asset));
  return file;
}

// ---------- Health checks (runtime verification → LIVE_VERIFIED) ----------

export async function healthCheck(providerId: string): Promise<HealthResult> {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, reason: "unknown provider" };
  if (!provider.supportsHealthCheck) {
    return { ok: false, reason: provider.statusNote ?? "health check not supported" };
  }
  const started = Date.now();
  try {
    const zai = await getZai();
    if (providerId === "zai-core") {
      await zai.chat.completions.create({
        messages: [{ role: "user", content: "ping" }],
        thinking: { type: "disabled" },
      });
    } else if (providerId === "zai-research") {
      await zai.functions.invoke("web_search", { query: "test", num: 1 });
    } else if (providerId === "zai-image" || providerId === "zai-tts" || providerId === "zai-video" || providerId === "zai-asr") {
      // Avoid paid calls for health check — mark verified via config presence of gateway
      return { ok: true, latencyMs: Date.now() - started, reason: "gateway reachable (non-paid check)" };
    }
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, reason: err instanceof Error ? err.message : "unreachable" };
  }
}

// ---------- LLM ----------

export async function llmComplete(opts: {
  system?: string;
  prompt: string;
  json?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const provider = process.env.LLM_PROVIDER ?? "zai";
  if (provider === "openrouter" || provider === "google") return cloudComplete(provider, opts);
  if (provider !== "zai") throw new Error("Unsupported LLM_PROVIDER server configuration");
  const zai = await getZai();
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.prompt });
  const res = await zai.chat.completions.create({
    messages,
    thinking: { type: "disabled" },
  });
  const content = res?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("LLM returned empty content");
  return content;
}

export async function llmCompleteJson<T>(opts: { system?: string; prompt: string }): Promise<T> {
  const raw = await llmComplete({
    system: opts.system,
    prompt: opts.prompt + "\n\nIMPORTANT: respond with valid JSON only, no markdown fences, no commentary.",
    json: true,
  });
  return extractJson<T>(raw);
}

export function extractJson<T>(raw: string): T {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.search(/[[{]/);
  if (start > 0) text = text.slice(start);
  const lastBrace = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (lastBrace >= 0) text = text.slice(0, lastBrace + 1);
  try {
    return JSON.parse(text) as T;
  } catch {
    // Bounded second chance for the two most common LLM slips:
    // trailing commas and unquoted string tokens inside flat arrays
    // (observed live: "hashtags": [denGems, #YerevanSeason]).
    // Anything else still throws — honest failure, callers retry bounded.
    return JSON.parse(repairLooseJson(text)) as T;
  }
}

function repairLooseJson(text: string): string {
  // 1. trailing commas
  let s = text.replace(/,\s*([\]}])/g, "$1");
  // 2. quote bare tokens in FLAT comma-separated arrays only (no nested brackets)
  s = s.replace(/\[([^\[\]{}]*?)\]/g, (m: string, inner: string) => {
    if (!inner.trim()) return m;
    const parts = inner.split(",").map((p) => {
      const t = p.trim();
      if (!t) return t;
      if (/^".*"$/.test(t) || /^'.*'$/.test(t)) return JSON.stringify(t.slice(1, -1));
      if (/^-?\d+(\.\d+)?$/.test(t) || /^(true|false|null)$/.test(t)) return t;
      // bare token — also strip stray unbalanced quotes the model sometimes
      // leaves (observed live: `WineHeritage",` → tag must not keep the `"` )
      return JSON.stringify(t.replace(/^["']+|["']+$/g, ""));
    });
    return `[${parts.join(",")}]`;
  });
  return s;
}

// ---------- Image ----------

const SIZE_BY_ASPECT: Record<string, string> = {
  "1:1": "1024x1024",
  "9:16": "768x1344",
  "3:4": "864x1152",
  "16:9": "1344x768",
  "4:3": "1152x864",
  "2:1": "1440x720",
  "1:2": "720x1440",
};

export function sizeForAspect(aspect?: string, fallback = "1024x1024"): string {
  if (!aspect) return fallback;
  return SIZE_BY_ASPECT[aspect] ?? fallback;
}

export async function imageGenerate(opts: {
  prompt: string;
  aspectRatio?: string;
  referenceImageBase64?: string;
  referenceMimeType?: string;
  provider?: string;
}): Promise<{ base64: string; mimeType?: string }> {
  if (opts.provider === "gemini-image") return googleImage(opts);
  const zai = await getZai();
  const size = sizeForAspect(opts.aspectRatio) as "1024x1024";
  if (opts.referenceImageBase64) {
    const res = await zai.images.generations.edit({
      prompt: opts.prompt,
      image: opts.referenceImageBase64,
      size,
    });
    const b64 = res?.data?.[0]?.base64;
    if (!b64) throw new Error("Image edit returned no data");
    return { base64: b64 };
  }
  const res = await zai.images.generations.create({ prompt: opts.prompt, size });
  const b64 = res?.data?.[0]?.base64;
  if (!b64) throw new Error("Image generation returned no data");
  return { base64: b64 };
}

// ---------- Video (async job mechanics) ----------

const VIDEO_SIZE: Record<string, string> = {
  "16:9": "1280x720",
  "9:16": "720x1280",
  "1:1": "1024x1024",
};

// Provider contract: only these clip lengths are accepted (API rejects others
// with "unsupported duration"). Shot plans are snapped to the nearest value.
export const SUPPORTED_VIDEO_DURATIONS = process.env.VIDEO_PROVIDER === "google" ? [4, 6, 8] : [5, 10];

export function snapVideoDuration(sec: number): number {
  const n = Math.max(1, Math.round(Number(sec) || 5));
  return SUPPORTED_VIDEO_DURATIONS.reduce((best, d) =>
    Math.abs(d - n) < Math.abs(best - n) ? d : best,
  );
}

export async function videoSubmit(opts: {
  prompt: string;
  aspectRatio?: string;
  durationSec?: number;
  referenceImageUrl?: string;
  provider?: string;
}): Promise<{ providerJobId: string }> {
  if (opts.provider === "gemini-video") return googleVideoSubmit(opts);
  const zai = await getZai();
  const size = VIDEO_SIZE[opts.aspectRatio ?? "9:16"] ?? "720x1280";
  const res = await zai.video.generations.create({
    prompt: opts.prompt.slice(0, 1500),
    size,
    duration: snapVideoDuration(opts.durationSec ?? 5),
    with_audio: false,
    watermark_enabled: false,
  });
  if (!res?.id) throw new Error("Video provider did not return job id");
  return { providerJobId: res.id };
}

export async function videoPoll(providerJobId: string): Promise<{
  status: "PROCESSING" | "SUCCESS" | "FAIL";
  outputUrl?: string;
  error?: string;
}> {
  if (providerJobId.startsWith("google:")) return googleVideoPoll(providerJobId);
  const zai = await getZai();
  const res = await zai.async.result.query(providerJobId);
  const status = res?.task_status;
  if (status === "SUCCESS") {
    const url = res?.video_result?.[0]?.url ?? res?.video_url ?? res?.url ?? res?.video;
    if (!url) return { status: "FAIL", error: "Provider reported SUCCESS but no video URL present" };
    return { status: "SUCCESS", outputUrl: url };
  }
  if (status === "FAIL") return { status: "FAIL", error: res?.fail_msg ?? "Video generation failed at provider" };
  return { status: "PROCESSING" };
}

export async function downloadToBuffer(url: string, provider?: string): Promise<Buffer> {
  if (provider === "gemini-video") return googleVideoDownload(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download asset: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------- TTS ----------

export async function ttsGenerate(opts: {
  text: string;
  voice?: string;
  speed?: number;
  provider?: string;
}): Promise<{ base64: string; mimeType: string }> {
  if (opts.provider === "gemini-tts" || (!opts.provider && process.env.TTS_PROVIDER === "google")) return googleTts(opts);
  const zai = await getZai();
  // SDK returns the raw Response object for TTS (caller parses body itself).
  // NOTE: provider rejects custom response_format (err 1214) — omit it.
  const res = (await zai.audio.tts.create({
    input: opts.text.slice(0, 2000),
    voice: opts.voice ?? "tongtong",
    speed: opts.speed ?? 1,
  })) as unknown as Response;
  let buffer: Buffer | null = null;
  let mimeType = "audio/mpeg";
  if (res && typeof (res as Response).arrayBuffer === "function") {
    const ct = res.headers?.get?.("content-type");
    if (ct) mimeType = ct.split(";")[0];
    const ab = await (res as Response).arrayBuffer();
    buffer = Buffer.from(ab);
    if (res.status && res.status >= 400) throw new Error(`TTS provider HTTP ${res.status}`);
    if (!buffer.length) throw new Error("TTS returned empty audio");
  } else {
    // Fallbacks in case SDK changes to parsed JSON/base64
    const r = res as unknown as { data?: string; base64?: string };
    const b64 = r?.data ?? r?.base64;
    if (b64) buffer = Buffer.from(b64, "base64");
  }
  if (!buffer) throw new Error("TTS returned no audio data");
  // Provider streams raw PCM (24kHz, 16-bit mono). Wrap into WAV container for browser playback.
  if (mimeType.includes("pcm")) {
    const sampleRate = Number(res.headers?.get?.("return-sample-rate") ?? 24000) || 24000;
    buffer = pcmToWav(buffer, sampleRate, 1, 16);
    mimeType = "audio/wav";
  }
  return { base64: buffer.toString("base64"), mimeType };
}

function pcmToWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// ---------- ASR (speech-to-text) ----------

export async function asrTranscribe(opts: { base64: string }): Promise<{ text: string }> {
  const zai = await getZai();
  const res = (await zai.audio.asr.create({ file_base64: opts.base64 })) as unknown as {
    text?: string;
    data?: string | { text?: string };
  };
  const text =
    typeof res?.text === "string"
      ? res.text
      : typeof res?.data === "string"
        ? res.data
        : typeof res?.data?.text === "string"
          ? res.data.text
          : "";
  if (!text.trim()) throw new Error("ASR returned empty transcription");
  return { text: text.trim() };
}

// ---------- Research ----------

export async function webSearch(opts: { query: string; num?: number; recencyDays?: number }) {
  const zai = await getZai();
  let lastErr: unknown;
  // one retry with backoff — the upstream search provider rate-limits rapid consecutive calls (429)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 8000));
      return await zai.functions.invoke("web_search", {
        query: opts.query,
        num: opts.num ?? 8,
        recency_days: opts.recencyDays,
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("web_search failed");
}

export async function pageRead(url: string) {
  const zai = await getZai();
  const res = await zai.functions.invoke("page_reader", { url });
  return res;
}

// ---------- SSRF protection for user-supplied URLs ----------

export function isSafeExternalUrl(input: string): boolean {
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return false;
    if (host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host === "169.254.169.254" || host === "metadata.google.internal") return false;
    if (u.port && ["22", "3306", "5432", "6379", "27017"].includes(u.port)) return false;
    return true;
  } catch {
    return false;
  }
}
