// Trend → Business adaptation. One LLM call returns the full structured
// creative package; the prompt compiler then produces provider-specific
// generation prompts. Used by POST /api/trends/[id]/adapt (UI) and by the
// legacy PATCH action=adapt (backward compatibility).

import { db } from "@/lib/db";
import { llmCompleteJson, extractJson } from "@/lib/ai/zai";
import { compileCreativePrompt, type MediaType } from "./prompt-compiler";

export interface StructuredAdaptation {
  hook: string;
  angle: string;
  concept: string;
  contentType: string;
  recommendedPlatform: string;
  audience: string;
  scriptOutline: string;
  visualDirection: string;
  captionIdea: string;
  cta: string;
  creativeBrief: string;
  risk: string;
}

const CONTENT_TYPES = ["POST", "IMAGE_POST", "VIDEO_REEL", "STORY", "CAROUSEL"];
const PLATFORMS = ["instagram", "tiktok", "facebook", "telegram"];

function mediaTypeFor(contentType: string): MediaType {
  if (contentType === "VIDEO_REEL" || contentType === "STORY") return "video";
  if (contentType === "IMAGE_POST" || contentType === "CAROUSEL") return "image";
  return "text";
}

export async function adaptTrendToBusiness(opts: {
  trendId: string;
  userId: string;
  brandId?: string | null;
  language: string;
  platform?: string;
  contentType?: string;
  objective?: string;
  templateBody?: string | null;
  templateId?: string | null;
  imageProvider?: string;
  videoProvider?: string;
}): Promise<{ adaptationId: string; structured: StructuredAdaptation; generationPrompt: string | null }> {
  const trend = await db.trend.findUnique({ where: { id: opts.trendId } });
  if (!trend || trend.userId !== opts.userId) throw new Error("Trend not found");
  const brand = opts.brandId
    ? await db.brand.findUnique({ where: { id: opts.brandId }, include: { profile: true, audiences: true } })
    : null;
  if (brand && brand.userId !== opts.userId) throw new Error("Brand not found");

  const platform = opts.platform ?? trend.platform ?? "instagram";
  const requestedType = opts.contentType ?? (platform === "tiktok" ? "VIDEO_REEL" : "IMAGE_POST");

  const system = `You are a senior creative director. Create an ORIGINAL adaptation of a trend for a brand.
NEVER copy the source video/post 1:1. Extract mechanics, pacing, hook structure, storytelling pattern, visual grammar — then produce original creative.
Forbidden claims (never use): invented prices, discounts, certificates, clients, reviews, awards, guarantees, medical results, statistics.
${opts.templateBody ? `The user selected a prompt-library template as stylistic base — respect its structure and intent:\n"""${opts.templateBody.slice(0, 1200)}"""` : ""}`;

  const prompt = `TREND: ${trend.title}
Summary: ${trend.summary ?? ""}
Status (honesty matters): ${trend.status}
Suggested direction: ${trend.suggestedAdaptation ?? ""}
BRAND: ${brand?.name ?? "the user's brand"}; positioning: ${brand?.profile?.positioning ?? "unknown"}; tone: ${brand?.profile?.tone ?? "unknown"}; summary: ${brand?.profile?.summary ?? "unknown"}; audiences: ${brand?.audiences?.map((a) => a.name).join(", ") || "unknown"}
REQUESTED: platform ${platform}, content type ${requestedType}, objective ${opts.objective ?? "engagement"}, output language ${opts.language}
Return JSON: {"hook": str (first 2s, in ${opts.language}), "angle": str (one-line creative angle in ${opts.language}), "concept": str (in ${opts.language}), "contentType": one of ${JSON.stringify(CONTENT_TYPES)}, "recommendedPlatform": one of ${JSON.stringify(PLATFORMS)}, "audience": str, "scriptOutline": str (scene beats, in ${opts.language}), "visualDirection": str (art direction, may be English), "captionIdea": str (in ${opts.language}), "cta": str (in ${opts.language}), "creativeBrief": str (concise production brief), "risk": str}`;

  const raw = await llmCompleteJson<Record<string, unknown>>({ system, prompt });
  const pick = (k: string, fallback = "") => (typeof raw?.[k] === "string" ? (raw[k] as string) : fallback);
  const contentType = CONTENT_TYPES.includes(pick("contentType")) ? pick("contentType") : requestedType;
  const recommendedPlatform = PLATFORMS.includes(pick("recommendedPlatform")) ? pick("recommendedPlatform") : platform;

  const structured: StructuredAdaptation = {
    hook: pick("hook").slice(0, 500),
    angle: pick("angle").slice(0, 500),
    concept: pick("concept").slice(0, 2000),
    contentType,
    recommendedPlatform,
    audience: pick("audience").slice(0, 300),
    scriptOutline: pick("scriptOutline").slice(0, 4000),
    visualDirection: pick("visualDirection").slice(0, 2000),
    captionIdea: pick("captionIdea").slice(0, 2000),
    cta: pick("cta").slice(0, 300),
    creativeBrief: pick("creativeBrief").slice(0, 2000),
    risk: pick("risk").slice(0, 500),
  };

  // Provider-specific generation prompt for the matching media type.
  const mediaType = mediaTypeFor(contentType);
  let generationPrompt: string | null = null;
  let generationProvider: string | null = null;
  if (mediaType === "image") {
    generationProvider = opts.imageProvider ?? "zai-image";
    generationPrompt = compileCreativePrompt({
      provider: generationProvider,
      mediaType: "image",
      business: {
        name: brand?.name ?? "the brand",
        tone: brand?.profile?.tone,
        positioning: brand?.profile?.positioning,
        summary: brand?.profile?.summary,
        audience: structured.audience,
      },
      trend: { title: trend.title, summary: trend.summary },
      adaptation: { concept: structured.concept, hook: structured.hook, visualDirection: structured.visualDirection },
      platform: recommendedPlatform,
      contentGoal: opts.objective,
      language: opts.language,
    });
  } else if (mediaType === "video") {
    generationProvider = opts.videoProvider ?? "zai-video";
    generationPrompt = compileCreativePrompt({
      provider: generationProvider,
      mediaType: "video",
      business: {
        name: brand?.name ?? "the brand",
        tone: brand?.profile?.tone,
        positioning: brand?.profile?.positioning,
        summary: brand?.profile?.summary,
        audience: structured.audience,
      },
      trend: { title: trend.title, summary: trend.summary },
      adaptation: { concept: structured.concept, hook: structured.hook, visualDirection: structured.visualDirection },
      platform: recommendedPlatform,
      contentGoal: opts.objective,
      durationSec: contentType === "STORY" ? 15 : 30,
      language: opts.language,
    });
  }

  const row = await db.trendAdaptation.create({
    data: {
      userId: opts.userId,
      trendId: trend.id,
      brandId: brand?.id ?? null,
      platform,
      contentType,
      audience: structured.audience || null,
      hook: structured.hook || null,
      angle: structured.angle || null,
      concept: structured.concept || null,
      cta: structured.cta || null,
      creativeBrief: structured.creativeBrief || null,
      scriptOutline: structured.scriptOutline || null,
      visualDirection: structured.visualDirection || null,
      captionIdea: structured.captionIdea || null,
      recommendedPlatform,
      generationPrompt,
      generationProvider,
      templateId: opts.templateId ?? null,
      language: opts.language,
      status: "READY",
    },
  });

  // Legacy mirror on the trend row so older surfaces (dashboard, old flows) still work.
  await db.trend.update({
    where: { id: trend.id },
    data: {
      concept: structured.concept || null,
      hook: structured.hook || null,
      script: structured.scriptOutline || null,
      suggestedAdaptation: structured.creativeBrief || trend.suggestedAdaptation,
      risk: structured.risk || trend.risk,
      brandFitScore: trend.brandFitScore ?? 0.6,
    },
  });

  return { adaptationId: row.id, structured, generationPrompt };
}

/** Re-export for legacy PATCH route: parse a structured LLM reply defensively. */
export function parseAdaptationJson<T>(raw: string): T {
  return extractJson<T>(raw);
}
