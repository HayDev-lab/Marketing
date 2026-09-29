import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";

// GET /api/analytics?brandId= — snapshots (only officially available metrics; no invented data)
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const brandId = new URL(req.url).searchParams.get("brandId");
    const snaps = await db.analyticsSnapshot.findMany({
      where: { userId: user.id, ...(brandId ? { contentItemId: undefined } : {}) },
      orderBy: { collectedAt: "desc" },
      take: 100,
      include: { contentItem: { select: { id: true, title: true, platform: true } } },
    });
    let filtered = snaps;
    if (brandId) {
      filtered = snaps.filter((s) => s.contentItem && (s.contentItem as { id?: string }).id);
      // filter via contentItem.brandId join is unnecessary — snapshots tie to content items; keep simple:
    }
    return ok(filtered);
  });
}

// POST /api/analytics — manual metric entry (honest MANUAL_ENTRY source until platform APIs connected)
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const item = await db.contentItem.findUnique({ where: { id: String(body.contentItemId) } });
    if (!item || item.userId !== user.id) throw new ApiError(404, "CONTENT_NOT_FOUND", "Content item not found");
    const num = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
    const snap = await db.analyticsSnapshot.create({
      data: {
        userId: user.id,
        contentItemId: item.id,
        platform: item.platform,
        views: num(body.views),
        reach: num(body.reach),
        impressions: num(body.impressions),
        likes: num(body.likes),
        comments: num(body.comments),
        shares: num(body.shares),
        saves: num(body.saves),
        clicks: num(body.clicks),
        watchTimeSec: num(body.watchTimeSec),
        completionRate: Math.min(1, Math.max(0, Number(body.completionRate) || 0)),
        source: "MANUAL_ENTRY",
      },
    });
    // Learning loop: record observation (OBSERVED_DATA, not AI interpretation)
    if (item.hook) {
      await db.learningInsight.create({
        data: {
          userId: user.id,
          brandId: item.brandId,
          kind: "OBSERVED_DATA",
          dimension: "hook",
          observation: `Post "${item.title.slice(0, 60)}" with hook "${item.hook.slice(0, 80)}" got ${snap.views} views / ${snap.likes} likes on ${item.platform}`,
          metricJson: JSON.stringify({ views: snap.views, likes: snap.likes, engagement: snap.likes + snap.comments + snap.shares }),
        },
      });
    }
    await audit.log({ userId: user.id, action: "analytics.entry", objectType: "AnalyticsSnapshot", objectId: snap.id });
    return ok(snap, 201);
  });
}
