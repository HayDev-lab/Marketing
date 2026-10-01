// §30 internal admin — platform-level configuration store + generation guards.
//
// SystemConfig rows are typed keys (JSON values) with a short in-process cache
// (30s TTL) so hot generation paths do not hammer SQLite on every call.
// Everything here is HONEST: guards throw distinct, actionable codes, never
// silent fallbacks.
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";

// ---------- known keys ----------
export const ADMIN_CONFIG_KEYS = {
  /** Record<providerId, boolean> — platform default for the /api/settings/providers merge */
  switchDefaults: "admin.switchDefaults",
  /** string[] — model ids blocked platform-wide (enforced in generation routes) */
  modelBlacklist: "admin.modelBlacklist",
  /** string[] — provider ids disabled platform-wide (enforced in generation routes) */
  disabledProviders: "admin.disabledProviders",
} as const;

export type SwitchDefaults = Record<string, boolean>;

// ---------- 30s in-memory cache ----------
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit || hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

/** Read a SystemConfig row (JSON parsed) or null when unset. 30s cached. */
export async function getSystemConfig<T>(key: string): Promise<T | null> {
  const cached = cacheGet<T>(key);
  if (cached !== null) return cached;
  const row = await db.systemConfig.findUnique({ where: { key } });
  if (!row) return null;
  try {
    const value = JSON.parse(row.valueJson) as T;
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch {
    // corrupted value — honest null, never crash the caller
    return null;
  }
}

/** Upsert a SystemConfig key and invalidate the cache immediately. */
export async function setSystemConfig(key: string, value: unknown): Promise<void> {
  const valueJson = JSON.stringify(value);
  await db.systemConfig.upsert({
    where: { key },
    create: { key, valueJson },
    update: { valueJson },
  });
  cache.delete(key);
}

// ---------- generation guard ----------
/**
 * Platform + user level route enforcement, called AFTER routeCapability()
 * succeeded and BEFORE any provider submit / job creation.
 * Order (distinct honest codes):
 *   1. providerId ∈ admin.disabledProviders → 423 PROVIDER_DISABLED_BY_ADMIN
 *   2. modelId   ∈ admin.modelBlacklist     → 423 MODEL_BLOCKED_BY_ADMIN
 *   3. user's ProviderConfig.enabled === false for that provider → 423 PROVIDER_DISABLED
 */
export async function assertRouteAllowed(
  route: { providerId: string; modelId: string },
  userId: string
): Promise<void> {
  const [disabledProviders, modelBlacklist] = await Promise.all([
    getSystemConfig<string[]>(ADMIN_CONFIG_KEYS.disabledProviders),
    getSystemConfig<string[]>(ADMIN_CONFIG_KEYS.modelBlacklist),
  ]);

  if (Array.isArray(disabledProviders) && disabledProviders.includes(route.providerId)) {
    throw new ApiError(
      423,
      "PROVIDER_DISABLED_BY_ADMIN",
      `Provider "${route.providerId}" is disabled platform-wide by the platform admin. ` +
        "Contact the platform admin if you need this provider."
    );
  }
  if (Array.isArray(modelBlacklist) && modelBlacklist.includes(route.modelId)) {
    throw new ApiError(
      423,
      "MODEL_BLOCKED_BY_ADMIN",
      `Model "${route.modelId}" is blocked platform-wide by the platform admin. ` +
        "Pick another model or contact the platform admin."
    );
  }

  // Per-user explicit override — wins over every platform default
  const cfg = await db.providerConfig.findUnique({
    where: { userId_providerId: { userId, providerId: route.providerId } },
  });
  if (cfg && cfg.enabled === false) {
    throw new ApiError(
      423,
      "PROVIDER_DISABLED",
      `Provider "${route.providerId}" is disabled in your Settings → Providers. Re-enable it there to use it.`
    );
  }
}
