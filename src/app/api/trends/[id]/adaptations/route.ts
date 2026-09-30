import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

// GET /api/trends/[id]/adaptations — structured adaptations for a trend
export async function GET(_req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const trend = await db.trend.findUnique({ where: { id }, select: { userId: true } });
    if (!trend || trend.userId !== user.id) throw new ApiError(404, "TREND_NOT_FOUND", "Trend not found");
    const adaptations = await db.trendAdaptation.findMany({
      where: { trendId: id, userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    return ok(adaptations);
  });
}
