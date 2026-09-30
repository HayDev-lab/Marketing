// Capability Router + Provider Registry — single source of truth for AI capabilities.
// All AI calls go through this registry. No provider-specific logic in business/UI code.

export type Capability =
  | "LLM"
  | "VISION"
  | "WEB_RESEARCH"
  | "PAGE_READ"
  | "IMAGE_GENERATION"
  | "IMAGE_EDIT"
  | "IMAGE_SEARCH"
  | "VIDEO_GENERATION"
  | "TTS"
  | "TRANSCRIPTION"
  | "TRANSLATION"
  | "MUSIC_GENERATION"
  | "VOICE_CLONING"
  | "AVATAR_VIDEO";

export type ProviderStatus =
  | "LIVE_VERIFIED"
  | "IMPLEMENTED_NOT_LIVE_VERIFIED"
  | "DEGRADED"
  | "DISABLED"
  | "BLOCKED_EXTERNAL";

export interface ModelDescriptor {
  id: string;
  title: string;
  capabilities: Capability[];
  constraints: {
    sizes?: string[];
    durationsSec?: number[];
    aspectRatios?: string[];
    languages?: string[];
    voices?: string[];
    maxInputChars?: number;
    referenceImage?: boolean;
    continuation?: boolean;
  };
  estimatedCostPerCall?: number;
  latencyClass: "fast" | "medium" | "slow";
}

export interface ProviderDescriptor {
  providerId: string;
  title: string;
  category: string;
  capabilities: Capability[];
  models: ModelDescriptor[];
  status: ProviderStatus;
  statusNote?: string;
  requiresExternalKey?: boolean;
  supportsHealthCheck: boolean;
  defaultModel?: string;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}
export interface HealthResult {
  ok: boolean;
  latencyMs?: number;
  reason?: string;
}

export interface ProviderSubmitResult {
  providerJobId?: string; // defined for async providers
  sync?: boolean; // result resolved inline
  output?: unknown;
}

export interface ProviderJobStatusInfo {
  status: "PROCESSING" | "SUCCESS" | "FAIL";
  outputUrl?: string;
  error?: string;
}

// ---------- Registry ----------

export const PROVIDER_REGISTRY: ProviderDescriptor[] = [
  {
    providerId: "zai-core",
    title: "Z.AI Core (GLM)",
    category: "LLM",
    capabilities: ["LLM", "VISION", "TRANSLATION"],
    models: [
      {
        id: "glm-4.6",
        title: "GLM-4.6",
        capabilities: ["LLM", "VISION", "TRANSLATION"],
        constraints: { languages: ["hy", "ru", "en"], maxInputChars: 100_000 },
        latencyClass: "medium",
      },
    ],
    status: "IMPLEMENTED_NOT_LIVE_VERIFIED",
    supportsHealthCheck: true,
    defaultModel: "glm-4.6",
  },
  {
    providerId: "zai-image",
    title: "Z.AI Image Cloud",
    category: "Image",
    capabilities: ["IMAGE_GENERATION", "IMAGE_EDIT"],
    models: [
      {
        id: "image-gen-v2",
        title: "Image Gen v2",
        capabilities: ["IMAGE_GENERATION", "IMAGE_EDIT"],
        constraints: {
          sizes: ["1024x1024", "768x1344", "864x1152", "1344x768", "1152x864", "1440x720", "720x1440"],
          aspectRatios: ["1:1", "9:16", "3:4", "16:9", "4:3", "2:1", "1:2"],
          referenceImage: true,
        },
        estimatedCostPerCall: 0.02,
        latencyClass: "medium",
      },
    ],
    status: "IMPLEMENTED_NOT_LIVE_VERIFIED",
    supportsHealthCheck: true,
    defaultModel: "image-gen-v2",
  },
  {
    providerId: "zai-video",
    title: "Z.AI Video Cloud",
    category: "Video",
    capabilities: ["VIDEO_GENERATION"],
    models: [
      {
        id: "video-gen-async",
        title: "Video Gen Async",
        capabilities: ["VIDEO_GENERATION"],
        constraints: {
          durationsSec: [5, 10],
          aspectRatios: ["16:8", "9:16", "1:1"],
          referenceImage: true,
          sizes: ["1280x720", "720x1280", "1024x1024"],
        },
        estimatedCostPerCall: 0.1,
        latencyClass: "slow",
      },
    ],
    status: "IMPLEMENTED_NOT_LIVE_VERIFIED",
    supportsHealthCheck: true,
    defaultModel: "video-gen-async",
  },
  {
    providerId: "zai-tts",
    title: "Z.AI TTS Cloud",
    category: "TTS",
    capabilities: ["TTS"],
    models: [
      {
        id: "tts-v1",
        title: "TTS v1",
        capabilities: ["TTS"],
        constraints: { voices: ["tongtong"], languages: ["hy", "ru", "en", "zh"], maxInputChars: 2000 },
        latencyClass: "fast",
      },
    ],
    status: "IMPLEMENTED_NOT_LIVE_VERIFIED",
    supportsHealthCheck: true,
    defaultModel: "tts-v1",
  },
  {
    providerId: "zai-research",
    title: "Z.AI Research (Web Search + Reader)",
    category: "Research",
    capabilities: ["WEB_RESEARCH", "PAGE_READ"],
    models: [
      {
        id: "web-search",
        title: "Web Search",
        capabilities: ["WEB_RESEARCH", "PAGE_READ"],
        constraints: {},
        latencyClass: "fast",
      },
    ],
    status: "IMPLEMENTED_NOT_LIVE_VERIFIED",
    supportsHealthCheck: true,
    defaultModel: "web-search",
  },
  {
    providerId: "zai-asr",
    title: "Z.AI Transcription",
    category: "Transcription",
    capabilities: ["TRANSCRIPTION"],
    models: [{ id: "asr-v1", title: "ASR v1", capabilities: ["TRANSCRIPTION"], constraints: {}, latencyClass: "medium" }],
    status: "IMPLEMENTED_NOT_LIVE_VERIFIED",
    supportsHealthCheck: false,
    defaultModel: "asr-v1",
  },
  {
    providerId: "gemini-tts",
    title: "Google Gemini TTS",
    category: "TTS",
    capabilities: ["TTS"],
    models: [],
    status: "BLOCKED_EXTERNAL",
    statusNote: "No GOOGLE_API_KEY configured in this environment. Adapter interface ready; requires key to activate.",
    requiresExternalKey: true,
    supportsHealthCheck: false,
  },
  {
    providerId: "haydev-synth",
    title: "HayDev Synth (built-in composer)",
    category: "Music",
    capabilities: ["MUSIC_GENERATION"],
    models: [
      {
        id: "synth-v1",
        title: "Algorithmic Composer v1",
        capabilities: ["MUSIC_GENERATION"],
        constraints: {
          durationsSec: [10, 15, 20, 30, 45, 60],
          languages: [],
        },
        estimatedCostPerCall: 0,
        latencyClass: "fast",
      },
    ],
    status: "IMPLEMENTED_NOT_LIVE_VERIFIED",
    statusNote: "Built-in algorithmic composer: renders real WAV audio locally (instrumental only — no vocals/lyrics). No external API, zero cost.",
    supportsHealthCheck: false,
    defaultModel: "synth-v1",
  },
  {
    providerId: "elevenlabs",
    title: "ElevenLabs (Voice Clone / Music)",
    category: "VoiceClone",
    capabilities: ["VOICE_CLONING", "MUSIC_GENERATION", "TTS"],
    models: [],
    status: "BLOCKED_EXTERNAL",
    statusNote: "No ELEVENLABS_API_KEY configured in this environment. Adapter interface ready; requires key to activate.",
    requiresExternalKey: true,
    supportsHealthCheck: false,
  },
  {
    providerId: "heygen",
    title: "HeyGen (Talking Avatar)",
    category: "Avatar",
    capabilities: ["AVATAR_VIDEO"],
    models: [],
    status: "BLOCKED_EXTERNAL",
    statusNote: "No HEYGEN_API_KEY configured in this environment. Adapter interface ready; requires key to activate.",
    requiresExternalKey: true,
    supportsHealthCheck: false,
  },
  {
    providerId: "meta-social",
    title: "Meta / Instagram / Facebook Graph API",
    category: "Publishing",
    capabilities: [],
    models: [],
    status: "BLOCKED_EXTERNAL",
    statusNote: "Requires Meta developer app + OAuth credentials. Publishing pipeline implemented with honest NOT_AVAILABLE mode.",
    requiresExternalKey: true,
    supportsHealthCheck: false,
  },
  {
    providerId: "tiktok-social",
    title: "TikTok Content Posting API",
    category: "Publishing",
    capabilities: [],
    models: [],
    status: "BLOCKED_EXTERNAL",
    statusNote: "Requires TikTok developer app approval. Publishing pipeline implemented with honest USER_ACTION_REQUIRED mode.",
    requiresExternalKey: true,
    supportsHealthCheck: false,
  },
  {
    providerId: "telegram-bot",
    title: "Telegram Bot API",
    category: "Publishing",
    capabilities: [],
    models: [],
    status: "BLOCKED_EXTERNAL",
    statusNote: "Requires TELEGRAM_BOT_TOKEN. Adapter ready; channel posting available once configured.",
    requiresExternalKey: true,
    supportsHealthCheck: false,
  },
];

export function getProvider(providerId: string): ProviderDescriptor | undefined {
  return PROVIDER_REGISTRY.find((p) => p.providerId === providerId);
}

export function getProviderModel(providerId: string, modelId?: string): ModelDescriptor | undefined {
  const p = getProvider(providerId);
  if (!p) return undefined;
  if (modelId) return p.models.find((m) => m.id === modelId);
  return p.models.find((m) => m.id === p.defaultModel) ?? p.models[0];
}

export interface RouteRequest {
  capability: Capability;
  userPreferenceModel?: string;
  userPreferenceProvider?: string;
  language?: string;
  budgetCeiling?: number;
  aspectRatio?: string;
  durationSec?: number;
  referenceImage?: boolean;
}

export interface RouteDecision {
  providerId: string;
  modelId: string;
  reason: string;
  fallbackProviderId?: string;
  status: ProviderStatus;
}

// Capability Router — chooses provider/model from registry, honoring user preference and constraints.
export function routeCapability(req: RouteRequest): RouteDecision | null {
  const candidates: { provider: ProviderDescriptor; model: ModelDescriptor; reason: string }[] = [];
  for (const provider of PROVIDER_REGISTRY) {
    if (provider.status === "DISABLED" || provider.status === "BLOCKED_EXTERNAL") continue;
    for (const model of provider.models) {
      if (!model.capabilities.includes(req.capability)) continue;
      const reasons: string[] = [];
      if (req.userPreferenceProvider === provider.providerId) reasons.push("user-selected provider");
      if (req.userPreferenceModel === model.id) reasons.push("user-selected model");
      if (req.language && model.constraints.languages && model.constraints.languages.includes(req.language))
        reasons.push(`supports language ${req.language}`);
      if (req.aspectRatio && model.constraints.aspectRatios?.includes(req.aspectRatio))
        reasons.push(`supports aspect ${req.aspectRatio}`);
      if (req.durationSec && model.constraints.durationsSec?.some((d) => d >= req.durationSec!))
        reasons.push("supports requested duration");
      if (req.referenceImage && model.constraints.referenceImage) reasons.push("supports reference image");
      candidates.push({
        provider,
        model,
        reason: reasons.length ? reasons.join(", ") : "registry default",
      });
    }
  }
  if (!candidates.length) return null;
  const preferred = candidates.find((c) => c.reason.includes("user-selected"));
  const chosen = preferred ?? candidates[0];
  return {
    providerId: chosen.provider.providerId,
    modelId: chosen.model.id,
    reason: chosen.reason,
    fallbackProviderId: candidates.find((c) => c.provider.providerId !== chosen.provider.providerId)?.provider.providerId,
    status: chosen.provider.status,
  };
}
