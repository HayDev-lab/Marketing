import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, assertBrandOwnership } from "@/lib/api";
import { audit } from "@/lib/ledger";

type Params = { params: Promise<{ id: string }> };

// GET /api/brands/[id] — full brand with memory
export async function GET(_req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const brand = await assertBrandOwnership(id, user.id);
    const full = await db.brand.findUnique({
      where: { id },
      include: {
        profile: true,
        facts: { orderBy: { createdAt: "desc" } },
        products: true,
        audiences: true,
        trends: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    return ok(full);
  });
}

// PATCH /api/brands/[id] — update basics / logo
export async function PATCH(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertBrandOwnership(id, user.id);
    const body = await req.json();
    const data: Record<string, unknown> = {};
    for (const k of ["name", "website", "description", "industry", "geography", "logoAssetId", "stage"] as const) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    if (body.languages !== undefined) data.languages = JSON.stringify(body.languages);
    const brand = await db.brand.update({ where: { id }, data });
    await audit.log({ userId: user.id, action: "brand.update", objectType: "Brand", objectId: id, summary: "Brand updated" });
    return ok(brand);
  });
}

// DELETE /api/brands/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertBrandOwnership(id, user.id);
    await db.brand.delete({ where: { id } });
    await audit.log({ userId: user.id, action: "brand.delete", objectType: "Brand", objectId: id });
    return ok({ deleted: true });
  });
}
