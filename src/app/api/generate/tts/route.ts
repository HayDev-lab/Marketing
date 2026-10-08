import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, parseJson } from "@/lib/api";
import { audit, ledger } from "@/lib/ledger";
import { assertQuota } from "@/lib/subscription";
import { jobs } from "@/lib/jobs";
import { GOOGLE_VOICES } from "@/lib/ai/google-media";
import { routeCapability } from "@/lib/ai/registry";
import { assertRouteAllowed } from "@/lib/ai/system-config";
import { ttsGenerate, saveAssetBase64, llmComplete } from "@/lib/ai/zai";

// POST /api/generate/tts — voiceover generation (script + voice params persisted verbatim)
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();

    if (body.action === "save_voice_profile") {
      const profile = await db.voiceProfile.create({
        data: {
          userId: user.id,
          name: String(body.name ?? "Voice").slice(0, 100),
          kind: "NATIVE",
          provider: body.provider ?? "zai-tts",
          voiceId: String(body.voiceId ?? "tongtong"),
          language: body.language ?? "hy",
          paramsJson: JSON.stringify(body.params ?? {}),
          status: "ACTIVE",
        },
      });
      await audit.log({ userId: user.id, action: "voice.profile_save", objectType: "VoiceProfile", objectId: profile.id });
      return ok(profile, 201);
    }

    if (body.action === "list_voices") {
      const route = routeCapability({ capability: "TTS", userPreferenceProvider: body.provider });
      if (!route) return ok({ providerBlocked: true, voices: [] });
      const voices = route.providerId === "gemini-tts" ? GOOGLE_VOICES.map(id => ({ id, title: id, language: ["ru", "en"] })) : [
        { id: "tongtong", title: "Tongtong (female, warm)", language: ["hy", "ru", "en", "zh"] },
      ];
      return ok({ providerId: route.providerId, modelId: route.modelId, voices });
    }

    // generate
    const text = String(body.text ?? "").trim();
    if (!text) throw new ApiError(400, "VALIDATION", "Text is required");
    if (text.length > 2000) throw new ApiError(400, "VALIDATION", "Text too long (max 2000 chars per call)");
    const speed = Number(body.speed) || 1;

    const route = routeCapability({ capability: "TTS", userPreferenceProvider: body.provider });
    if (!route) throw new ApiError(503, "NO_PROVIDER", "No TTS provider available");
    if (route.status === "BLOCKED_EXTERNAL") {
      throw new ApiError(503, "PROVIDER_BLOCKED", `Provider ${route.providerId}: ${route.status ?? ""} — external API key not configured. Use the available provider or configure the key in Settings.`);
    }
    // §30 platform guard: admin disabled providers / blacklisted models / user-disabled provider
    await assertRouteAllowed({ providerId: route.providerId, modelId: route.modelId }, user.id);

    const estimatedCost = route.providerId === "gemini-tts" ? Math.max(0.005, text.length / 2000 * 0.06) : 0.005;
    await ledger.assertBudget(user.id, estimatedCost);
    await assertQuota(user.id, "TTS", estimatedCost);
    const { job, deduplicated } = await jobs.create({
      userId: user.id,
      kind: "TTS",
      provider: route.providerId,
      model: route.modelId,
      input: { text, voice: body.voice, speed },
      idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : undefined,
      brandId: body.brandId ?? undefined,
      estimatedCost,
    });
    if (job.status === "COMPLETED" && job.resultAssetId) {
      return ok({ jobId: job.id, assetId: job.resultAssetId, deduplicated: true });
    }
    if (deduplicated) return ok({ jobId: job.id, status: job.status, deduplicated: true });
    await jobs.markProcessing(job.id);
    try {
      const result = await ttsGenerate({ text, voice: body.voice, speed, provider: route.providerId });
      const asset = await saveAssetBase64(user.id, result.base64, "VOICE", result.mimeType, `tts_${job.id.slice(-6)}.${result.mimeType === "audio/wav" ? "wav" : "mp3"}`, {
        text,
        voice: body.voice ?? "tongtong",
        speed,
        provider: route.providerId,
        model: route.modelId,
      });
      await jobs.markCompleted(job.id, { assetId: asset.id, url: `/api/assets/${asset.id}/raw` }, asset.id, estimatedCost);
      await audit.log({ userId: user.id, action: "tts.generate", objectType: "GenerationJob", objectId: job.id, summary: `TTS ${text.length} chars via ${route.providerId}` });
      return ok({ jobId: job.id, assetId: asset.id, url: `/api/assets/${asset.id}/raw`, provider: route.providerId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "TTS failed";
      await jobs.markFailed(job.id, message, { needsUserAction: true });
      throw new ApiError(502, "GENERATION_FAILED", message, { jobId: job.id, canRetry: true });
    }
  });
}

export const maxDuration = 180;
