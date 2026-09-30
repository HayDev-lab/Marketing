import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { readFile } from "fs/promises";
import path from "path";
import { UPLOADS_DIR } from "@/lib/ai/zai";

type Params = { params: Promise<{ id: string }> };

// GET /api/assets/[id]/raw — ownership-checked media serving (no public dir exposure)
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return fail(401, "UNAUTHORIZED", "Authentication required");
    const { id } = await params;
    const asset = await db.mediaAsset.findUnique({ where: { id } });
    if (!asset || asset.userId !== user.id) return fail(404, "NOT_FOUND", "Asset not found");
    const buffer = await readFile(path.join(UPLOADS_DIR, asset.storageKey));
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": asset.mimeType,
        "Cache-Control": "private, max-age=86400",
        "Content-Disposition": `inline; filename="${asset.filename}"`,
      },
    });
  } catch (err) {
    return fail(500, "ASSET_READ_FAILED", err instanceof Error ? err.message : "Failed to read asset");
  }
}
