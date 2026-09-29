import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, requireUser } from "@/lib/api";

// GET /api/analytics/overview?brandId= — pipeline & mix computed from REAL records only.
// No invented numbers: every count is a DB groupBy over the user's own content/publishing history.
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const brandId = new URL(req.url).searchParams.get("brandId") || undefined;

    const [items, posts, snapsAgg, tracked] = await Promise.all([
      db.contentItem.findMany({
        where: { userId: user.id, ...(brandId ? { brandId } : {}) },
        select: { approvalState: true, platform: true, language: true },
      }),
      db.scheduledPost.findMany({
        where: { userId: user.id, ...(brandId ? { brandId } : {}) },
        select: { status: true, platform: true },
      }),
      db.analyticsSnapshot.aggregate({
        where: { userId: user.id },
        _count: { _all: true },
        _sum: { views: true, likes: true, comments: true, shares: true, saves: true, clicks: true },
      }),
      db.analyticsSnapshot.findMany({
        where: { userId: user.id },
        select: { contentItemId: true },
        distinct: ["contentItemId"],
      }),
    ]);

    // full honest pipeline — every documented state shown, even zero (no omission bias)
    const FUNNEL = ["DRAFT", "GENERATING", "READY_FOR_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED", "FAILED"] as const;
    const funnel = FUNNEL.map((state) => ({ state, count: items.filter((i) => i.approvalState === state).length }));

    // tally helper: groupBy + sort desc (nulls skipped)
    const tally = (list: (string | null | undefined)[]) => {
      const m = new Map<string, number>();
      for (const v of list) {
        if (!v) continue;
        m.set(v, (m.get(v) ?? 0) + 1);
      }
      return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
    };

    const s = snapsAgg._sum;
    return ok({
      totalItems: items.length,
      funnel,
      totalPosts: posts.length,
      postStatuses: tally(posts.map((p) => p.status)),
      platforms: tally(items.map((i) => i.platform)),
      languages: tally(items.map((i) => i.language)),
      metrics: {
        snapshots: snapsAgg._count._all,
        postsTracked: tracked.length,
        views: s.views ?? 0,
        engagement: (s.likes ?? 0) + (s.comments ?? 0) + (s.shares ?? 0) + (s.saves ?? 0),
        clicks: s.clicks ?? 0,
      },
    });
  });
}
