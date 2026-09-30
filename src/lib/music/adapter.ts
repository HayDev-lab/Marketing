// MusicProviderAdapter (MASTER PROMPT §25) — plugin architecture for music generation.
//
// Concrete adapters implement this interface; business code never calls a
// provider directly. Currently implemented:
//   - haydev-synth  : built-in algorithmic composer (instrumental, REAL audio)
//     → adapter resolves inline (no external API, no polling).
//   - elevenlabs / suno : BLOCKED_EXTERNAL in this environment (no API key).
//     The adapter interface is ready; routing reports them honestly as blocked.

import { routeCapability } from "@/lib/ai/registry";
import { renderTrack, type RenderOptions, type RenderResult } from "./synth";

export interface MusicCapabilities {
  /** provider can sing lyrics (songs) vs instrumental only */
  supportsLyrics: boolean;
  supportsInstrumental: boolean;
  maxDurationSec: number;
  durationsSec: number[];
}

export interface MusicRoute {
  providerId: string;
  modelId: string;
  capabilities: MusicCapabilities;
}

export interface MusicProviderAdapter {
  id(): string;
  route(): MusicRoute | null; // null = no provider available (honest)
  capabilities(): MusicCapabilities | null;
  generate(opts: RenderOptions): Promise<RenderResult>;
}

// ---------- haydev-synth adapter ----------

const SYNTH_CAPS: MusicCapabilities = {
  supportsLyrics: false,
  supportsInstrumental: true,
  maxDurationSec: 60,
  durationsSec: [10, 15, 20, 30, 45, 60],
};

const synthAdapter: MusicProviderAdapter = {
  id: () => "haydev-synth",
  route() {
    const decision = routeCapability({ capability: "MUSIC_GENERATION", userPreferenceProvider: "haydev-synth" });
    if (!decision) return null;
    return { providerId: decision.providerId, modelId: decision.modelId, capabilities: SYNTH_CAPS };
  },
  capabilities: () => SYNTH_CAPS,
  async generate(opts) {
    return renderTrack(opts);
  },
};

const ADAPTERS: Record<string, MusicProviderAdapter> = {
  "haydev-synth": synthAdapter,
};

export function getMusicAdapter(providerId = "haydev-synth"): MusicProviderAdapter | null {
  return ADAPTERS[providerId] ?? null;
}

/** Resolve the best available music route. Lyrics mode requires supportsLyrics. */
export function resolveMusicRoute(mode: "instrumental" | "soundtrack" | "description" | "song"): { route: MusicRoute | null; blockedBy?: string[] } {
  const synth = synthAdapter.route();
  if (mode === "song") {
    // lyrics-capable providers: check registry routing honestly
    const decision = routeCapability({ capability: "MUSIC_GENERATION" });
    if (!decision || decision.providerId !== "haydev-synth") {
      return { route: null, blockedBy: ["elevenlabs (BLOCKED_EXTERNAL)", "suno (not configured)"] };
    }
    // synth was the only candidate and it cannot sing — honest refusal
    return { route: null, blockedBy: ["elevenlabs (BLOCKED_EXTERNAL)", "suno (not configured)"] };
  }
  return { route: synth };
}

export { SYNTH_CAPS };
