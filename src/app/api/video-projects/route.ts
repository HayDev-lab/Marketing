import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";

// GET /api/video-projects — list user's projects (scene counts) or ?id= single project with scenes.
// Read-model endpoint for the Video Studio cockpit; writes go through actions in
// /api/generate/video plus the ownership-checked PATCH below.
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const project = await db.videoProject.findUnique({
        where: { id },
        include: { scenes: { orderBy: { order: "asc" } } },
      });
      if (!project || project.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Project not found");
      return ok(project);
    }
    const list = await db.videoProject.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 30,
      include: { _count: { select: { scenes: true } } },
    });
    return ok(list);
  });
}

// PATCH /api/video-projects — ownership-checked edits:
//   { projectId, sceneId, prompt }            → edit scene prompt
//   { projectId, sceneId, reset: true }       → reset COMPLETED/FAILED scene for regeneration (version+1)
//   { projectId, scenes: [{id, order}] }      → reorder scenes
//   { projectId, title?, script?, characterBible?, styleBible? } → project-level fields (bibles as plain objects)
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const projectId = String(body.projectId ?? "");
    const project = await db.videoProject.findUnique({ where: { id: projectId } });
    if (!project || project.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Project not found");

    // Scene-level edit (prompt or reset-for-regeneration)
    if (body.sceneId) {
      const scene = await db.videoScene.findUnique({ where: { id: String(body.sceneId) } });
      if (!scene || scene.projectId !== project.id) throw new ApiError(404, "SCENE_NOT_FOUND", "Scene not found");
      if (body.prompt !== undefined || body.reset) {
        const data: Record<string, unknown> = {};
        if (body.prompt !== undefined) data.prompt = String(body.prompt).slice(0, 2000);
        if (body.reset) {
          Object.assign(data, {
            status: "PENDING",
            assetId: null,
            jobId: null,
            error: null,
            lastFrameAssetId: null,
            version: scene.version + 1,
            retries: scene.retries + 1,
          });
        }
        await db.videoScene.update({ where: { id: scene.id }, data: data as never });
        await audit.log({
          userId: user.id,
          action: "video.scene_update",
          objectType: "VideoScene",
          objectId: scene.id,
          summary: body.reset ? "Scene reset for regeneration" : "Scene prompt edited",
        });
      }
    }

    // Scene reorder
    if (Array.isArray(body.scenes)) {
      const orderPairs = (body.scenes as { id: string; order: number }[]).slice(0, 12);
      await db.$transaction(
        orderPairs.map((s) =>
          db.videoScene.updateMany({
            where: { id: String(s.id), projectId: project.id },
            data: { order: Number(s.order) || 0 },
          })
        )
      );
    }

    // Project-level fields
    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = String(body.title).slice(0, 200);
    if (body.script !== undefined) data.script = String(body.script).slice(0, 8000);
    if (body.characterBible !== undefined) data.characterBibleJson = JSON.stringify(body.characterBible ?? {});
    if (body.styleBible !== undefined) data.styleBibleJson = JSON.stringify(body.styleBible ?? {});
    if (Object.keys(data).length) {
      await db.videoProject.update({ where: { id: project.id }, data: data as never });
      await audit.log({ userId: user.id, action: "video.project_update", objectType: "VideoProject", objectId: project.id });
    }

    const full = await db.videoProject.findUnique({
      where: { id: project.id },
      include: { scenes: { orderBy: { order: "asc" } } },
    });
    return ok(full);
  });
}
