import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, assertBrandOwnership } from "@/lib/api";
import { audit } from "@/lib/ledger";

type Params = { params: Promise<{ id: string }> };

// GET /api/brands/[id]/facts
export async function GET(_req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertBrandOwnership(id, user.id);
    const facts = await db.businessFact.findMany({ where: { brandId: id }, orderBy: { createdAt: "desc" } });
    return ok(facts);
  });
}

// POST /api/brands/[id]/facts — add USER_PROVIDED fact / product / audience
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertBrandOwnership(id, user.id);
    const body = await req.json();
    const content = String(body.content ?? "").trim();
    if (!content) throw new ApiError(400, "VALIDATION", "Content required");
    const kind = ["SOURCE_FACT", "AI_INFERENCE", "USER_PROVIDED"].includes(body.kind) ? body.kind : "USER_PROVIDED";
    const fact = await db.businessFact.create({
      data: {
        brandId: id,
        kind,
        category: String(body.category ?? "other").slice(0, 40),
        content: content.slice(0, 600),
        confidence: kind === "USER_PROVIDED" ? 1 : 0.5,
        approved: true,
      },
    });
    if (body.category === "product" && body.makeProduct) {
      await db.product.create({ data: { brandId: id, name: content.slice(0, 120), description: body.evidence ?? null } });
    }
    await audit.log({ userId: user.id, action: "fact.add", objectType: "BusinessFact", objectId: fact.id });
    return ok(fact, 201);
  });
}

// DELETE /api/brands/[id]/facts?factId=...
export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertBrandOwnership(id, user.id);
    const factId = new URL(req.url).searchParams.get("factId");
    if (!factId) throw new ApiError(400, "VALIDATION", "factId required");
    const fact = await db.businessFact.findUnique({ where: { id: factId } });
    if (!fact || fact.brandId !== id) throw new ApiError(404, "NOT_FOUND", "Fact not found");
    await db.businessFact.delete({ where: { id: factId } });
    return ok({ deleted: true });
  });
}
