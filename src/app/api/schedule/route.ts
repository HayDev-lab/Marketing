import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, parseJson } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { preflightCheck, PLATFORM_RULES } from "@/lib/platform-rules";

// GET /api/schedule — list scheduled posts
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const upcoming = url.searchParams.get("upcoming") === "1";
    const posts = await db.scheduledPost.findMany({
      where: { userId: user.id, ...(upcoming ? { scheduledAt: { gte: new Date() }, status: { in: ["READY", "SCHEDULED"] } } : {}) },
      orderBy: upcoming ? { scheduledAt: "asc" } : { createdAt: "desc" },
      take: 60,
      include: { contentItem: { select: { id: true, title: true, approvalState: true, assetId: true } } },
    });
    return ok(posts);
  });
}

// POST /api/schedule — preflight + schedule (approval required; publish never automatic here)
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const contentItem = await db.contentItem.findUnique({ where: { id: String(body.contentItemId) } });
    if (!contentItem || contentItem.userId !== user.id) throw new ApiError(404, "CONTENT_NOT_FOUND", "Content item not found");
    if (contentItem.approvalState !== "APPROVED" && contentItem.approvalState !== "SCHEDULED") {
      throw new ApiError(400, "NOT_APPROVED", "Content must be APPROVED before scheduling");
    }
    const platform = body.platform ?? contentItem.platform;
    if (!PLATFORM_RULES[platform]) throw new ApiError(400, "VALIDATION", "Unknown platform");
    const scheduledAt = new Date(String(body.scheduledAt));
    if (isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() - 60_000) {
      throw new ApiError(400, "VALIDATION", "scheduledAt must be a valid future time");
    }

    // Preflight validation (platform rules)
    const media = contentItem.assetId ? await db.mediaAsset.findUnique({ where: { id: contentItem.assetId } }) : null;
    const preflight = preflightCheck({
      platform,
      caption: contentItem.caption,
      hasMedia: Boolean(media) || Boolean(contentItem.videoProjectId),
      mediaDurationSec: media?.kind === "VIDEO" ? parseJson<{ durationSec?: number }>(media.metaJson, {}).durationSec : undefined,
    });

    const post = await db.scheduledPost.create({
      data: {
        userId: user.id,
        brandId: contentItem.brandId,
        contentItemId: contentItem.id,
        platform,
        caption: contentItem.caption,
        scheduledAt,
        timezone: String(body.timezone ?? "Asia/Yerevan").slice(0, 60),
        status: preflight.ok ? "SCHEDULED" : "ACTION_REQUIRED",
        preflightJson: JSON.stringify(preflight),
        error: preflight.ok ? null : preflight.issues.join("; ").slice(0, 500),
        idempotencyKey: `post:${contentItem.id}:${platform}:${scheduledAt.toISOString()}`,
      },
    });

    if (contentItem.approvalState === "APPROVED") {
      await db.contentItem.update({ where: { id: contentItem.id }, data: { approvalState: "SCHEDULED", scheduledAt } });
      await db.approvalEvent.create({ data: { contentItemId: contentItem.id, fromState: "APPROVED", toState: "SCHEDULED", actorType: "WEB_UI", note: `Scheduled for ${scheduledAt.toISOString()}` } });
    }
    await audit.log({ userId: user.id, action: "schedule.create", objectType: "ScheduledPost", objectId: post.id, summary: `${platform} at ${scheduledAt.toISOString()} preflight:${preflight.ok ? "OK" : "ISSUES"}` });
    return ok({ post, preflight }, 201);
  });
}
