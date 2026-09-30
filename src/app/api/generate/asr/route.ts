import { NextRequest } from "next/server";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { jobs } from "@/lib/jobs";
import { routeCapability } from "@/lib/ai/registry";
import { asrTranscribe } from "@/lib/ai/zai";

const MAX_BYTES = 25 * 1024 * 1024; // 25MB decoded audio cap
const ALLOWED_EXT = /\.(wav|mp3|m4a|flac|ogg|webm|aac)$/i;

// POST /api/generate/asr — speech-to-text transcription (base64 audio in, text out)
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new ApiError(400, "VALIDATION", "JSON body required");

    const base64 = String(body.base64 ?? "").replace(/^data:[^;]+;base64,/, "").trim();
    if (!base64) throw new ApiError(400, "VALIDATION", "Audio file is required (base64)");
    const sizeBytes = Math.floor((base64.length * 3) / 4);
    if (sizeBytes > MAX_BYTES) throw new ApiError(400, "VALIDATION", "Audio file too large (max 25MB)");
    const fileName = body.fileName ? String(body.fileName).slice(0, 200) : "audio";
    if (body.fileName && !ALLOWED_EXT.test(fileName)) {
      throw new ApiError(400, "VALIDATION", "Unsupported audio format (use WAV, MP3, M4A, FLAC, OGG, WebM or AAC)");
    }

    const route = routeCapability({ capability: "TRANSCRIPTION" });
    if (!route) throw new ApiError(503, "NO_PROVIDER", "No transcription provider available");

    const { job } = await jobs.create({
      userId: user.id,
      kind: "TRANSCRIPTION",
      provider: route.providerId,
      model: route.modelId,
      input: { fileName, sizeBytes },
      idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : undefined,
      brandId: body.brandId ? String(body.brandId) : undefined,
      estimatedCost: 0.002,
    });
    if (job.status === "COMPLETED" && job.outputJson) {
      try {
        const prev = JSON.parse(job.outputJson) as { text?: string };
        if (prev.text) return ok({ jobId: job.id, text: prev.text, deduplicated: true });
      } catch { /* fall through to fresh run */ }
    }

    await jobs.markProcessing(job.id);
    try {
      const { text } = await asrTranscribe({ base64 });
      await jobs.markCompleted(job.id, { text, fileName }, undefined, 0.002);
      await audit.log({
        userId: user.id,
        action: "asr.transcribe",
        objectType: "GenerationJob",
        objectId: job.id,
        summary: `${fileName} (${Math.round(sizeBytes / 1024)}KB) via ${route.providerId}`,
      });
      return ok({ jobId: job.id, text, provider: route.providerId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transcription failed";
      await jobs.markFailed(job.id, message);
      throw new ApiError(502, "GENERATION_FAILED", message, { jobId: job.id, canRetry: true });
    }
  });
}
