import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, parseJson } from "@/lib/api";
import { jobs } from "@/lib/jobs";
import { audit } from "@/lib/ledger";
import { llmCompleteJson } from "@/lib/ai/zai";

const LANG_NAME: Record<string, string> = { hy: "Armenian (Հայերեն)", ru: "Russian (Русский)", en: "English" };
const PLATFORMS = ["instagram", "tiktok", "facebook", "telegram"];
const TYPES = ["IMAGE_POST", "VIDEO_REEL", "STORY", "CAROUSEL", "POST"];

type Params = { params: Promise<{ id: string }> };

interface BatchCheckpoint {
  next: number;
  created: { itemIndex: number; id: string; title: string; aiWritten: boolean }[];
}

interface BatchInput {
  planId: string;
  indexes: number[];
  language: "hy" | "ru" | "en";
}

// POST /api/plans/content/batch-jobs/[id]/step — advance a CONTENT_BATCH job by ONE item.
// Each call is a bounded request (~one LLM completion), the durable checkpoint lives in
// GenerationJob.checkpointJson, so the batch survives page reloads and tab closes.
// Honest degradation: a provider failure on one item still produces that item's draft
// (from plan data, without AI copy) and the job keeps going.
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const job = await jobs.getForUser(id, user.id);
    if (job.kind !== "CONTENT_BATCH") throw new ApiError(400, "BAD_KIND", "Not a batch job");

    // claim token: each driver (planner loop, background chip, another tab) proves
    // ownership on EVERY step — the same token renews the claim, a different token
    // within the freshness window gets BUSY, and a crashed driver's claim expires
    // after 60s so the queue can never wedge
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token.slice(0, 64) : "";
    if (!token) throw new ApiError(400, "NO_CLAIM_TOKEN", "claim token required");

    const input = parseJson<BatchInput>(job.inputJson, { planId: "", indexes: [], language: "hy" });
    const total = input.indexes.length;
    const done = (json: string | null): BatchCheckpoint => {
      const cp = parseJson<BatchCheckpoint>(json, { next: 0, created: [] });
      return {
        next: typeof cp.next === "number" ? cp.next : 0,
        created: Array.isArray(cp.created) ? cp.created : [],
      };
    };

    const TERMINAL = ["COMPLETED", "CANCELLED", "FAILED", "NEEDS_USER_ACTION"];
    if (TERMINAL.includes(job.status)) {
      return ok({ status: job.status, done: cpDone(job.checkpointJson), total });
    }

    // claim guard: only ONE driver may step the job at a time — the same token renews
    // its own claim; a different token inside the 60s freshness window gets BUSY
    const cur = await db.generationJob.findUnique({
      where: { id },
      select: { claimToken: true, claimAt: true },
    });
    const claimFresh = !!cur?.claimAt && cur.claimAt.getTime() > Date.now() - 60_000;
    if (claimFresh && cur?.claimToken && cur.claimToken !== token) {
      return ok({ status: "BUSY", done: cpDone(job.checkpointJson), total });
    }
    await db.generationJob.update({
      where: { id },
      data: { claimToken: token, claimAt: new Date() },
    });

    if (job.status === "QUEUED") await jobs.markProcessing(id);

    let cp = done(job.checkpointJson);
    if (cp.next >= total) {
      const finished = await jobs.markCompleted(id, { created: cp.created, done: cp.created.length, total });
      await audit.log({
        userId: user.id,
        actorType: "SYSTEM",
        action: "content.batch_job_completed",
        objectType: "GenerationJob",
        objectId: id,
        summary: `batch job finished: ${cp.created.length}/${total} drafts`,
      });
      return ok({ status: finished.status, done: cp.created.length, total });
    }

    // load plan + brand fresh — data may have changed since the job was queued
    const plan = await db.contentPlan.findUnique({ where: { id: input.planId } });
    if (!plan) {
      await jobs.markFailed(id, "plan deleted while job was running", { needsUserAction: true });
      return ok({ status: "NEEDS_USER_ACTION", done: cpDone(job.checkpointJson), total });
    }
    const brand = await db.brand.findUnique({ where: { id: plan.brandId }, include: { profile: true } });
    if (!brand || brand.userId !== user.id) {
      await jobs.markFailed(id, "brand not found", { needsUserAction: true });
      return ok({ status: "NEEDS_USER_ACTION", done: cpDone(job.checkpointJson), total });
    }

    const items = parseJson<Record<string, unknown>[]>(plan.itemsJson, []);
    const idx = input.indexes[cp.next];
    if (idx == null || idx < 0 || idx >= items.length) {
      // skip a broken index honestly — advance the checkpoint, no silent stall
      cp = { next: cp.next + 1, created: [...cp.created, { itemIndex: idx ?? -1, id: "", title: "", aiWritten: false }] };
      await db.generationJob.update({
        where: { id },
        data: { checkpointJson: JSON.stringify(cp), outputJson: JSON.stringify({ done: cp.next, total }) },
      });
      return ok({ status: "PROCESSING", done: cp.next, total });
    }

    const item = items[idx];
    let hook = item.hook ? String(item.hook) : null;
    let caption: string | null = null;
    let script: string | null = null;
    let hashtags: string | null = null;
    let aiWritten = false;

    // cancel guard AFTER the expensive call: the in-flight item finishes, remaining ones stop
    const fresh = await db.generationJob.findUnique({ where: { id }, select: { status: true } });
    if (fresh && TERMINAL.includes(fresh.status)) {
      return ok({ status: fresh.status, done: cp.next, total });
    }

    const langName = LANG_NAME[input.language] ?? "Armenian (Հայերեն)";
    const system = `You are a platform-native copywriter. Write EXCLUSIVELY in ${langName}.
ALL output fields (hook, caption, script, hashtags) MUST be 100% in ${langName}. Do NOT use any other language anywhere.
Ground claims ONLY in the brand data. NEVER invent prices, discounts, certificates, clients, reviews, awards, guarantees, medical results, statistics.
Respect platform norms: caption length, hook in first 2 seconds.`;
    const contentTypeOf = (v: unknown) => (TYPES.includes(String(v)) ? String(v) : "IMAGE_POST");
    const platformOf = (v: unknown) => (PLATFORMS.includes(String(v)) ? String(v) : "instagram");
    const platform = platformOf(item.platform);
    const prompt = `BRAND: ${brand.name}
Positioning: ${brand.profile?.positioning ?? ""}
Tone: ${brand.profile?.tone ?? ""}
Summary: ${brand.profile?.summary ?? ""}
Forbidden claims: ${brand.profile?.forbiddenClaims ?? "[]"}
CONTENT TYPE: ${contentTypeOf(item.contentType)}
PLATFORM: ${platform}
PLAN ITEM:
Title: ${String(item.title ?? "")}
Topic: ${String(item.topic ?? "")}
Planned hook (may be a raw idea): ${String(item.hook ?? "")}
Pillar: ${String(item.pillar ?? "")} | Goal: ${String(item.goal ?? "")}

Return JSON: {"hook": str, "caption": str, "script": str (only for video types, else empty), "hashtags": [str]}`;
    try {
      const copy = await llmCompleteJson<{ hook: string; caption: string; script: string; hashtags: string[] }>({ system, prompt });
      hook = copy.hook || hook;
      caption = copy.caption || null;
      script = copy.script || null;
      hashtags = (copy.hashtags ?? []).join(" ") || null;
      aiWritten = true;
    } catch {
      // honest degradation: draft from plan data without AI copy
      caption = null;
    }

    const contentItem = await db.contentItem.create({
      data: {
        userId: user.id,
        brandId: plan.brandId,
        contentPlanId: plan.id,
        title: String(item.title ?? `Plan item #${idx + 1}`).slice(0, 200),
        platform,
        language: input.language,
        contentType: contentTypeOf(item.contentType),
        hook: hook ? hook.slice(0, 2000) : null,
        caption: caption ? caption.slice(0, 5000) : null,
        script: script ? script.slice(0, 8000) : null,
        hashtags: hashtags ? hashtags.slice(0, 500) : null,
        metaJson: JSON.stringify({ goal: item.goal ?? null, pillar: item.pillar ?? null, topic: item.topic ?? null, itemIndex: idx }),
        approvalState: "DRAFT",
      },
    });

    cp = { next: cp.next + 1, created: [...cp.created, { itemIndex: idx, id: contentItem.id, title: contentItem.title, aiWritten }] };
    await db.generationJob.update({
      where: { id },
      data: { checkpointJson: JSON.stringify(cp), outputJson: JSON.stringify({ done: cp.next, total }) },
    });

    const finishedNow = cp.next >= total;
    if (finishedNow) {
      await jobs.markCompleted(id, { created: cp.created, done: cp.next, total });
      await audit.log({
        userId: user.id,
        actorType: "SYSTEM",
        action: "content.batch_job_completed",
        objectType: "GenerationJob",
        objectId: id,
        summary: `batch job finished: ${cp.created.length}/${total} drafts (ai-written: ${cp.created.filter((c) => c.aiWritten).length})`,
      });
      return ok({ status: "COMPLETED", done: cp.next, total });
    }
    return ok({ status: "PROCESSING", done: cp.next, total });
  });
}

function cpDone(checkpointJson: string | null): number {
  return parseJson<{ next?: number }>(checkpointJson, {}).next ?? 0;
}
