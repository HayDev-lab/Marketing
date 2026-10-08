import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, parseJson } from "@/lib/api";
import { audit, ledger } from "@/lib/ledger";
import { assertQuota } from "@/lib/subscription";
import { jobs } from "@/lib/jobs";
import { routeCapability, getProviderModel } from "@/lib/ai/registry";
import { assertRouteAllowed } from "@/lib/ai/system-config";
import { imageGenerate, saveAssetBase64, UPLOADS_DIR, readAssetBuffer } from "@/lib/ai/zai";
import { readFile } from "fs/promises";
import path from "path";

// POST /api/generate/image — text-to-image or reference-edit; records prompt provenance + cost
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const prompt = String(body.prompt ?? "").trim();
    if (!prompt) throw new ApiError(400, "VALIDATION", "Prompt is required");
    if (prompt.length > 4000) throw new ApiError(400, "VALIDATION", "Prompt too long (max 4000 chars)");
    const aspectRatio = ["1:1", "9:16", "3:4", "16:9", "4:3", "2:1", "1:2"].includes(body.aspectRatio) ? body.aspectRatio : "1:1";

    const route = routeCapability({
      capability: "IMAGE_GENERATION",
      userPreferenceProvider: body.provider,
      userPreferenceModel: body.model,
      aspectRatio,
      referenceImage: Boolean(body.refAssetId),
    });
    if (!route) throw new ApiError(503, "NO_PROVIDER", "No image generation provider is available");
    if (route.status === "BLOCKED_EXTERNAL") {
      throw new ApiError(503, "PROVIDER_BLOCKED", `Provider ${route.providerId} is blocked: no external API key configured`);
    }
    // §30 platform guard: admin disabled providers / blacklisted models / user-disabled provider
    await assertRouteAllowed({ providerId: route.providerId, modelId: route.modelId }, user.id);
    const model = getProviderModel(route.providerId, route.modelId);
    const estimatedCost = model?.estimatedCostPerCall ?? 0.02;
    await assertQuota(user.id, "IMAGE_GENERATION", estimatedCost);
    await ledger.assertBudget(user.id, estimatedCost);

    // Reference image (never lost — stored + recorded)
    let refBase64: string | undefined;
    let refMimeType: string | undefined;
    let refAssetId: string | null = null;
    if (body.refAssetId) {
      const asset = await db.mediaAsset.findUnique({ where: { id: String(body.refAssetId) } });
      if (!asset || asset.userId !== user.id) throw new ApiError(404, "ASSET_NOT_FOUND", "Reference asset not found");
      refAssetId = asset.id;
      refMimeType = asset.mimeType;
      refBase64 = (await readAssetBuffer(asset)).toString("base64");
    }

    const { job, deduplicated } = await jobs.create({
      userId: user.id,
      kind: "IMAGE",
      provider: route.providerId,
      model: route.modelId,
      input: { prompt, aspectRatio, refAssetId },
      idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : undefined,
      brandId: body.brandId ?? undefined,
      estimatedCost,
    });

    if (job.status === "COMPLETED" && job.resultAssetId) {
      return ok({ jobId: job.id, assetId: job.resultAssetId, deduplicated: true });
    }

    if (deduplicated) return ok({ jobId: job.id, status: job.status, deduplicated: true });
    await jobs.markProcessing(job.id);
    const started = Date.now();
    try {
      const result = await imageGenerate({ prompt, aspectRatio, referenceImageBase64: refBase64, referenceMimeType: refMimeType, provider: route.providerId });
      const asset = await saveAssetBase64(user.id, result.base64, "IMAGE", result.mimeType || "image/png", `img_${job.id.slice(-6)}.png`, {
        provider: route.providerId,
        model: route.modelId,
      });
      const compiled = body.compiledPrompt ? String(body.compiledPrompt).slice(0, 6000) : null;
      await db.imageGeneration.create({
        data: {
          userId: user.id,
          brandId: body.brandId ?? null,
          jobId: job.id,
          prompt,
          compiledPrompt: compiled,
          provider: route.providerId,
          model: route.modelId,
          paramsJson: JSON.stringify({ aspectRatio, refAssetId }),
          refAssetId,
          assetId: asset.id,
          status: "COMPLETED",
          cost: estimatedCost,
          latencyMs: Date.now() - started,
        },
      });
      await jobs.markCompleted(job.id, { assetId: asset.id, url: `/api/assets/${asset.id}/raw` }, asset.id, estimatedCost);
      await audit.log({
        userId: user.id,
        action: "image.generate",
        objectType: "ImageGeneration",
        objectId: job.id,
        summary: `Image generated via ${route.providerId}/${route.modelId} (${route.reason})`,
      });
      return ok({ jobId: job.id, assetId: asset.id, url: `/api/assets/${asset.id}/raw`, provider: route.providerId, model: route.modelId, routedBecause: route.reason });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Image generation failed";
      await jobs.markFailed(job.id, message, { needsUserAction: true });
      throw new ApiError(502, "GENERATION_FAILED", message, { jobId: job.id, canRetry: true });
    }
  });
}

export const maxDuration = 180;
