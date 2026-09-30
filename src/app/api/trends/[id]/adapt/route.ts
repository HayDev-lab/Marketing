import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { adaptTrendToBusiness } from "@/lib/trends/adapt";

type Params = { params: Promise<{ id: string }> };

// POST /api/trends/[id]/adapt — structured "Adapt to my business" analysis:
// trend + business profile + tone + audience + products + platform + language
// + objective → structured adaptation + provider-compiled generation prompt.
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const language = ["hy", "ru", "en"].includes(body.language) ? body.language : "hy";
    const brandId = body.brandId ? String(body.brandId) : null;

    // Prompt Library hook: optional template as stylistic base
    let templateBody: string | null = null;
    const templateId = body.templateId ? String(body.templateId) : null;
    if (templateId) {
      const tpl = await db.promptTemplate.findUnique({ where: { id: templateId } });
      if (!tpl || (tpl.userId && tpl.userId !== user.id)) throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Template not found");
      templateBody = tpl.body;
    }

    try {
      const result = await adaptTrendToBusiness({
        trendId: id,
        userId: user.id,
        brandId,
        language,
        platform: body.platform ? String(body.platform) : undefined,
        contentType: body.contentType ? String(body.contentType) : undefined,
        objective: body.objective ? String(body.objective) : undefined,
        templateBody,
        templateId,
      });
      await audit.log({
        userId: user.id,
        action: "trend.adapt_structured",
        objectType: "TrendAdaptation",
        objectId: result.adaptationId,
        summary: `Adapted trend to business (${result.structured.contentType}/${result.structured.recommendedPlatform})`,
      });
      const row = await db.trendAdaptation.findUnique({ where: { id: result.adaptationId } });
      return ok({ adaptation: row, structured: result.structured });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Adaptation failed";
      if (message === "Trend not found") throw new ApiError(404, "TREND_NOT_FOUND", message);
      if (message === "Brand not found") throw new ApiError(404, "BRAND_NOT_FOUND", message);
      throw new ApiError(500, "ADAPT_FAILED", message);
    }
  });
}
