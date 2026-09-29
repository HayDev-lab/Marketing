import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { randomBytes, createHash } from "crypto";

// GET /api/mcp/tokens — list (prefix only, never the secret)
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const tokens = await db.mcpToken.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    return ok(
      tokens.map((t) => ({
        id: t.id,
        name: t.name,
        prefix: t.prefix,
        preset: t.preset,
        canUsePaidGeneration: t.canUsePaidGeneration,
        canSchedule: t.canSchedule,
        canPublish: t.canPublish,
        maxSpend: t.maxSpend,
        revoked: t.revoked,
        lastUsedAt: t.lastUsedAt,
        createdAt: t.createdAt,
      }))
    );
  });
}

// POST /api/mcp/tokens — create; the raw token is shown ONCE
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const raw = `hdm_${randomBytes(24).toString("hex")}`;
    const token = await db.mcpToken.create({
      data: {
        userId: user.id,
        name: String(body.name ?? "MCP client").slice(0, 80),
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        prefix: raw.slice(0, 12),
        preset: ["READ_ONLY", "CREATE_DRAFTS", "EXECUTE_GENERATIONS", "PUBLISH_ALLOWED"].includes(body.preset) ? body.preset : "READ_ONLY",
        canUsePaidGeneration: Boolean(body.canUsePaidGeneration),
        canSchedule: Boolean(body.canSchedule),
        canPublish: Boolean(body.canPublish),
        canAccessVoiceProfiles: Boolean(body.canAccessVoiceProfiles),
        maxSpend: Number(body.maxSpend) || 0,
      },
    });
    await audit.log({ userId: user.id, action: "mcp.token_create", objectType: "McpToken", objectId: token.id, summary: `${token.name} (${token.preset})` });
    return ok({ id: token.id, name: token.name, preset: token.preset, token: raw }, 201); // raw returned once
  });
}

// PATCH /api/mcp/tokens — revoke
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const token = await db.mcpToken.findUnique({ where: { id: String(body.id) } });
    if (!token || token.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Token not found");
    const updated = await db.mcpToken.update({ where: { id: token.id }, data: { revoked: Boolean(body.revoked) } });
    await audit.log({ userId: user.id, action: "mcp.token_revoke", objectType: "McpToken", objectId: token.id, summary: `revoked=${body.revoked}` });
    return ok({ id: updated.id, revoked: updated.revoked });
  });
}
