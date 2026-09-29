import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, assertBrandOwnership, parseJson } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { llmCompleteJson } from "@/lib/ai/zai";

const LANG_NAME: Record<string, string> = { hy: "Armenian (Հայերեն)", ru: "Russian (Русский)", en: "English" };
const PLATFORMS = ["instagram", "tiktok", "facebook", "telegram"];
const TYPES = ["IMAGE_POST", "VIDEO_REEL", "STORY", "CAROUSEL", "POST"];

// POST /api/plans/content/batch — create drafts for several plan items at once.
// Body: { id: planId, indexes: number[], aiWrite?: boolean, language?: "hy"|"ru"|"en" }
// aiWrite=true runs the platform-native copywriter per item (grounded in brand profile).
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const plan = await db.contentPlan.findUnique({ where: { id: String(body.id) } });
    if (!plan) throw new ApiError(404, "NOT_FOUND", "Plan not found");
    const brand = await db.brand.findUnique({ where: { id: plan.brandId }, include: { profile: true } });
    if (!brand || brand.userId !== user.id) throw new ApiError(404, "BRAND_NOT_FOUND", "Brand not found");

    const items = parseJson<Record<string, unknown>[]>(plan.itemsJson, []);
    const rawIndexes: unknown[] = Array.isArray(body.indexes) ? body.indexes : [];
    const indexes = [...new Set(
      rawIndexes
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < items.length)
    )].slice(0, 10) as number[];
    if (indexes.length === 0) throw new ApiError(400, "VALIDATION", "indexes required (max 10 per call)");

    const aiWrite = Boolean(body.aiWrite);
    const language = ["hy", "ru", "en"].includes(body.language) ? body.language : "hy";
    const contentTypeOf = (v: unknown) => (TYPES.includes(String(v)) ? String(v) : "IMAGE_POST");
    const platformOf = (v: unknown) => (PLATFORMS.includes(String(v)) ? String(v) : "instagram");

    let system = "";
    if (aiWrite) {
      const langName = LANG_NAME[language] ?? "Armenian (Հայերեն)";
      system = `You are a platform-native copywriter. Write EXCLUSIVELY in ${langName}.
ALL output fields (hook, caption, script, hashtags) MUST be 100% in ${langName}. Do NOT use any other language anywhere.
Ground claims ONLY in the brand data. NEVER invent prices, discounts, certificates, clients, reviews, awards, guarantees, medical results, statistics.
Respect platform norms: caption length, hook in first 2 seconds.`;
    }

    const created: { itemIndex: number; id: string; title: string }[] = [];
    for (const idx of indexes) {
      const item = items[idx];
      let hook = item.hook ? String(item.hook) : null;
      let caption: string | null = null;
      let script: string | null = null;
      let hashtags: string | null = null;

      if (aiWrite) {
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
        } catch {
          // honest degradation: keep the plan-item draft without AI copy, mark meta
          caption = null;
        }
      }

      const contentItem = await db.contentItem.create({
        data: {
          userId: user.id,
          brandId: plan.brandId,
          contentPlanId: plan.id,
          title: String(item.title ?? `Plan item #${idx + 1}`).slice(0, 200),
          platform: platformOf(item.platform),
          language,
          contentType: contentTypeOf(item.contentType),
          hook: hook ? hook.slice(0, 2000) : null,
          caption: caption ? caption.slice(0, 5000) : null,
          script: script ? script.slice(0, 8000) : null,
          hashtags: hashtags ? hashtags.slice(0, 500) : null,
          metaJson: JSON.stringify({ goal: item.goal ?? null, pillar: item.pillar ?? null, topic: item.topic ?? null, itemIndex: idx }),
          approvalState: "DRAFT",
        },
      });
      created.push({ itemIndex: idx, id: contentItem.id, title: contentItem.title });
    }

    await audit.log({
      userId: user.id,
      action: "content.batch_create",
      objectType: "ContentPlan",
      objectId: plan.id,
      summary: `batch ${created.length} drafts${aiWrite ? " (aiWrite)" : ""}`,
    });
    return ok({ created, aiWrite }, 201);
  });
}
