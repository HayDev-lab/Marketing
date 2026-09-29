import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, parseJson } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { llmCompleteJson } from "@/lib/ai/zai";

// GET /api/content?brandId=&state=
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const brandId = url.searchParams.get("brandId");
    const state = url.searchParams.get("state");
    const items = await db.contentItem.findMany({
      where: { userId: user.id, ...(brandId ? { brandId } : {}), ...(state ? { approvalState: state } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return ok(items);
  });
}

// POST /api/content — create + optional AI copywriting (caption/hook/script from Brand Memory)
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const brand = await db.brand.findUnique({ where: { id: String(body.brandId) }, include: { profile: true } });
    if (!brand || brand.userId !== user.id) throw new ApiError(404, "BRAND_NOT_FOUND", "Brand not found");
    const platform = ["instagram", "tiktok", "facebook", "telegram"].includes(body.platform) ? body.platform : "instagram";
    const language = ["hy", "ru", "en"].includes(body.language) ? body.language : "hy";
    const contentType = ["IMAGE_POST", "VIDEO_REEL", "STORY", "CAROUSEL", "POST"].includes(body.contentType) ? body.contentType : "IMAGE_POST";

    let hook = body.hook ?? null;
    let caption = body.caption ?? null;
    let script = body.script ?? null;
    let hashtags = body.hashtags ?? null;

    const LANG_NAME: Record<string, string> = { hy: "Armenian (Հայերեն)", ru: "Russian (Русский)", en: "English" };

    if (body.aiWrite) {
      const langName = LANG_NAME[language] ?? "Armenian (Հայերեն)";
      const system = `You are a platform-native copywriter for ${platform}. Write EXCLUSIVELY in ${langName}.
ALL output fields (hook, caption, script, hashtags) MUST be 100% in ${langName}. Do NOT use any other language anywhere.
Ground claims ONLY in the brand data. NEVER invent prices, discounts, certificates, clients, reviews, awards, guarantees, medical results, statistics.
Respect platform norms: caption length, hook in first 2 seconds.`;
      const prompt = `BRAND: ${brand.name}
Positioning: ${brand.profile?.positioning ?? ""}
Tone: ${brand.profile?.tone ?? ""}
Summary: ${brand.profile?.summary ?? ""}
Forbidden claims: ${brand.profile?.forbiddenClaims ?? "[]"}
CONTENT TYPE: ${contentType}
TOPIC/BRIEF: ${String(body.brief ?? body.title ?? brand.name).slice(0, 800)}
${body.linkTrend ? `TREND ADAPTATION SOURCE: ${body.linkTrend}` : ""}
Return JSON: {"hook": str, "caption": str, "script": str (only for video types, else empty), "hashtags": [str]}`;

      const copy = await llmCompleteJson<{ hook: string; caption: string; script: string; hashtags: string[] }>({ system, prompt });
      hook = copy.hook || hook;
      caption = copy.caption || caption;
      script = copy.script || script;
      hashtags = (copy.hashtags ?? []).join(" ") || hashtags;
    }

    const item = await db.contentItem.create({
      data: {
        userId: user.id,
        brandId: brand.id,
        contentPlanId: body.contentPlanId ?? null,
        trendId: body.trendId ?? null,
        title: String(body.title ?? "Untitled").slice(0, 200),
        platform,
        language,
        contentType,
        hook: hook ? String(hook).slice(0, 2000) : null,
        caption: caption ? String(caption).slice(0, 5000) : null,
        script: script ? String(script).slice(0, 8000) : null,
        hashtags: hashtags ? String(hashtags).slice(0, 500) : null,
        approvalState: "DRAFT",
        metaJson: body.meta ? JSON.stringify(body.meta) : null,
      },
    });
    await audit.log({ userId: user.id, action: "content.create", objectType: "ContentItem", objectId: item.id, summary: item.title });
    return ok(item, 201);
  });
}
