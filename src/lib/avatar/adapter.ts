// AvatarProviderAdapter (MASTER PROMPT §24) — plugin-slot architecture for talking avatars.
//
// Concrete adapters implement this interface; business code (API routes) never calls a
// provider directly. Currently implemented:
//   - heygen : BLOCKED_EXTERNAL in this environment (no HEYGEN_API_KEY).
//     The adapter interface is ready; routing reports it honestly as blocked and
//     generate() refuses with 503 instead of faking success.
//
// Plugin slot: adding a future provider = adding ONE object to ADAPTERS below
// (e.g. "d-id", "synthesia") + a registry entry. No other file changes needed.
//
// HONESTY RULE: this module never fabricates a successful generation. Without a
// configured provider every path ends in an honest ApiError 503 BLOCKED_EXTERNAL.

import { ApiError } from "@/lib/api";
import { getProvider } from "@/lib/ai/registry";

export const PLUGIN_SLOT = "src/lib/avatar/adapter.ts";

export interface AvatarCapabilities {
  /** provider can render a lip-synced talking-head video */
  supportsTalkingHead: boolean;
  /** provider can clone a voice from samples (vs picking a preset voice) */
  supportsVoiceClone: boolean;
  /** maximum accepted script length in characters */
  maxScriptChars: number;
  /** output resolutions the provider can render, e.g. ["720p", "1080p"] */
  resolution: string[];
}

export interface AvatarGenerationOptions {
  /** what the avatar should say (already length-validated by the caller) */
  script: string;
  /** provider voice id or user VoiceProfile id */
  voiceId?: string;
  /** speech speed multiplier, expected range 0.8–1.2 */
  speed?: number;
  /** MediaAsset id of a reference face image (photo avatar), if supported */
  referenceImageAssetId?: string;
  aspectRatio?: "9:16" | "1:1" | "16:9";
}

// Documented result shape for future concrete providers (no concrete provider is
// implemented yet — heygen's generate() refuses honestly below).
export interface AvatarGenerationResult {
  /** provider-side job id, used for async polling */
  providerJobId: string;
  status: "SUBMITTED" | "PROCESSING" | "SUCCESS" | "FAIL";
  /** final video URL, defined once status === "SUCCESS" */
  videoUrl?: string;
  /** suggested client polling interval in seconds (async providers) */
  pollAfterSec?: number;
  meta?: Record<string, unknown>;
}

export interface AvatarProviderAdapter {
  id(): string;
  /** true only when the provider can actually be called (env key present). Server-side only. */
  isConfigured(): boolean;
  requiredEnvKeys(): string[];
  capabilities(): AvatarCapabilities;
  generate(opts: AvatarGenerationOptions): Promise<AvatarGenerationResult>;
}

// ---------- heygen adapter (BLOCKED_EXTERNAL — honest placeholder) ----------

const HEYGEN_CAPS: AvatarCapabilities = {
  supportsTalkingHead: true,
  supportsVoiceClone: true,
  maxScriptChars: 5000,
  resolution: ["720p", "1080p"],
};

const isHeygenConfigured = () => Boolean(process.env.HEYGEN_API_KEY);

const heygenAdapter: AvatarProviderAdapter = {
  id: () => "heygen",
  isConfigured: isHeygenConfigured,
  requiredEnvKeys: () => ["HEYGEN_API_KEY"],
  capabilities: () => HEYGEN_CAPS,
  async generate() {
    if (!isHeygenConfigured()) {
      throw new ApiError(
        503,
        "BLOCKED_EXTERNAL",
        "Talking-avatar generation is not available in this environment — no provider API key configured",
        {
          blockedBy: ["heygen (BLOCKED_EXTERNAL — no HEYGEN_API_KEY)"],
          requiredSetup: ["HEYGEN_API_KEY"],
          pluginSlot: PLUGIN_SLOT,
        },
      );
    }
    // Honest refusal even WITH a key: the HeyGen HTTP client is simply not
    // implemented yet. Plugin slot — implement here (HeyGen API v2):
    //   POST /v2/video/avatar { video_inputs: [{ character, voice, script }] }
    //   → poll /v1/video_status.get until status === "completed".
    throw new ApiError(
      503,
      "NOT_IMPLEMENTED",
      "heygen adapter has no implemented generate() yet — the plugin slot in src/lib/avatar/adapter.ts is open",
      { blockedBy: ["heygen (generate() not implemented — plugin slot open)"], requiredSetup: ["HEYGEN_API_KEY"], pluginSlot: PLUGIN_SLOT },
    );
  },
};

// ---------- adapter registry (one-object addition per future provider) ----------

const ADAPTERS: Record<string, AvatarProviderAdapter> = {
  heygen: heygenAdapter,
};

export function getAvatarAdapter(providerId = "heygen"): AvatarProviderAdapter | null {
  return ADAPTERS[providerId] ?? null;
}

export interface AvatarProviderReport {
  providerId: string;
  configured: boolean;
  requiredEnvKeys: string[];
  capabilities: AvatarCapabilities;
  /** status from PROVIDER_REGISTRY (e.g. BLOCKED_EXTERNAL) */
  registryStatus: string;
  statusNote?: string;
  supportsHealthCheck: boolean;
  /** from the registry's model descriptor; null when the provider exposes no models yet */
  latencyClass: string | null;
}

/** Self-inspection used by the capabilities action — reports facts, never fakes availability. */
export function listAvatarProviders(): AvatarProviderReport[] {
  return Object.values(ADAPTERS).map((a) => {
    const reg = getProvider(a.id());
    return {
      providerId: a.id(),
      configured: a.isConfigured(),
      requiredEnvKeys: a.requiredEnvKeys(),
      capabilities: a.capabilities(),
      registryStatus: reg?.status ?? "NOT_IN_REGISTRY",
      statusNote: reg?.statusNote,
      supportsHealthCheck: reg?.supportsHealthCheck ?? false,
      latencyClass: reg?.models[0]?.latencyClass ?? null,
    };
  });
}

export interface AvatarRoute {
  providerId: string;
  adapter: AvatarProviderAdapter;
  capabilities: AvatarCapabilities;
}

export interface AvatarRouteDecision {
  route: AvatarRoute | null;
  blockedBy: string[];
  providers: { providerId: string; configured: boolean; requiredEnvKeys: string[] }[];
}

/**
 * Resolve the best available avatar route.
 * Honest contract: `route` stays null until an adapter is BOTH configured AND
 * implemented. Today that is never the case (heygen has no key and no generate()
 * implementation), so every call reports the blocking reasons verbatim.
 */
export function resolveAvatarRoute(): AvatarRouteDecision {
  const providers = Object.values(ADAPTERS).map((a) => ({
    providerId: a.id(),
    configured: a.isConfigured(),
    requiredEnvKeys: a.requiredEnvKeys(),
  }));
  const blockedBy: string[] = providers.map((p) =>
    p.configured
      ? `${p.providerId} (key present — generate() not implemented yet, plugin slot: ${PLUGIN_SLOT})`
      : `${p.providerId} (BLOCKED_EXTERNAL — no ${p.requiredEnvKeys.join(" + ")})`,
  );
  return { route: null, blockedBy, providers };
}
