// Trend → Draft bridge. Shared by the manual UI flow (POST /api/content with
// adaptationId) and the autopilot chain (TREND_ADAPT step route) so both create
// EXACTLY the same seeded draft and the same USED bookkeeping. Honest rules:
// the draft is always created in DRAFT approval state — autopilot never
// publishes, approval stays human.

import { db } from "@/lib/db";
import { audit } from "@/lib/ledger";

export interface DraftBridgeResult {
  contentItemId: string;
  title: string;
}

export async function createDraftFromAdaptation(opts: {
  userId: string;
  adaptationId: string;
  titleOverride?: string;
  brandIdOverride?: string | null;
}): Promise<DraftBridgeResult> {
  const row = await db.trendAdaptation.findUnique({
    where: { id: opts.adaptationId },
    include: {
      trend: { select: { id: true, title: true, sourceUrl: true, hashtagsJson: true } },
      brand: { select: { id: true, name: true } },
    },
  });
  if (!row || row.userId !== opts.userId) throw new Error("Adaptation not found");

  const brandId = opts.brandIdOverride ?? row.brandId;
  if (!brandId) throw new Error("Adaptation has no brand");
  const brand = await db.brand.findUnique({ where: { id: brandId }, select: { userId: true, name: true } });
  if (!brand || brand.userId !== opts.userId) throw new Error("Brand not found");

  let hashtags: string | null = null;
  if (row.trend.hashtagsJson) {
    try {
      const tags: unknown = JSON.parse(row.trend.hashtagsJson);
      if (Array.isArray(tags) && tags.length) hashtags = tags.map(String).join(" ");
    } catch {
      /* keep null — honest empty */
    }
  }

  const title = (opts.titleOverride ?? `${row.trend.title} — ${row.hook ?? row.concept ?? "adaptation"}`).slice(0, 200);

  const item = await db.contentItem.create({
    data: {
      userId: opts.userId,
      brandId,
      trendId: row.trendId,
      title,
      platform: ["instagram", "tiktok", "facebook", "telegram"].includes(row.platform) ? row.platform : "instagram",
      language: ["hy", "ru", "en"].includes(row.language ?? "") ? (row.language as string) : "hy",
      contentType: ["IMAGE_POST", "VIDEO_REEL", "STORY", "CAROUSEL", "POST"].includes(row.contentType)
        ? row.contentType
        : "IMAGE_POST",
      hook: row.hook?.slice(0, 2000) ?? null,
      caption: row.captionIdea?.slice(0, 5000) ?? null,
      script: row.scriptOutline?.slice(0, 8000) ?? null,
      hashtags: hashtags?.slice(0, 500) ?? null,
      approvalState: "DRAFT", // human approval is inherent — autopilot never publishes
      metaJson: JSON.stringify({
        fromAdaptation: row.id,
        fromTrendSource: row.trend.sourceUrl,
        source: "trend_adaptation",
      }),
    },
  });

  await audit.log({
    userId: opts.userId,
    action: "content.create",
    objectType: "ContentItem",
    objectId: item.id,
    summary: `${title} (from trend adaptation)`,
  });
  await db.trendAdaptation.update({
    where: { id: row.id },
    data: { status: "USED", usedContentItemId: item.id },
  });

  return { contentItemId: item.id, title };
}
