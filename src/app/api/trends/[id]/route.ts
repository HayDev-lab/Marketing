import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, parseJson } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { llmCompleteJson } from "@/lib/ai/zai";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/trends/[id] — action: "adapt" (concept + hook + script) or edit fields
export async function PATCH(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const body = await req.json();
    const trend = await db.trend.findUnique({ where: { id } });
    if (!trend || trend.userId !== user.id) throw new ApiError(404, "TREND_NOT_FOUND", "Trend not found");

    if (body.action === "adapt") {
      const brand = trend.brandId
        ? await db.brand.findUnique({ where: { id: trend.brandId }, include: { profile: true } })
        : null;
      const language = body.language ?? trend.language ?? "hy";
      const system = `You are a senior creative director. Create an ORIGINAL adaptation of a trend for a brand.
NEVER copy the source video/post 1:1. Extract mechanics, pacing, hook structure, storytelling pattern, visual grammar — then produce original creative.
Forbidden claims (never use): invented prices, discounts, certificates, clients, reviews, awards, guarantees, medical results, statistics.`;
      const prompt = `TREND: ${trend.title}
Summary: ${trend.summary ?? ""}
Suggested adaptation direction: ${trend.suggestedAdaptation ?? ""}
BRAND: ${brand?.name ?? "the user's brand"}; positioning: ${brand?.profile?.positioning ?? "unknown"}; tone: ${brand?.profile?.tone ?? "unknown"}; products: ${brand?.profile?.summary ?? "unknown"}
LANGUAGE: write hook and script in ${language}
Return JSON: {"concept": str, "hook": str (first 2s, spoken in ${language}), "script": str (15-30s short-form script with scene beats, in ${language}), "risk": str}`;

      const result = await llmCompleteJson<{ concept: string; hook: string; script: string; risk: string }>({ system, prompt });
      const updated = await db.trend.update({
        where: { id },
        data: {
          concept: result.concept?.slice(0, 2000),
          hook: result.hook?.slice(0, 500),
          script: result.script?.slice(0, 4000),
          risk: result.risk?.slice(0, 500) ?? trend.risk,
        },
      });
      await audit.log({ userId: user.id, action: "trend.adapt", objectType: "Trend", objectId: id });
      return ok(updated);
    }

    // generic field edit
    const data: Record<string, unknown> = {};
    for (const k of ["concept", "hook", "script", "brandFitReason", "suggestedAdaptation", "risk", "summary"] as const) {
      if (body[k] !== undefined) data[k] = String(body[k]).slice(0, 4000);
    }
    if (body.status && ["VERIFIED_TREND", "POPULAR_TOPIC", "EMERGING_SIGNAL", "HYPOTHESIS"].includes(body.status)) data.status = body.status;
    const updated = await db.trend.update({ where: { id }, data });
    return ok(updated);
  });
}

// DELETE /api/trends/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const trend = await db.trend.findUnique({ where: { id } });
    if (!trend || trend.userId !== user.id) throw new ApiError(404, "TREND_NOT_FOUND", "Trend not found");
    await db.trend.delete({ where: { id } });
    return ok({ deleted: true });
  });
}
