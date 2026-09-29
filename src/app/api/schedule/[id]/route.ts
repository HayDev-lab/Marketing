import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { PLATFORM_RULES } from "@/lib/platform-rules";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/schedule/[id] — action: cancel | reschedule | attempt_publish (honest outcome)
export async function PATCH(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const post = await db.scheduledPost.findUnique({ where: { id }, include: { contentItem: true } });
    if (!post || post.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Scheduled post not found");
    const body = await req.json();

    if (body.action === "cancel") {
      const updated = await db.scheduledPost.update({ where: { id }, data: { status: "CANCELLED" } });
      if (post.contentItem && post.contentItem.approvalState === "SCHEDULED") {
        await db.contentItem.update({ where: { id: post.contentItem.id }, data: { approvalState: "APPROVED", scheduledAt: null } });
        await db.approvalEvent.create({ data: { contentItemId: post.contentItem.id, fromState: "SCHEDULED", toState: "APPROVED", actorType: "WEB_UI", note: "Schedule cancelled" } });
      }
      await audit.log({ userId: user.id, action: "schedule.cancel", objectType: "ScheduledPost", objectId: id });
      return ok(updated);
    }

    if (body.action === "reschedule") {
      const scheduledAt = new Date(String(body.scheduledAt));
      if (isNaN(scheduledAt.getTime())) throw new ApiError(400, "VALIDATION", "Invalid date");
      const updated = await db.scheduledPost.update({ where: { id }, data: { scheduledAt, status: "SCHEDULED" } });
      await audit.log({ userId: user.id, action: "schedule.reschedule", objectType: "ScheduledPost", objectId: id, summary: scheduledAt.toISOString() });
      return ok(updated);
    }

    if (body.action === "attempt_publish") {
      // Real publish requires platform credentials — absent here. Honest outcome:
      const rules = PLATFORM_RULES[post.platform];
      const updated = await db.scheduledPost.update({
        where: { id },
        data: {
          status: "ACTION_REQUIRED",
          error: `${rules.title}: direct publishing API is not configured in this environment (${rules.apiAvailability}). Export the media + caption below and post manually, or configure platform credentials.`,
        },
      });
      await audit.log({
        userId: user.id,
        action: "publish.attempt",
        objectType: "ScheduledPost",
        objectId: id,
        summary: `${post.platform}: honest ACTION_REQUIRED — no platform credentials configured`,
      });
      return ok({
        post: updated,
        honestStatus: "USER_ACTION_REQUIRED",
        exportPackage: {
          caption: post.caption,
          platform: post.platform,
          mediaUrl: post.contentItem?.assetId ? `/api/assets/${post.contentItem.assetId}/raw` : null,
        },
      });
    }

    throw new ApiError(400, "BAD_ACTION", "Unknown action");
  });
}
