import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { serializeTrend, type TrendRow } from "@/lib/trends/engine";

// GET /api/trends/export?format=csv|json&brandId=
// Honest export: rows are exactly what the radar feed shows (same
// serialization, same honesty labels). No invented fields, no padding.
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const format = url.searchParams.get("format") === "json" ? "json" : "csv";
    const brandId = url.searchParams.get("brandId");

    const rows = await db.trend.findMany({
      where: { userId: user.id, ...(brandId ? { brandId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const trends = rows.map((r) => serializeTrend(r as TrendRow));

    if (format === "json") {
      const payload = {
        exportedAt: new Date().toISOString(),
        count: trends.length,
        note: "Honest export: statuses reflect evidence strength (VERIFIED_TREND > POPULAR_TOPIC > EMERGING_SIGNAL > CONTENT_OPPORTUNITY > HYPOTHESIS). HYPOTHESIS rows are AI inferences without live sources.",
        trends,
      };
      return new Response(JSON.stringify(payload, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="haydev-trends-${new Date().toISOString().slice(0, 10)}.json"`,
        },
      });
    }

    // CSV
    const esc = (v: unknown): string => {
      const s = String(v ?? "");
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "title", "status", "platform", "market", "language", "category",
      "relevance", "freshness", "confidence", "brandFit",
      "sourceName", "sourceUrl", "sourceType", "sourcePublishedAt", "discoveredAt",
      "keywords", "hashtags", "summary", "risk",
    ];
    const lines = [header.join(",")];
    for (const t of trends) {
      lines.push([
        t.title, t.status, t.platform ?? "", t.country ?? "", t.language ?? "", t.category ?? "",
        t.relevanceScore ?? "", t.freshnessScore ?? "", t.confidence, t.brandFitScore ?? "",
        t.sourceName, t.sourceUrl, t.sourceType ?? "",
        t.sourcePublishedAt ?? "", t.discoveredAt,
        t.keywords.join(" | "), t.hashtags.map((h) => `#${h}`).join(" "),
        t.summary ?? "", t.risk ?? "",
      ].map(esc).join(","));
    }
    const csv = "\uFEFF" + lines.join("\n"); // BOM so Excel opens Armenian/Russian text correctly
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="haydev-trends-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });
}
