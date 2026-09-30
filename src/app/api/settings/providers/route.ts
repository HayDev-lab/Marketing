import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { PROVIDER_REGISTRY, type ProviderStatus } from "@/lib/ai/registry";
import { healthCheck } from "@/lib/ai/zai";

// GET /api/settings/providers — registry + user config (secrets never returned — none stored)
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const configs = await db.providerConfig.findMany({ where: { userId: user.id } });
    // Merge registry (source of truth) with user overrides
    const merged = PROVIDER_REGISTRY.map((p) => {
      const cfg = configs.find((c) => c.providerId === p.providerId);
      return {
        providerId: p.providerId,
        title: p.title,
        category: p.category,
        capabilities: p.capabilities,
        models: p.models,
        requiresExternalKey: p.requiresExternalKey ?? false,
        supportsHealthCheck: p.supportsHealthCheck,
        statusNote: p.statusNote,
        enabled: cfg?.enabled ?? p.status !== "BLOCKED_EXTERNAL",
        status: (cfg?.status ?? p.status) as ProviderStatus,
        defaultModel: cfg?.defaultModel ?? p.defaultModel,
        lastHealthAt: cfg?.lastHealthAt,
        lastHealthOk: cfg?.lastHealthOk,
      };
    });
    return ok(merged);
  });
}

// PATCH /api/settings/providers — enable/disable, set default model
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const providerId = String(body.providerId ?? "");
    const provider = PROVIDER_REGISTRY.find((p) => p.providerId === providerId);
    if (!provider) throw new ApiError(404, "NOT_FOUND", "Provider not found");
    const data: Record<string, unknown> = {};
    if (typeof body.enabled === "boolean") {
      // BLOCKED_EXTERNAL providers cannot be enabled (no credentials exist)
      if (body.enabled && provider.status === "BLOCKED_EXTERNAL") {
        throw new ApiError(423, "BLOCKED_EXTERNAL", provider.statusNote ?? "External API key not configured");
      }
      data.enabled = body.enabled;
    }
    if (body.defaultModel && provider.models.some((m) => m.id === body.defaultModel)) data.defaultModel = body.defaultModel;
    const updated = await db.providerConfig.upsert({
      where: { userId_providerId: { userId: user.id, providerId } },
      create: { userId: user.id, providerId, category: provider.category, enabled: true, status: provider.status },
      update: data,
    });
    await audit.log({ userId: user.id, action: "provider.update", objectType: "ProviderConfig", objectId: updated.id, summary: `${providerId}: ${JSON.stringify(data)}` });
    return ok(updated);
  });
}

// POST /api/settings/providers — health check (runtime verification)
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const providerId = String(body.providerId ?? "");
    const provider = PROVIDER_REGISTRY.find((p) => p.providerId === providerId);
    if (!provider) throw new ApiError(404, "NOT_FOUND", "Provider not found");
    const result = await healthCheck(providerId);
    const status: ProviderStatus = result.ok ? "LIVE_VERIFIED" : provider.status === "BLOCKED_EXTERNAL" ? "BLOCKED_EXTERNAL" : "DEGRADED";
    await db.providerConfig.upsert({
      where: { userId_providerId: { userId: user.id, providerId } },
      create: { userId: user.id, providerId, category: provider.category, status, lastHealthAt: new Date(), lastHealthOk: result.ok },
      update: { status, lastHealthAt: new Date(), lastHealthOk: result.ok },
    });
    await audit.log({ userId: user.id, action: "provider.health", objectType: "ProviderConfig", summary: `${providerId}: ${result.ok ? "LIVE_VERIFIED" : `fail: ${result.reason}`}` });
    return ok({ providerId, ...result, newStatus: status });
  });
}
