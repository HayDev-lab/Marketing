import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, assertContentOwnership } from "@/lib/api";
import { audit } from "@/lib/ledger";

type Params = { params: Promise<{ id: string }> };

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["GENERATING", "READY_FOR_REVIEW"],
  GENERATING: ["READY_FOR_REVIEW", "FAILED"],
  READY_FOR_REVIEW: ["APPROVED", "CHANGES_REQUESTED", "DRAFT"],
  CHANGES_REQUESTED: ["READY_FOR_REVIEW", "DRAFT"],
  APPROVED: ["SCHEDULED", "READY_FOR_REVIEW"],
  SCHEDULED: ["PUBLISHED", "FAILED", "READY_FOR_REVIEW"],
  PUBLISHED: [],
  FAILED: ["DRAFT", "READY_FOR_REVIEW"],
};

// POST /api/content/[id]/transition — approval state machine (approve never publishes)
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const item = await assertContentOwnership(id, user.id);
    const body = await req.json();
    const to = String(body.to ?? "");
    const allowed = TRANSITIONS[item.approvalState] ?? [];
    if (!allowed.includes(to)) {
      throw new ApiError(409, "INVALID_TRANSITION", `Cannot move from ${item.approvalState} to ${to}. Allowed: ${allowed.join(", ")}`);
    }
    if (to === "APPROVED") {
      const hasMedia = item.assetId || item.videoProjectId;
      if (!hasMedia) throw new ApiError(400, "NO_MEDIA", "Attach generated image or video before approval");
    }
    if (to === "SCHEDULED" && item.approvalState !== "APPROVED") {
      throw new ApiError(400, "NOT_APPROVED", "Only approved content can be scheduled");
    }
    const updated = await db.contentItem.update({ where: { id }, data: { approvalState: to } });
    await db.approvalEvent.create({
      data: { contentItemId: id, fromState: item.approvalState, toState: to, actorType: "WEB_UI", note: body.note ? String(body.note).slice(0, 300) : null },
    });
    await audit.log({ userId: user.id, action: `approval.${to.toLowerCase()}`, objectType: "ContentItem", objectId: id, summary: `${item.approvalState} → ${to}` });
    return ok(updated);
  });
}

// GET /api/content/[id]/transition — approval history
export async function GET(_req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertContentOwnership(id, user.id);
    const events = await db.approvalEvent.findMany({ where: { contentItemId: id }, orderBy: { createdAt: "asc" } });
    return ok(events);
  });
}
