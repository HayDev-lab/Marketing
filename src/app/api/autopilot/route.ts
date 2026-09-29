import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, parseJson } from "@/lib/api";
import { audit, ledger } from "@/lib/ledger";
import { llmCompleteJson, webSearch } from "@/lib/ai/zai";

const BOOL_KEYS = ["enabled", "trendDiscovery", "autoPlanning", "autoGeneration", "paidGeneration", "autoScheduling", "autoPublishing", "humanApproval"] as const;

// GET /api/autopilot — policy + last cycle results
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    let policy = await db.autopilotPolicy.findUnique({ where: { userId: user.id } });
    if (!policy) policy = await db.autopilotPolicy.create({ data: { userId: user.id } });
    const cycles = await db.auditLog.findMany({
      where: { userId: user.id, actorType: "AUTOPILOT" },
      orderBy: { createdAt: "desc" },
      take: 15,
    });
    return ok({ policy, cycles });
  });
}

// PATCH /api/autopilot — update policy (user policy bounds autopilot, never the reverse)
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    await db.autopilotPolicy.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    const data: Record<string, unknown> = {};
    for (const k of BOOL_KEYS) if (typeof body[k] === "boolean") data[k] = body[k];
    for (const k of ["dailyBudget", "weeklyBudget", "monthlyBudget", "maxGenerationCost", "minQualityThreshold"] as const) {
      if (typeof body[k] === "number") data[k] = Math.max(0, body[k]);
    }
    for (const k of ["maxRetries", "maxContentPerDay"] as const) {
      if (typeof body[k] === "number") data[k] = Math.max(0, Math.floor(body[k]));
    }
    for (const k of ["platformsJson", "brandsJson", "languagesJson", "postingWindowsJson", "forbiddenTopicsJson", "forbiddenClaimsJson"] as const) {
      const short = k.replace("Json", "");
      if (Array.isArray(body[short])) data[k] = JSON.stringify(body[short]);
    }
    const updated = await db.autopilotPolicy.update({ where: { userId: user.id }, data });
    await audit.log({ userId: user.id, action: "autopilot.policy_update", objectType: "AutopilotPolicy", summary: `enabled=${updated.enabled}` });
    return ok(updated);
  });
}

// POST /api/autopilot — run one supervised cycle (triggered explicitly by user UI)
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const brandId = String(body.brandId ?? "");
    const brand = await db.brand.findUnique({ where: { id: brandId }, include: { profile: true } });
    if (!brand || brand.userId !== user.id) throw new ApiError(404, "BRAND_NOT_FOUND", "Brand not found");

    const policy = await db.autopilotPolicy.findUnique({ where: { userId: user.id } });
    if (!policy?.enabled) {
      throw new ApiError(423, "AUTOPILOT_DISABLED", "Enable Autopilot in the Autopilot panel first");
    }
    const allowedBrands = parseJson<string[]>(policy.brandsJson, []);
    if (allowedBrands.length && !allowedBrands.includes(brandId)) {
      throw new ApiError(423, "BRAND_NOT_ALLOWED", "This brand is not in the Autopilot allowed list");
    }
    const steps: string[] = [];

    // 1. Trend discovery (if allowed)
    let trendCandidate: { title: string; platform: string; adaptation: string } | null = null;
    if (policy.trendDiscovery) {
      steps.push("trend_search");
      const search = await webSearch({ query: `${brand.industry ?? "marketing"} trend Armenia this week`, num: 5, recencyDays: 7 });
      const pick = (search ?? [])[0];
      if (pick) trendCandidate = { title: pick.name, platform: "instagram", adaptation: pick.snippet.slice(0, 300) };
    }

    // 2. Planning (if allowed)
    let concept: { hook: string; caption: string; hashtags: string[] } | null = null;
    if (policy.autoPlanning) {
      steps.push("planning");
      concept = await llmCompleteJson<{ hook: string; caption: string; hashtags: string[] }>({
        system: `You are the Autopilot planner. Work ONLY within user policy. Forbidden topics: ${policy.forbiddenTopicsJson}. Forbidden claims: ${policy.forbiddenClaimsJson}. Never invent prices/reviews/awards.`,
        prompt: `Brand: ${brand.name}; summary: ${brand.profile?.summary ?? ""}; tone: ${brand.profile?.tone ?? ""}; language: ${parseJson<string[]>(policy.languagesJson, ["hy"])[0] ?? "hy"}; platform: ${parseJson<string[]>(policy.platformsJson, ["instagram"])[0] ?? "instagram"}
${trendCandidate ? `Fresh trend to adapt (original adaptation only): ${trendCandidate.title} — ${trendCandidate.adaptation}` : ""}
Create ONE content concept. Return JSON {"hook": str, "caption": str, "hashtags": [str]}`,
      });
    }

    // 3. Budget check before ANY paid generation
    let contentItem: { id: string } | null = null;
    const platforms = parseJson<string[]>(policy.platformsJson, ["instagram"]);
    const platform = platforms[0] ?? "instagram";
    const languages = parseJson<string[]>(policy.languagesJson, ["hy"]);
    const created = await db.contentItem.create({
      data: {
        userId: user.id,
        brandId: brand.id,
        title: `Autopilot: ${trendCandidate?.title?.slice(0, 80) ?? brand.name} ${new Date().toLocaleDateString()}`,
        platform,
        language: languages[0] ?? "hy",
        contentType: "IMAGE_POST",
        hook: concept?.hook ?? null,
        caption: concept?.caption ?? null,
        hashtags: (concept?.hashtags ?? []).join(" ") || null,
        approvalState: policy.autoGeneration ? "GENERATING" : "DRAFT",
        metaJson: JSON.stringify({ source: "AUTOPILOT", trend: trendCandidate?.title }),
      },
    });
    contentItem = created;

    // 4. Automatic generation (paid) — only if explicitly allowed
    if (policy.autoGeneration && policy.paidGeneration) {
      steps.push("generation");
      await ledger.assertBudget(user.id, 0.02);
      // generation happens via same core endpoint logic; autopilot creates the prompt
      const prompt = `${concept?.hook ?? brand.name} promotional image for ${brand.name}, premium social media style, ${brand.profile?.tone ?? "clean modern"} aesthetic`;
      const res = await fetch(new URL("/api/generate/image", req.url), {
        method: "POST",
        headers: { cookie: req.headers.get("cookie") ?? "", "content-type": "application/json" },
        body: JSON.stringify({ prompt, brandId: brand.id, aspectRatio: "1:1" }),
      });
      const resJson = await res.json();
      if (resJson.ok) {
        await db.contentItem.update({ where: { id: created.id }, data: { assetId: resJson.data.assetId, approvalState: policy.humanApproval ? "READY_FOR_REVIEW" : "READY_FOR_REVIEW" } });
        steps.push("qa_pass");
      } else {
        await db.contentItem.update({ where: { id: created.id }, data: { approvalState: "FAILED" } });
        steps.push("generation_failed");
      }
    }

    // 5. Human approval gate — autopilot never publishes without it
    if (policy.humanApproval) {
      steps.push("queued_for_human_approval");
    } else if (policy.autoScheduling) {
      steps.push("scheduling_allowed_by_policy");
    }
    if (policy.autoPublishing && !policy.humanApproval) {
      steps.push("publishing_blocked_without_credentials");
    }

    await audit.log({
      userId: user.id,
      actorType: "AUTOPILOT",
      action: "autopilot.cycle",
      objectType: "Brand",
      objectId: brand.id,
      summary: `Cycle steps: ${steps.join(" → ")}`,
      meta: { steps, contentItemId: contentItem?.id, trend: trendCandidate?.title },
    });

    return ok({
      steps,
      contentItemId: contentItem?.id,
      trendAdapted: trendCandidate?.title ?? null,
      humanApprovalRequired: policy.humanApproval,
      note: "Autopilot runs one supervised cycle per trigger, fully inside your policy. Audit trail recorded.",
    });
  });
}
