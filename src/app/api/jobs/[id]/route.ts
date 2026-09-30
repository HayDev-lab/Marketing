import { NextRequest } from "next/server";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { jobs } from "@/lib/jobs";
import { kickAssembly } from "@/lib/video/assemble";

type Params = { params: Promise<{ id: string }> };

// GET /api/jobs/[id] — status with provider reconciliation (video: ask provider first)
export async function GET(_req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    let job = await jobs.getForUser(id, user.id);
    if (job.kind === "VIDEO" && job.providerJobId && ["WAITING_PROVIDER", "PROCESSING", "RETRYING"].includes(job.status)) {
      const reconciled = await jobs.reconcileVideo(id, user.id);
      if (!reconciled) throw new ApiError(500, "RECONCILE_FAILED", "Reconciliation failed");
      job = reconciled;
      // reconcile may complete the scene — sync scene status
      if (job.status === "COMPLETED") {
        const scene = await dbSceneByJob(id);
        if (scene && !scene.assetId) {
          await updateScene(scene.id, {
            status: "COMPLETED",
            assetId: job.resultAssetId,
            cost: job.cost,
          });
        }
      } else if (job.status === "FAILED") {
        const scene = await dbSceneByJob(id);
        if (scene) await updateScene(scene.id, { status: "FAILED", error: job.error ?? "provider failed" });
      }
    }
    return ok(job);
  });
}

// POST /api/jobs/[id] — action: resume | cancel
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const body = await req.json();
    if (body.action === "resume") {
      const existing = await jobs.getForUser(id, user.id);
      const job = await jobs.resume(id, user.id);
      // ASSEMBLE jobs run locally — resume re-kicks the ffmpeg runner (durable, recoverable).
      if (existing.kind === "ASSEMBLE" && job && ["QUEUED", "RETRYING", "PROCESSING"].includes(job.status)) {
        kickAssembly(job.id);
      }
      return ok(job);
    }
    if (body.action === "cancel") {
      const job = await jobs.cancel(id, user.id);
      const scene = await dbSceneByJob(id);
      if (scene) await updateScene(scene.id, { status: "FAILED", error: "cancelled by user" });
      return ok(job);
    }
    throw new ApiError(400, "BAD_ACTION", "Unknown action");
  });
}

// small helpers to avoid circular import with prisma include paths
async function dbSceneByJob(jobId: string) {
  const { db } = await import("@/lib/db");
  return db.videoScene.findFirst({ where: { jobId } });
}
async function updateScene(id: string, data: Record<string, unknown>) {
  const { db } = await import("@/lib/db");
  return db.videoScene.update({ where: { id }, data: data as never });
}
