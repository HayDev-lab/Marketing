import { getCurrentUser } from "@/lib/auth";
import { ok, handle, parseJson } from "@/lib/api";
import { db } from "@/lib/db";

// GET /api/auth/me — session probe: user + bootstrap data
export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok({ user: null });
    const [brands, policy] = await Promise.all([
      db.brand.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
      db.autopilotPolicy.findUnique({ where: { userId: user.id } }),
    ]);
    return ok({
      user: { id: user.id, email: user.email, name: user.name, locale: user.locale, isAdmin: user.isAdmin },
      brands: brands.map((b) => ({ id: b.id, name: b.name, stage: b.stage, website: b.website })),
      autopilotEnabled: policy?.enabled ?? false,
    });
  });
}
