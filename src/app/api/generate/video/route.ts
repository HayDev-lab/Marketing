import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, parseJson } from "@/lib/api";
import { audit, ledger } from "@/lib/ledger";
import { assertQuota } from "@/lib/subscription";
import { jobs } from "@/lib/jobs";
import { routeCapability, getProviderModel } from "@/lib/ai/registry";
import { videoSubmit, llmCompleteJson } from "@/lib/ai/zai";

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
      await jobs.markProcessing(job.id);
      try {
        const submitted = await videoSubmit({
          prompt: scene.prompt + continuityContext,
          aspectRatio: project.aspectRatio,
          durationSec: scene.durationSec,
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
              durationSec: Math.min(10, Math.max(4, durationSec / Math.max(1, beats.length))),
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

    throw new ApiError(400, "BAD_ACTION", "Unknown action");
  });
}

function brandTitle(body: Record<string, unknown>): string {
  return String(body.title ?? body.topic ?? "brand promo video");
}
