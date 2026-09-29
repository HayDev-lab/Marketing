import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, assertBrandOwnership, parseJson } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { llmCompleteJson } from "@/lib/ai/zai";

interface PlanSections {
  objectives: string[];
  content_pillars: { name: string; share_pct: number; description: string }[];
  channel_strategy: { platform: string; role: string; cadence_per_week: number }[];
  funnel: { stage: string; content_types: string[] }[];
  weekly_plan: { day: string; platform: string; pillar: string; format: string; topic: string }[];
  monthly_focus: string[];
  cadence: string;
  kpis: { name: string; target: string }[];
  experiments: string[];
  campaign_ideas: { name: string; concept: string; platform: string }[];
}

const SECTION_KEYS = ["objectives", "pillars", "channels", "funnel", "weekly", "monthly", "cadence", "kpis", "experiments", "campaigns"] as const;

// GET /api/plans/marketing?brandId=
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const brandId = new URL(req.url).searchParams.get("brandId");
    if (!brandId) throw new ApiError(400, "VALIDATION", "brandId required");
    await assertBrandOwnership(brandId, user.id);
    const plans = await db.marketingPlan.findMany({ where: { brandId }, orderBy: { createdAt: "desc" } });
    return ok(plans);
  });
}

// POST /api/plans/marketing — Marketing Planner: generate full plan from Brand Memory
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const brand = await assertBrandOwnership(String(body.brandId), user.id);
    const profile = await db.brandProfile.findUnique({ where: { brandId: brand.id } });
    const facts = await db.businessFact.findMany({ where: { brandId: brand.id }, take: 30, orderBy: { createdAt: "desc" } });
    const insights = await db.learningInsight.findMany({ where: { brandId: brand.id }, take: 10, orderBy: { createdAt: "desc" } });

    const system = `You are a senior marketing strategist. Build a realistic marketing plan grounded ONLY in the brand intelligence provided.
Distinguish clearly: brand facts (trusted) vs your strategic inference. Do not invent prices/reviews/awards.
Respond with valid JSON only.`;

    const prompt = `BRAND: ${brand.name}
Website: ${brand.website ?? "none"}
Description: ${brand.description ?? "none"}
Brand Profile: ${JSON.stringify({
      summary: profile?.summary,
      positioning: profile?.positioning,
      tone: profile?.tone,
      audiences: parseJson<unknown[]>(profile?.targetAudiences, []),
      opportunities: parseJson<unknown[]>(profile?.opportunities, []),
    })}
Recent facts: ${JSON.stringify(facts.map((f) => ({ k: f.kind, c: f.content })))}
Prior learning insights: ${JSON.stringify(insights.map((i) => i.observation))}

Build the plan. Return JSON:
{"objectives":[str],"content_pillars":[{"name":str,"share_pct":num,"description":str}],"channel_strategy":[{"platform":"instagram|tiktok|facebook|telegram","role":str,"cadence_per_week":num}],"funnel":[{"stage":"awareness|consideration|conversion|retention","content_types":[str]}],"weekly_plan":[{"day":"Mon..Sun","platform":str,"pillar":str,"format":str,"topic":str}],"monthly_focus":[str],"cadence":str,"kpis":[{"name":str,"target":str}],"experiments":[str],"campaign_ideas":[{"name":str,"concept":str,"platform":str}]}`;

    const plan = await llmCompleteJson<PlanSections>({ system, prompt });
    const created = await db.marketingPlan.create({
      data: {
        brandId: brand.id,
        version: 1,
        objectivesJson: JSON.stringify(plan.objectives ?? []),
        pillarsJson: JSON.stringify(plan.content_pillars ?? []),
        channelsJson: JSON.stringify(plan.channel_strategy ?? []),
        funnelJson: JSON.stringify(plan.funnel ?? []),
        weeklyJson: JSON.stringify(plan.weekly_plan ?? []),
        monthlyJson: JSON.stringify(plan.monthly_focus ?? []),
        cadence: plan.cadence ?? null,
        kpisJson: JSON.stringify(plan.kpis ?? []),
        experimentsJson: JSON.stringify(plan.experiments ?? []),
        campaignIdeasJson: JSON.stringify(plan.campaign_ideas ?? []),
        lockedSections: "[]",
      },
    });
    await audit.log({ userId: user.id, action: "plan.generate", objectType: "MarketingPlan", objectId: created.id, summary: `Marketing plan generated for ${brand.name}` });
    return ok(created, 201);
  });
}

// PATCH /api/plans/marketing — edit sections / lock / approve
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const plan = await db.marketingPlan.findUnique({ where: { id: String(body.id) } });
    if (!plan) throw new ApiError(404, "NOT_FOUND", "Plan not found");
    await assertBrandOwnership(plan.brandId, user.id);

    const data: Record<string, unknown> = {};
    const sectionMap: Record<string, string> = {
      objectives: "objectivesJson",
      pillars: "pillarsJson",
      channels: "channelsJson",
      funnel: "funnelJson",
      weekly: "weeklyJson",
      monthly: "monthlyJson",
      kpis: "kpisJson",
      experiments: "experimentsJson",
      campaigns: "campaignIdeasJson",
    };
    if (body.section && sectionMap[body.section] && body.value !== undefined) {
      const locked = parseJson<string[]>(plan.lockedSections, []);
      if (locked.includes(body.section)) throw new ApiError(423, "SECTION_LOCKED", "Section is locked — unlock to edit");
      data[sectionMap[body.section]] = JSON.stringify(body.value);
      data.version = plan.version + 1;
    }
    if (body.lockSection) {
      const locked = parseJson<string[]>(plan.lockedSections, []);
      if (!SECTION_KEYS.includes(body.lockSection)) throw new ApiError(400, "VALIDATION", "Bad section key");
      data.lockedSections = JSON.stringify(locked.filter((s) => s !== body.lockSection).concat(body.lockSection));
    }
    if (body.unlockSection) {
      const locked = parseJson<string[]>(plan.lockedSections, []);
      data.lockedSections = JSON.stringify(locked.filter((s) => s !== body.unlockSection));
    }
    if (body.status && ["DRAFT", "APPROVED"].includes(body.status)) data.status = body.status;
    const updated = await db.marketingPlan.update({ where: { id: plan.id }, data });
    await audit.log({ userId: user.id, action: "plan.update", objectType: "MarketingPlan", objectId: plan.id, summary: body.section ? `Section ${body.section} updated` : "Plan updated" });
    return ok(updated);
  });
}
