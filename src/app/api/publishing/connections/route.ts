import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, parseJson } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { PLATFORM_RULES } from "@/lib/platform-rules";

// GET /api/publishing/connections — list connections with honest capability modes
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const connections = await db.publishingConnection.findMany({ where: { userId: user.id } });
    // Ensure all 4 platforms exist with honest default state
    const platforms = Object.keys(PLATFORM_RULES);
    const existing = new Set(connections.map((c) => c.platform));
    for (const p of platforms) {
      if (!existing.has(p)) {
        connections.push({
          id: `virtual_${p}`,
          userId: user.id,
          platform: p,
          accountName: null,
          status: "NOT_CONNECTED",
          mode: PLATFORM_RULES[p].apiAvailability,
          permissions: null,
          tokenExpiresAt: null,
          lastPublishAt: null,
          metaJson: JSON.stringify({ note: PLATFORM_RULES[p].notes, limitations: PLATFORM_RULES[p].publishingLimitations }),
          createdAt: new Date(),
          updatedAt: new Date(),
        } as never);
      }
    }
    return ok(connections);
  });
}

// POST /api/publishing/connections — attempt connect; external credentials absent → honest status
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const platform = String(body.platform ?? "");
    if (!PLATFORM_RULES[platform]) throw new ApiError(400, "VALIDATION", "Unknown platform");

    // No real OAuth credentials in this environment — record honest action-required state.
    const conn = await db.publishingConnection.upsert({
      where: { userId_platform: { userId: user.id, platform } },
      create: {
        userId: user.id,
        platform,
        accountName: body.accountName ? String(body.accountName).slice(0, 120) : null,
        status: "NOT_CONNECTED",
        mode: PLATFORM_RULES[platform].apiAvailability,
        metaJson: JSON.stringify({ note: PLATFORM_RULES[platform].notes, connectAttemptedAt: new Date().toISOString() }),
      },
      update: {
        accountName: body.accountName ? String(body.accountName).slice(0, 120) : undefined,
        metaJson: JSON.stringify({ note: PLATFORM_RULES[platform].notes, connectAttemptedAt: new Date().toISOString() }),
      },
    });
    await audit.log({ userId: user.id, action: "publishing.connect_attempt", objectType: "PublishingConnection", objectId: conn.id, summary: `${platform}: external OAuth credentials not configured in this environment` });
    return ok({
      connection: conn,
      honestStatus: "BLOCKED_EXTERNAL",
      reason: `${PLATFORM_RULES[platform].title} requires developer app credentials (OAuth) that are not configured in this environment. Pipeline, preflight and status machine are fully implemented and will go live once credentials are provided in Settings.`,
      requiredSetup: PLATFORM_RULES[platform].publishingLimitations,
    });
  });
}

// PATCH /api/publishing/connections — disconnect / update meta
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const conn = await db.publishingConnection.findUnique({ where: { id: String(body.id) } });
    if (!conn || conn.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Connection not found");
    const data: Record<string, unknown> = {};
    if (body.disconnect) {
      data.status = "NOT_CONNECTED";
      data.accountName = null;
      data.tokenExpiresAt = null;
    }
    const updated = await db.publishingConnection.update({ where: { id: conn.id }, data });
    return ok(updated);
  });
}
