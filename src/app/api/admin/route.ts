// §30 internal admin API — platform stats, user management, platform-level
// switches. EVERY handler requires an authenticated admin (403 NOT_ADMIN
// otherwise) and EVERY mutation is written to the audit trail as "admin.*".
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { PROVIDER_REGISTRY } from "@/lib/ai/registry";
import {
  getSystemConfig,
  setSystemConfig,
  ADMIN_CONFIG_KEYS,
  type SwitchDefaults,
} from "@/lib/ai/system-config";

const MAX_BLACKLIST = 50;

async function requireAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) throw new ApiError(403, "NOT_ADMIN", "Admin access required");
  return user;
}

// GET /api/admin — real platform stats + users + current system config
export async function GET() {
  return handle(async () => {
    await requireAdmin();

    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [
      usersCount,
      brandsCount,
      contentItemsCount,
      mediaAssetsCount,
      videoProjectsCount,
      trendsCount,
      promptTemplatesCount,
      auditLogsCount,
      jobsByStatus,
      jobsByKind,
      plans,
      costTotal,
      costMonth,
      users,
      switchDefaults,
      modelBlacklist,
      disabledProviders,
    ] = await Promise.all([
      db.user.count(),
      db.brand.count(),
      db.contentItem.count(),
      db.mediaAsset.count(),
      db.videoProject.count(),
      db.trend.count(),
      db.promptTemplate.count(),
      db.auditLog.count(),
      db.generationJob.groupBy({ by: ["status"], _count: { _all: true } }),
      db.generationJob.groupBy({ by: ["kind"], _count: { _all: true } }),
      db.subscription.groupBy({ by: ["plan"], _count: { _all: true } }),
      db.costLedger.aggregate({ _sum: { estimatedCost: true } }),
      db.costLedger.aggregate({ _sum: { estimatedCost: true }, where: { createdAt: { gte: startOfMonth } } }),
      db.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          isAdmin: true,
          createdAt: true,
          _count: { select: { jobs: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      getSystemConfig<SwitchDefaults>(ADMIN_CONFIG_KEYS.switchDefaults),
      getSystemConfig<string[]>(ADMIN_CONFIG_KEYS.modelBlacklist),
      getSystemConfig<string[]>(ADMIN_CONFIG_KEYS.disabledProviders),
    ]);

    return ok({
      stats: {
        counts: {
          users: usersCount,
          brands: brandsCount,
          contentItems: contentItemsCount,
          mediaAssets: mediaAssetsCount,
          videoProjects: videoProjectsCount,
          trends: trendsCount,
          promptTemplates: promptTemplatesCount,
          auditLogs: auditLogsCount,
        },
        jobs: {
          byStatus: jobsByStatus.map((r) => ({ status: r.status, count: r._count._all })),
          byKind: jobsByKind.map((r) => ({ kind: r.kind, count: r._count._all })),
        },
        cost: {
          total: costTotal._sum.estimatedCost ?? 0,
          thisMonth: costMonth._sum.estimatedCost ?? 0,
        },
        plans: plans.map((r) => ({ plan: r.plan, count: r._count._all })),
      },
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        isAdmin: u.isAdmin,
        createdAt: u.createdAt,
        jobCount: u._count.jobs,
      })),
      systemConfig: {
        switchDefaults: switchDefaults ?? {},
        modelBlacklist: Array.isArray(modelBlacklist) ? modelBlacklist : [],
        disabledProviders: Array.isArray(disabledProviders) ? disabledProviders : [],
      },
    });
  });
}

// POST /api/admin — validated + audited platform mutations
export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = await req.json();
    const action = String(body?.action ?? "");

    // --- platform default on/off for one provider (providers merge default) ---
    if (action === "set_switch_defaults") {
      const providerId = String(body.providerId ?? "");
      const enabled = body.enabled;
      const provider = PROVIDER_REGISTRY.find((p) => p.providerId === providerId);
      if (!provider) throw new ApiError(400, "VALIDATION", `Unknown providerId "${providerId}"`);
      if (typeof enabled !== "boolean") throw new ApiError(400, "VALIDATION", "enabled must be a boolean");
      const current = (await getSystemConfig<SwitchDefaults>(ADMIN_CONFIG_KEYS.switchDefaults)) ?? {};
      current[providerId] = enabled;
      await setSystemConfig(ADMIN_CONFIG_KEYS.switchDefaults, current);
      await audit.log({
        userId: admin.id,
        actorType: "WEB_UI",
        action: "admin.set_switch_defaults",
        objectType: "SystemConfig",
        objectId: ADMIN_CONFIG_KEYS.switchDefaults,
        summary: `Platform default for provider "${providerId}" → ${enabled ? "enabled" : "disabled"} (per-user overrides still win)`,
      });
      return ok({ switchDefaults: current });
    }

    // --- platform-wide model blacklist ---
    if (action === "set_model_blacklist") {
      const models = body.models;
      if (!Array.isArray(models) || models.some((m) => typeof m !== "string")) {
        throw new ApiError(400, "VALIDATION", "models must be an array of model id strings");
      }
      const known = new Set(PROVIDER_REGISTRY.flatMap((p) => p.models.map((m) => m.id)));
      const unknown = models.filter((m: string) => !known.has(m));
      if (unknown.length) throw new ApiError(400, "VALIDATION", `Unknown model ids: ${unknown.join(", ")}`);
      const list = [...new Set(models.map((m: string) => m.trim()).filter(Boolean))].slice(0, MAX_BLACKLIST);
      await setSystemConfig(ADMIN_CONFIG_KEYS.modelBlacklist, list);
      await audit.log({
        userId: admin.id,
        actorType: "WEB_UI",
        action: "admin.set_model_blacklist",
        objectType: "SystemConfig",
        objectId: ADMIN_CONFIG_KEYS.modelBlacklist,
        summary: `Model blacklist set to [${list.join(", ") || "empty"}] — blocked models fail with 423 MODEL_BLOCKED_BY_ADMIN at generation time`,
      });
      return ok({ modelBlacklist: list });
    }

    // --- platform-wide disabled providers ---
    if (action === "set_disabled_providers") {
      const providerIds = body.providerIds;
      if (!Array.isArray(providerIds) || providerIds.some((p) => typeof p !== "string")) {
        throw new ApiError(400, "VALIDATION", "providerIds must be an array of provider id strings");
      }
      const known = new Set(PROVIDER_REGISTRY.map((p) => p.providerId));
      const unknown = providerIds.filter((p: string) => !known.has(p));
      if (unknown.length) throw new ApiError(400, "VALIDATION", `Unknown provider ids: ${unknown.join(", ")}`);
      const list = [...new Set(providerIds.map((p: string) => p.trim()).filter(Boolean))].slice(0, MAX_BLACKLIST);
      await setSystemConfig(ADMIN_CONFIG_KEYS.disabledProviders, list);
      await audit.log({
        userId: admin.id,
        actorType: "WEB_UI",
        action: "admin.set_disabled_providers",
        objectType: "SystemConfig",
        objectId: ADMIN_CONFIG_KEYS.disabledProviders,
        summary: `Platform-disabled providers set to [${list.join(", ") || "empty"}] — generation via these providers fails with 423 PROVIDER_DISABLED_BY_ADMIN`,
      });
      return ok({ disabledProviders: list });
    }

    // --- promote/demote user admin flag ---
    if (action === "set_user_admin") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const isAdmin = body.isAdmin;
      if (!email || typeof isAdmin !== "boolean") {
        throw new ApiError(400, "VALIDATION", "email (string) and isAdmin (boolean) are required");
      }
      if (email === admin.email.toLowerCase() && !isAdmin) {
        throw new ApiError(400, "SELF_DEMOTE", "You cannot demote your own admin account");
      }
      const target = await db.user.findUnique({ where: { email } });
      if (!target) throw new ApiError(404, "USER_NOT_FOUND", `No user with email ${email}`);
      await db.user.update({ where: { id: target.id }, data: { isAdmin } });
      await audit.log({
        userId: admin.id,
        actorType: "WEB_UI",
        action: "admin.set_user_admin",
        objectType: "User",
        objectId: target.id,
        summary: `${email} admin flag → ${isAdmin} (by ${admin.email})`,
      });
      return ok({ email, isAdmin });
    }

    throw new ApiError(400, "BAD_ACTION", `Unknown admin action "${action}"`);
  });
}
