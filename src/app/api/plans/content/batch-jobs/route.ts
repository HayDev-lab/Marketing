import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, parseJson } from "@/lib/api";
import { jobs } from "@/lib/jobs";
import { audit } from "@/lib/ledger";

// POST /api/plans/content/batch-jobs — create a durable background job that
// generates AI drafts for several plan items. Unlike the synchronous
// /api/plans/content/batch call, the work is checkpointed in GenerationJob
// and advanced step-by-step by the client (POST .../batch-jobs/[id]/step),
// so progress survives page reloads and the job is visible in the job feed.
// Body: { planId: string, indexes?: number[], language?: "hy"|"ru"|"en" }
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const plan = await db.contentPlan.findUnique({ where: { id: String(body.planId) } });
    if (!plan) throw new ApiError(404, "NOT_FOUND", "Plan not found");
    const brand = await db.brand.findUnique({ where: { id: plan.brandId } });
    if (!brand || brand.userId !== user.id) throw new ApiError(404, "BRAND_NOT_FOUND", "Brand not found");

    const items = parseJson<Record<string, unknown>[]>(plan.itemsJson, []);
    if (items.length === 0) throw new ApiError(400, "VALIDATION", "Plan has no items");

    const rawIndexes: unknown[] = Array.isArray(body.indexes) ? body.indexes : items.map((_, i) => i);
    const indexes = [...new Set(
      rawIndexes
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < items.length)
    )].sort((a, b) => a - b) as number[];
    // a background job is not bound by the sync per-call cap, but stays honest about its size
    if (indexes.length === 0) throw new ApiError(400, "VALIDATION", "indexes required");
    if (indexes.length > 30) throw new ApiError(400, "VALIDATION", "max 30 items per background job");

    const language = ["hy", "ru", "en"].includes(body.language) ? body.language : "hy";

    const { job } = await jobs.create({
      userId: user.id,
      kind: "CONTENT_BATCH",
      provider: "zai-llm",
      brandId: plan.brandId,
      input: { planId: plan.id, indexes, language },
      checkpointJson: { next: 0, created: [] },
      maxAttempts: 1,
    });

    await audit.log({
      userId: user.id,
      action: "content.batch_job_create",
      objectType: "GenerationJob",
      objectId: job.id,
      summary: `batch job for plan ${plan.id}: ${indexes.length} items (lang ${language})`,
    });
    return ok({ job }, 201);
  });
}
