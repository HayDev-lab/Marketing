import { NextRequest } from "next/server";
import path from "path";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, parseJson } from "@/lib/api";
import { audit, ledger } from "@/lib/ledger";
import { assertQuota } from "@/lib/subscription";
import { jobs } from "@/lib/jobs";
import { routeCapability, getProviderModel } from "@/lib/ai/registry";
import { videoSubmit, llmCompleteJson, snapVideoDuration, ttsGenerate, saveAssetBase64, UPLOADS_DIR } from "@/lib/ai/zai";
import { kickAssembly, probeMedia } from "@/lib/video/assemble";
import { assertRouteAllowed } from "@/lib/ai/system-config";

export const VOICEOVER_TEXT_LIMIT = 2000;

// POST /api/generate/video — create/extend VideoProject, submit ONE scene to async provider.
// Long-running: job goes WAITING_PROVIDER; client polls /api/jobs/[id] (reconciliation, resume).
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const action = body.action ?? "generate_scene";

    if (action === "generate_scene") {
      const sceneId = String(body.sceneId ?? "");
      const scene = await db.videoScene.findUnique({ where: { id: sceneId }, include: { project: true } });
      if (!scene || scene.project.userId !== user.id) throw new ApiError(404, "SCENE_NOT_FOUND", "Scene not found");
      if (scene.status === "COMPLETED" && scene.assetId) {
        throw new ApiError(409, "SCENE_DONE", "Scene already generated — regenerate explicitly to replace");
      }
      const project = scene.project;
      const styleBible = parseJson<Record<string, unknown>>(project.styleBibleJson, {});
      const characterBible = parseJson<Record<string, unknown>>(project.characterBibleJson, {});

      const route = routeCapability({
        capability: "VIDEO_GENERATION",
        userPreferenceProvider: body.provider,
        aspectRatio: project.aspectRatio,
        durationSec: Math.ceil(scene.durationSec),
      });
      if (!route) throw new ApiError(503, "NO_PROVIDER", "No video provider available");
      await assertRouteAllowed({ providerId: route.providerId, modelId: route.modelId }, user.id);
      const model = getProviderModel(route.providerId, route.modelId);
      const estimatedCost = model?.estimatedCostPerCall ?? 0.1;
      await assertQuota(user.id, "VIDEO_GENERATION", estimatedCost, { videoDurationSec: Math.ceil(scene.durationSec) });
      await ledger.assertBudget(user.id, estimatedCost);

      const { job } = await jobs.create({
        userId: user.id,
        kind: "VIDEO",
        provider: route.providerId,
        model: route.modelId,
        input: { sceneId, prompt: scene.prompt },
        idempotencyKey: `scene:${scene.id}:v${scene.version}:a${scene.retries}`,
        estimatedCost,
      });
      if (job.status === "COMPLETED" && job.resultAssetId) {
        return ok({ jobId: job.id, assetId: job.resultAssetId, deduplicated: true });
      }

      // Continuity: semantic (character+style bibles appended); provider continuation honestly unsupported here
      const continuityContext = Object.keys(characterBible).length || Object.keys(styleBible).length
        ? `\n\nCharacter Bible: ${JSON.stringify(characterBible)}\nStyle Bible: ${JSON.stringify(styleBible)}`
        : "";
      // Snap the scene to a provider-supported clip length; keep the row honest
      // (the stored duration must equal the clip the provider actually renders).
      const submitDuration = snapVideoDuration(scene.durationSec);
      if (submitDuration !== scene.durationSec) {
        await db.videoScene.update({ where: { id: scene.id }, data: { durationSec: submitDuration } });
      }
      await jobs.markProcessing(job.id);
      try {
        const submitted = await videoSubmit({
          prompt: scene.prompt + continuityContext,
          aspectRatio: project.aspectRatio,
          durationSec: submitDuration,
        });
        await jobs.markSubmitted(job.id, submitted.providerJobId);
        await db.videoScene.update({
          where: { id: scene.id },
          data: { status: "GENERATING", provider: route.providerId, model: route.modelId, jobId: job.id },
        });
        await db.videoProject.update({ where: { id: project.id }, data: { status: "GENERATING" } });
        await audit.log({ userId: user.id, action: "video.scene_submit", objectType: "VideoScene", objectId: scene.id, summary: `Scene ${scene.order} submitted (${route.reason})` });
        return ok({ jobId: job.id, providerJobId: submitted.providerJobId, sceneId: scene.id, routedBecause: route.reason });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Video submit failed";
        await jobs.markFailed(job.id, message);
        await db.videoScene.update({ where: { id: scene.id }, data: { status: "FAILED", error: message.slice(0, 500) } });
        throw new ApiError(502, "SUBMIT_FAILED", message, { jobId: job.id, canRetry: true });
      }
    }

    if (action === "create_project") {
      const brandId = body.brandId ? String(body.brandId) : null;
      if (brandId) {
        const brand = await db.brand.findUnique({ where: { id: brandId } });
        if (!brand || brand.userId !== user.id) throw new ApiError(404, "BRAND_NOT_FOUND", "Brand not found");
      }
      const durationSec = [15, 30, 60].includes(body.durationSec) ? body.durationSec : 30;
      const aspectRatio = ["9:16", "1:1", "16:9"].includes(body.aspectRatio) ? body.aspectRatio : "9:16";
      const language = ["hy", "ru", "en"].includes(body.language) ? body.language : "hy";
      const project = await db.videoProject.create({
        data: {
          userId: user.id,
          brandId,
          contentItemId: body.contentItemId ?? null,
          title: String(body.title ?? "Video project").slice(0, 200),
          durationSec,
          aspectRatio,
          language,
          script: body.script ? String(body.script).slice(0, 8000) : null,
          characterBibleJson: body.characterBible ? JSON.stringify(body.characterBible) : null,
          styleBibleJson: body.styleBible ? JSON.stringify(body.styleBible) : null,
          status: "DRAFT",
        },
      });
      // Shot plan → scenes (LLM if requested, else duration/6 evenly)
      if (body.autoShotPlan) {
        const plan = await llmCompleteJson<{ scenes: { prompt: string; narration?: string }[] }>({
          system: "You are a shot planner for short-form vertical video. Split the script into 3-6 scenes. Each scene: visual prompt (English, rich detail for video AI) + narration line in the project language. Ground in brand data; invent no facts.",
          prompt: `Script: ${project.script ?? body.topic ?? brandTitle(body)}\nDuration: ${durationSec}s total. Aspect: ${aspectRatio}. Language: ${language}\nReturn JSON {"scenes":[{"prompt":str,"narration":str}]}`,
        });
        const beats = plan.scenes ?? [];
        let order = 0;
        for (const beat of beats.slice(0, 6)) {
          await db.videoScene.create({
            data: {
              projectId: project.id,
              order: order++,
              // snap to a provider-supported clip length (5s/10s)
              durationSec: snapVideoDuration(durationSec / Math.max(1, beats.length)),
              prompt: String(beat.prompt).slice(0, 2000),
              narration: beat.narration ? String(beat.narration).slice(0, 1000) : null,
              status: "PENDING",
            },
          });
        }
        await db.videoProject.update({ where: { id: project.id }, data: { status: "SCRIPT_READY" } });
      }
      await audit.log({ userId: user.id, action: "video.project_create", objectType: "VideoProject", objectId: project.id });
      const full = await db.videoProject.findUnique({ where: { id: project.id }, include: { scenes: { orderBy: { order: "asc" } } } });
      return ok(full, 201);
    }

    if (action === "generate_script") {
      const projectId = String(body.projectId ?? "");
      const project = await db.videoProject.findUnique({ where: { id: projectId } });
      if (!project || project.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Project not found");
      const brand = project.brandId ? await db.brand.findUnique({ where: { id: project.brandId }, include: { profile: true } }) : null;
      const language = body.language ?? project.language;
      const copy = await llmCompleteJson<{ script: string; styleBible: Record<string, unknown>; characterBible: Record<string, unknown> }>({
        system: "You are a short-form video scriptwriter. Ground claims in brand data only; never invent prices/reviews/awards.",
        prompt: `Brand: ${brand?.name ?? "user brand"}; positioning: ${brand?.profile?.positioning ?? ""}; tone: ${brand?.profile?.tone ?? ""}\nBrief: ${String(body.brief ?? project.title)}\nDuration: ${project.durationSec}s; Language: ${language}; Platform: vertical ${project.aspectRatio}\nReturn JSON {"script": str (in ${language}), "styleBible": {"palette":str,"lighting":str,"camera":str,"motion":str}, "characterBible": {"appearance":str,"wardrobe":str,"ageRange":str}}`,
      });
      const updated = await db.videoProject.update({
        where: { id: project.id },
        data: {
          script: copy.script?.slice(0, 8000),
          styleBibleJson: JSON.stringify(copy.styleBible ?? {}),
          characterBibleJson: JSON.stringify(copy.characterBible ?? {}),
          status: "SCRIPT_READY",
        },
      });
      return ok(updated);
    }

    // ---- Final assembly: durable ASSEMBLE job, local FFmpeg mixdown (REAL video out) ----
    if (action === "assemble_project") {
      const projectId = String(body.projectId ?? "");
      const project = await db.videoProject.findUnique({ where: { id: projectId }, include: { scenes: true } });
      if (!project || project.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Project not found");
      const readyCount = project.scenes.filter((s) => s.status === "COMPLETED" && s.assetId).length;
      if (project.scenes.length === 0 || readyCount === 0) {
        throw new ApiError(409, "NO_SCENES", "No generated scenes to assemble — generate at least one scene first");
      }
      // Honest idempotency: a completed assembly for the same project fingerprint re-runs
      // deliberately (user may have picked a new soundtrack), so the key carries a revision.
      const stamp = `${readyCount}:${project.scenes.length}:${Date.now()}`;
      const { job } = await jobs.create({
        userId: user.id,
        kind: "ASSEMBLE",
        provider: "ffmpeg-local",
        model: "h264-aac",
        input: { projectId: project.id },
        idempotencyKey: `assemble:${project.id}:${stamp}`,
        maxAttempts: 1,
      });
      await audit.log({
        userId: user.id,
        action: "video.assemble_submit",
        objectType: "VideoProject",
        objectId: project.id,
        summary: `Assembly queued (${readyCount}/${project.scenes.length} scenes ready)`,
      });
      kickAssembly(job.id);
      return ok({ jobId: job.id }, 202);
    }

    // ---- Voiceover: REAL TTS narration from the project script / scene narrations ----
    // Synchronous durable job (same pattern as /api/generate/tts): short audio, safe in-request.
    // Result is attached to the project via metaJson.voiceover and consumed by the ASSEMBLE mixdown.
    if (action === "generate_voiceover") {
      const projectId = String(body.projectId ?? "");
      const project = await db.videoProject.findUnique({ where: { id: projectId }, include: { scenes: { orderBy: { order: "asc" } } } });
      if (!project || project.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Project not found");

      // Text: explicit user text → scene narrations (in order) → full script. Honest 409 when nothing to speak.
      let text = String(body.text ?? "").trim();
      let textSource: "user" | "narrations" | "script" = "user";
      if (!text) {
        const narrations = project.scenes.map((s) => (s.narration ?? "").trim()).filter(Boolean);
        if (narrations.length > 0) {
          text = narrations.join("\n\n");
          textSource = "narrations";
        } else if (project.script?.trim()) {
          text = project.script.trim();
          textSource = "script";
        } else {
          throw new ApiError(409, "NO_NARRATION_TEXT", "No voiceover text: write narration lines on scenes or generate a script first");
        }
      }
      if (text.length > VOICEOVER_TEXT_LIMIT) {
        throw new ApiError(400, "TEXT_TOO_LONG", `Voiceover text too long: ${text.length} chars (max ${VOICEOVER_TEXT_LIMIT} per call — shorten or split the script)`);
      }

      const voice = String(body.voice ?? "tongtong");
      const speed = Math.min(1.5, Math.max(0.5, Number(body.speed) || 1));
      const route = routeCapability({ capability: "TTS" });
      if (!route) throw new ApiError(503, "NO_PROVIDER", "No TTS provider available");
      await assertRouteAllowed({ providerId: route.providerId, modelId: route.modelId }, user.id);
      const estimatedCost = 0.005;
      await assertQuota(user.id, "TTS", estimatedCost);

      const { job } = await jobs.create({
        userId: user.id,
        kind: "TTS",
        provider: route.providerId,
        model: route.modelId,
        input: { projectId: project.id, voiceover: true, text, voice, speed },
        idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : `voiceover:${project.id}:${text.length}:${voice}:${speed}:${Date.now()}`,
        estimatedCost,
      });
      if (job.status === "COMPLETED" && job.resultAssetId) {
        return ok({ jobId: job.id, assetId: job.resultAssetId, deduplicated: true });
      }
      await jobs.markProcessing(job.id);
      try {
        const result = await ttsGenerate({ text, voice, speed });
        const asset = await saveAssetBase64(user.id, result.base64, "VOICE", result.mimeType, `voiceover_${project.id.slice(-6)}.mp3`, {
          projectId: project.id,
          voice,
          speed,
          chars: text.length,
          provider: route.providerId,
        });
        await jobs.markCompleted(job.id, { assetId: asset.id, url: `/api/assets/${asset.id}/raw` }, asset.id, estimatedCost);

        const prevMeta = parseJson<Record<string, unknown>>(project.metaJson, {});
        const prevVoiceover = (prevMeta.voiceover ?? null) as Record<string, unknown> | null;
        const voiceover = {
          // preserve user's include/duck toggles when regenerating the audio
          enabled: prevVoiceover ? Boolean(prevVoiceover.enabled ?? true) : true,
          duckMusic: prevVoiceover ? Boolean(prevVoiceover.duckMusic ?? true) : true,
          text,
          textSource,
          voice,
          speed,
          assetId: asset.id,
          generatedAt: new Date().toISOString(),
        };
        await db.videoProject.update({
          where: { id: project.id },
          data: { metaJson: JSON.stringify({ ...prevMeta, voiceover }) },
        });
        await audit.log({
          userId: user.id,
          action: "video.voiceover_generate",
          objectType: "VideoProject",
          objectId: project.id,
          summary: `Voiceover ${text.length} chars (${textSource}) via ${route.providerId}`,
        });
        return ok({ jobId: job.id, assetId: asset.id, url: `/api/assets/${asset.id}/raw`, chars: text.length, textSource });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Voiceover TTS failed";
        await jobs.markFailed(job.id, message);
        throw new ApiError(502, "GENERATION_FAILED", message, { jobId: job.id, canRetry: true });
      }
    }

    // ---- Per-scene voiceover: REAL TTS for ONE scene narration ----
    // Synchronous durable job (same pattern as the project-level voiceover). The audio is
    // linked on the scene (voiceAssetId + measured voiceDurationSec via ffprobe) and the
    // per-scene mixdown places each clip at its scene's REAL normalized offset.
    if (action === "generate_scene_voiceover") {
      const sceneId = String(body.sceneId ?? "");
      const scene = await db.videoScene.findUnique({ where: { id: sceneId }, include: { project: true } });
      if (!scene || scene.project.userId !== user.id) throw new ApiError(404, "SCENE_NOT_FOUND", "Scene not found");
      // Text: explicit override → scene narration (scene prompt is NOT spoken — visual prompt, not narration)
      const text = String(body.text ?? scene.narration ?? "").trim();
      if (!text) {
        throw new ApiError(409, "NO_NARRATION_TEXT", "Scene has no narration text — write a narration line for this scene first");
      }
      if (text.length > VOICEOVER_TEXT_LIMIT) {
        throw new ApiError(400, "TEXT_TOO_LONG", `Scene narration too long: ${text.length} chars (max ${VOICEOVER_TEXT_LIMIT})`);
      }
      const voice = String(body.voice ?? "tongtong");
      const speed = Math.min(1.5, Math.max(0.5, Number(body.speed) || 1));
      const route = routeCapability({ capability: "TTS" });
      if (!route) throw new ApiError(503, "NO_PROVIDER", "No TTS provider available");
      await assertRouteAllowed({ providerId: route.providerId, modelId: route.modelId }, user.id);
      const estimatedCost = 0.005;
      await assertQuota(user.id, "TTS", estimatedCost);

      const { job } = await jobs.create({
        userId: user.id,
        kind: "TTS",
        provider: route.providerId,
        model: route.modelId,
        input: { sceneId: scene.id, sceneVoiceover: true, text, voice, speed },
        idempotencyKey: `scene_voiceover:${scene.id}:${text.length}:${voice}:${speed}:${Date.now()}`,
        estimatedCost,
      });
      if (job.status === "COMPLETED" && job.resultAssetId) {
        return ok({ jobId: job.id, assetId: job.resultAssetId, deduplicated: true });
      }
      await jobs.markProcessing(job.id);
      try {
        const result = await ttsGenerate({ text, voice, speed });
        const asset = await saveAssetBase64(user.id, result.base64, "VOICE", result.mimeType, `scene_voice_${scene.order + 1}_${scene.id.slice(-6)}.mp3`, {
          projectId: scene.projectId,
          sceneId: scene.id,
          voice,
          speed,
          chars: text.length,
          provider: route.providerId,
        });
        // measure the REAL spoken length — the per-scene mixdown offsets and the §23
        // subtitle timing both depend on it; unknown duration stays honest null
        let voiceDurationSec: number | null = null;
        try {
          const media = await db.mediaAsset.findUnique({ where: { id: asset.id } });
          if (media) {
            const probe = await probeMedia(path.join(UPLOADS_DIR, media.storageKey));
            voiceDurationSec = Number(probe.durationSec.toFixed(2));
          }
        } catch {
          voiceDurationSec = null; // honest: unknown — estimated timing downstream
        }
        const updated = await db.videoScene.update({
          where: { id: scene.id },
          data: { voiceAssetId: asset.id, voiceDurationSec },
        });
        await jobs.markCompleted(job.id, { assetId: asset.id, url: `/api/assets/${asset.id}/raw`, voiceDurationSec }, asset.id, estimatedCost);
        await audit.log({
          userId: user.id,
          action: "video.scene_voiceover_generate",
          objectType: "VideoScene",
          objectId: scene.id,
          summary: `Scene ${scene.order + 1} voice: ${text.length} chars${voiceDurationSec ? `, ${voiceDurationSec}s` : ""} via ${route.providerId}`,
        });
        return ok({ jobId: job.id, assetId: asset.id, url: `/api/assets/${asset.id}/raw`, voiceDurationSec, chars: text.length, scene: updated });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Scene TTS failed";
        await jobs.markFailed(job.id, message);
        throw new ApiError(502, "GENERATION_FAILED", message, { jobId: job.id, canRetry: true });
      }
    }

    throw new ApiError(400, "BAD_ACTION", "Unknown action");
  });
}

function brandTitle(body: Record<string, unknown>): string {
  return String(body.title ?? body.topic ?? "brand promo video");
}
