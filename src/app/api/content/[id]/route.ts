import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, assertContentOwnership, parseJson } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { llmCompleteJson } from "@/lib/ai/zai";

type Params = { params: Promise<{ id: string }> };

// Material fields whose change invalidates an existing APPROVED state
const MATERIAL_FIELDS = ["title", "hook", "script", "caption", "hashtags", "platform", "language", "contentType", "assetId", "videoProjectId"];

// GET /api/content/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const item = await assertContentOwnership(id, user.id);
    const asset = item.assetId ? await db.mediaAsset.findUnique({ where: { id: item.assetId } }) : null;
    const videoProject = item.videoProjectId
      ? await db.videoProject.findUnique({ where: { id: item.videoProjectId }, include: { scenes: { orderBy: { order: "asc" } } } })
      : null;
    const subs = await db.subtitleTrack.findFirst({ where: { contentItemId: id } });
    return ok({ ...item, asset, videoProject, subtitles: subs });
  });
}

// PATCH /api/content/[id] — edit; changing material after APPROVED invalidates approval
export async function PATCH(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const item = await assertContentOwnership(id, user.id);
    const body = await req.json();

    const data: Record<string, unknown> = {};
    let materialChanged = false;
    for (const k of MATERIAL_FIELDS) {
      if (body[k] !== undefined && body[k] !== (item as Record<string, unknown>)[k]) {
        data[k] = body[k];
        materialChanged = true;
      }
    }
    if (body.prompt !== undefined) data.prompt = String(body.prompt).slice(0, 6000);

    if (materialChanged && item.approvalState === "APPROVED") {
      data.approvalState = "CHANGES_REQUESTED"; // approval INVALIDATED, honestly
      await db.approvalEvent.create({
        data: { contentItemId: id, fromState: "APPROVED", toState: "CHANGES_REQUESTED", actorType: "SYSTEM", note: "Material changed after approval — approval invalidated" },
      });
    }
    if (materialChanged) {
      data.contentVersion = item.contentVersion + 1;
    }
    const updated = await db.contentItem.update({ where: { id }, data });
    await audit.log({ userId: user.id, action: "content.update", objectType: "ContentItem", objectId: id, summary: materialChanged ? "Material edited" : "Metadata edited" });
    return ok(updated);
  });
}

// DELETE /api/content/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertContentOwnership(id, user.id);
    await db.contentItem.delete({ where: { id } });
    await audit.log({ userId: user.id, action: "content.delete", objectType: "ContentItem", objectId: id });
    return ok({ deleted: true });
  });
}
