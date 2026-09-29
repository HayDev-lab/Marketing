import { NextRequest } from "next/server";
import { ok, handle, ApiError, requireUser, assertContentOwnership } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { db } from "@/lib/db";
import { llmCompleteJson } from "@/lib/ai/zai";

type Params = { params: Promise<{ id: string }> };

const LANG_NAME: Record<string, string> = { hy: "Armenian (Հայերեն)", ru: "Russian (Русский)", en: "English" };

interface Variant {
  angle: string;
  hook: string;
  caption: string;
  script: string;
  hashtags: string[];
}

// POST /api/content/[id]/variants — generate 2 alternative copy variants (A/B test)
// Variants are NOT persisted: the user reviews them and applies one via PATCH (material edit).
export async function POST(_req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const item = await assertContentOwnership(id, user.id);
    const brand = await db.brand.findUnique({ where: { id: item.brandId }, include: { profile: true } });
    if (!brand) throw new ApiError(404, "BRAND_NOT_FOUND", "Brand not found");

    const language = LANG_NAME[item.language] ? item.language : "hy";
    const langName = LANG_NAME[language] ?? "Armenian (Հայերեն)";

    const system = `You are a platform-native copywriter for ${item.platform} running A/B tests. Write EXCLUSIVELY in ${langName}.
ALL output fields (angle, hook, caption, script, hashtags) MUST be 100% in ${langName}. Do NOT use any other language anywhere.
Ground claims ONLY in the brand data. NEVER invent prices, discounts, certificates, clients, reviews, awards, guarantees, medical results, statistics.
Respect platform norms: caption length, hook in first 2 seconds.
The two variants must be CLEARLY different in creative angle, not paraphrases.`;

    const prompt = `BRAND: ${brand.name}
Positioning: ${brand.profile?.positioning ?? ""}
Tone: ${brand.profile?.tone ?? ""}
Summary: ${brand.profile?.summary ?? ""}
Forbidden claims: ${brand.profile?.forbiddenClaims ?? "[]"}
CONTENT TYPE: ${item.contentType}
PLATFORM: ${item.platform}
CURRENT COPY (improve upon, do not copy):
Hook: ${item.hook ?? "—"}
Caption: ${item.caption ?? "—"}
Hashtags: ${item.hashtags ?? "—"}
TOPIC/BRIEF: ${item.title}

Produce exactly 2 variants:
- Variant A: bold emotional angle — strong feeling, punchy short sentences, curiosity hook.
- Variant B: informative practical angle — concrete benefit, useful details, straight-to-value hook.

Return JSON: {"variants":[{"id":"A","angle":str (one short sentence describing the angle, in ${langName}),"hook":str,"caption":str,"script":str (only for video types, else empty),"hashtags":[str]},{"id":"B",...}]}`;

    let variants: Variant[];
    try {
      const res = await llmCompleteJson<{ variants: Variant[] }>({ system, prompt });
      variants = (res.variants ?? []).slice(0, 2);
    } catch (e) {
      throw new ApiError(502, "GENERATION_FAILED", `Variant generation failed: ${e instanceof Error ? e.message : "unknown"}`, true);
    }
    if (variants.length === 0) {
      throw new ApiError(502, "GENERATION_FAILED", "Provider returned no variants", true);
    }

    const out = variants.map((v, i) => ({
      id: i === 0 ? "A" : "B",
      angle: String(v.angle ?? "").slice(0, 200),
      hook: String(v.hook ?? "").slice(0, 2000),
      caption: String(v.caption ?? "").slice(0, 5000),
      script: String(v.script ?? "").slice(0, 8000),
      hashtags: (Array.isArray(v.hashtags) ? v.hashtags : []).slice(0, 20).map((h) => String(h).slice(0, 40)),
    }));

    await audit.log({
      userId: user.id,
      action: "content.variants",
      objectType: "ContentItem",
      objectId: id,
      summary: `A/B variants generated (${out.map((v) => v.id).join("/")})`,
    });
    return ok({ variants: out });
  });
}
