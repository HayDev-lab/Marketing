import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, requireUser } from "@/lib/api";
export async function GET(req: NextRequest) {
    return handle(async () => { const user = await requireUser(); const brandId = req.nextUrl.searchParams.get("brandId"); const assets = await db.mediaAsset.findMany({ where: { userId: user.id, ...(brandId ? { brandId } : {}) }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, filename: true, kind: true, mimeType: true, provider: true, brandId: true, createdAt: true, size: true } }); return ok(assets.map(a => ({ ...a, url: `/api/assets/${a.id}/raw` }))); });
}
