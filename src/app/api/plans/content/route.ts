import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, assertBrandOwnership, parseJson } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { llmCompleteJson } from "@/lib/ai/zai";

// GET /api/plans/content?brandId=
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const brandId = new URL(req.url).searchParams.get("brandId");
    if (!brandId) throw new ApiError(400, "VALIDATION", "brandId required");
    await assertBrandOwnership(brandId, user.id);
    const plans = await db.contentPlan.findMany({
      where: { brandId },
      orderBy: { createdAt: "desc" },
      include: { contentItems: { select: { id: true, title: true, approvalState: true, platform: true } } },
    });
    return ok(plans);
  });
}

// POST /api/plans/content — generate a week content plan from marketing plan + trends
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const brand = await assertBrandOwnership(String(body.brandId), user.id);
    const marketingPlan = body.marketingPlanId
      ? await db.marketingPlan.findUnique({ where: { id: String(body.marketingPlanId) } })
      : (await db.marketingPlan.findMany({ where: { brandId: brand.id }, orderBy: { createdAt: "desc" } }))[0];
    const trends = await db.trend.findMany({ where: { brandId: brand.id }, orderBy: { createdAt: "desc" }, take: 5 });
    const language = body.language ?? "hy";

    const system = `You are a content planner. Create a 7-day content plan grounded in the brand plan and real trends.
Platform rules matter: instagram/tiktok prefer 9:16 short video; telegram prefers text+image.
Never invent facts/prices. Respond with valid JSON only.`;

    const prompt = `BRAND: ${brand.name}; tone: ${brand.description ?? ""}; language: ${language}
MARKETING PLAN: ${JSON.stringify({
      pillars: parseJson<unknown[]>(marketingPlan?.pillarsJson, []),
      channels: parseJson<unknown[]>(marketingPlan?.channelsJson, []),
      weekly: parseJson<unknown[]>(marketingPlan?.weeklyJson, []),
    })}
TREND OPPORTUNITIES: ${JSON.stringify(trends.map((t) => ({ title: t.title, platform: t.platform, adaptation: t.suggestedAdaptation, hook: t.hook })))}

Return JSON: {"title": str, "items": [{"title": str, "platform": "instagram|tiktok|facebook|telegram", "contentType": "VIDEO_REEL|IMAGE_POST|STORY|CAROUSEL|POST", "day": 1..7, "hook": str, "topic": str, "pillar": str, "linkedTrendIndex": int|null, "goal": str}]}`;

    const plan = await llmCompleteJson<{ title: string; items: unknown[] }>({ system, prompt });
    const created = await db.contentPlan.create({
      data: {
        brandId: brand.id,
        marketingPlanId: marketingPlan?.id,
        title: plan.title ?? `Content plan ${new Date().toLocaleDateString()}`,
        itemsJson: JSON.stringify(plan.items ?? []),
        status: "DRAFT",
      },
    });
    await audit.log({ userId: user.id, action: "contentplan.generate", objectType: "ContentPlan", objectId: created.id });
    return ok(created, 201);
  });
}

// PATCH /api/plans/content — convert plan item into a ContentItem (draft)
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const plan = await db.contentPlan.findUnique({ where: { id: String(body.id) } });
    if (!plan) throw new ApiError(404, "NOT_FOUND", "Plan not found");
    await assertBrandOwnership(plan.brandId, user.id);
    const itemIndex = Number(body.itemIndex);
    const items = parseJson<Record<string, unknown>[]>(plan.itemsJson, []);
    const item = items[itemIndex];
    if (!item) throw new ApiError(404, "NOT_FOUND", "Plan item not found");
    const contentItem = await db.contentItem.create({
      data: {
        userId: user.id,
        brandId: plan.brandId,
        contentPlanId: plan.id,
        title: String(item.title ?? "Content item").slice(0, 200),
        platform: String(item.platform ?? "instagram"),
        language: "hy",
        contentType: String(item.contentType ?? "IMAGE_POST"),
        hook: item.hook ? String(item.hook).slice(0, 500) : null,
        metaJson: JSON.stringify({ goal: item.goal, pillar: item.pillar, topic: item.topic }),
        approvalState: "DRAFT",
      },
    });
    await audit.log({ userId: user.id, action: "content.create_from_plan", objectType: "ContentItem", objectId: contentItem.id });
    return ok(contentItem, 201);
  });
}
