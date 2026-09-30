import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, parseJson } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { assertBrandQuota } from "@/lib/subscription";

// GET /api/brands — list user's brands
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const brands = await db.brand.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      include: { profile: true, _count: { select: { facts: true, contentItems: true } } },
    });
    return ok(brands);
  });
}

// POST /api/brands — create brand (onboarding step 1)
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError(400, "VALIDATION", "Brand name is required");
    if (name.length > 120) throw new ApiError(400, "VALIDATION", "Brand name too long");
    const website = body.website ? String(body.website).trim() : null;
    if (website && !/^https?:\/\//.test(website)) throw new ApiError(400, "VALIDATION", "Website must start with http(s)://");
    await assertBrandQuota(user.id); // plan-based brand cap (§31)
    const brand = await db.brand.create({
      data: {
        userId: user.id,
        name,
        website,
        description: body.description ? String(body.description).slice(0, 4000) : null,
        industry: body.industry ? String(body.industry).slice(0, 120) : null,
        geography: body.geography ? String(body.geography).slice(0, 200) : null,
        languages: body.languages ? JSON.stringify(body.languages) : JSON.stringify(["hy"]),
        metaJson: body.socialProfiles ? JSON.stringify({ socialProfiles: body.socialProfiles }) : null,
      },
    });
    await db.brandProfile.create({ data: { brandId: brand.id } }).catch(() => {});
    await audit.log({ userId: user.id, action: "brand.create", objectType: "Brand", objectId: brand.id, summary: `Created brand ${name}` });
    return ok(brand, 201);
  });
}
