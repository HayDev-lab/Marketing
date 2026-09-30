// Prompt compiler — the single reusable layer that turns (trend + business +
// platform + goal) into a PROVIDER-SPECIFIC generation prompt. The same
// creative idea must not be fed verbatim to every model: each provider family
// has its own grammar (descriptor lists vs. scene sequencing vs. natural
// language direction). Adding a future provider = add a profile entry; no
// call-site changes.

export type MediaType = "image" | "video" | "text";

export interface BusinessProfileInput {
  name: string;
  tone?: string | null;
  positioning?: string | null;
  summary?: string | null;
  audience?: string | null;
}

export interface TrendProfileInput {
  title: string;
  summary?: string | null;
}

export interface CompileCreativeInput {
  provider: string; // "zai-image" | "gemini-image" | "openai-image" | "flux" | "veo" | "kling" | "runway" | "zai-video" | ...
  model?: string;
  mediaType: MediaType;
  business: BusinessProfileInput;
  trend: TrendProfileInput;
  adaptation?: {
    concept?: string | null;
    hook?: string | null;
    visualDirection?: string | null;
  } | null;
  platform: string;
  contentGoal?: string;
  durationSec?: number;
  language: string;
  brandStyle?: string;
  characterProfile?: string | null;
  referenceAssets?: string[];
}

interface ProviderProfile {
  /** prompt grammar family */
  grammar: "descriptors" | "scenes" | "natural";
  technical: string[];
  /** guardrail sentence appended verbatim */
  guard?: string;
}

const IMAGE_PROFILES: Record<string, ProviderProfile> = {
  "zai-image": {
    grammar: "descriptors",
    technical: ["high resolution", "clean composition", "no text overlay unless specified"],
  },
  "gemini-image": {
    grammar: "natural",
    technical: ["photorealistic or stylized per brand", "accurate text rendering when text is requested"],
    guard: "Avoid brand logos, real faces of public figures, and watermarks.",
  },
  "openai-image": {
    grammar: "natural",
    technical: ["clear focal subject", "balanced lighting", "no embedded watermarks"],
  },
  flux: {
    grammar: "descriptors",
    technical: ["sharp details", "cinematic depth of field", "8k quality"],
  },
  ideogram: {
    grammar: "natural",
    technical: ["typography-friendly composition"],
  },
  recraft: {
    grammar: "descriptors",
    technical: ["vector-friendly shapes", "brand palette coherence"],
  },
};

const VIDEO_PROFILES: Record<string, ProviderProfile> = {
  "zai-video": {
    grammar: "scenes",
    technical: ["smooth motion", "single continuous shot", "no subtitles burned in"],
  },
  veo: {
    grammar: "scenes",
    technical: ["cinematic camera movement", "consistent lighting across scenes", "native audio optional"],
  },
  kling: {
    grammar: "scenes",
    technical: ["strong subject consistency", "realistic physics"],
  },
  runway: {
    grammar: "scenes",
    technical: ["stylized motion", "clean frame transitions"],
  },
  seedance: {
    grammar: "scenes",
    technical: ["rhythmic movement matching the hook", "vertical 9:16 framing"],
  },
  hailuo: {
    grammar: "scenes",
    technical: ["expressive character motion", "compact scene count"],
  },
};

const GENERIC_PROFILE: ProviderProfile = { grammar: "natural", technical: ["high quality"] };

function profileFor(provider: string, mediaType: MediaType): ProviderProfile {
  const table = mediaType === "image" ? IMAGE_PROFILES : mediaType === "video" ? VIDEO_PROFILES : null;
  if (!table) return GENERIC_PROFILE;
  return table[provider] ?? GENERIC_PROFILE;
}

function platformGrammar(platform: string, mediaType: MediaType): string {
  const p = platform.toLowerCase();
  if (mediaType === "image") {
    if (p === "instagram") return "vertical 4:5 feed image, thumb-stopping first frame";
    if (p === "tiktok") return "vertical 9:16 cover frame that works as a video hook";
    if (p === "facebook") return "square-friendly 1:1 composition readable in feed";
    if (p === "telegram") return "clean 16:9 preview image readable at small size";
    return "social-feed optimized composition";
  }
  if (p === "instagram") return "vertical 9:16 reel, dynamic first 2 seconds";
  if (p === "tiktok") return "vertical 9:16, native fast-cut energy";
  if (p === "facebook") return "feed autoplay video, story readable without sound";
  if (p === "telegram") return "compact loopable clip";
  return "short-form social video";
}

function descriptorPrompt(parts: string[]): string {
  return parts.filter(Boolean).join(", ");
}

function naturalPrompt(paragraphs: string[]): string {
  return paragraphs.filter(Boolean).join("\n\n");
}

function scenePrompt(scenes: string[], durationSec: number): string {
  const count = Math.max(2, Math.min(5, Math.round(durationSec / 8) + 1));
  const beats = scenes.slice(0, count);
  return beats.map((s, i) => `Scene ${i + 1}: ${s}`).join("\n");
}

/**
 * Compile a provider-specific prompt. Never returns one shared string for all
 * providers: descriptors models get comma lists, scene models get numbered
 * beats, natural-language models get paragraphs.
 */
export function compileCreativePrompt(input: CompileCreativeInput): string {
  const profile = profileFor(input.provider, input.mediaType);
  const brand = input.business;
  const trend = input.trend;
  const langNote =
    input.mediaType === "text"
      ? `Write the copy in ${input.language}.`
      : `Any on-screen text must be minimal and in ${input.language}.`;
  const goal = input.contentGoal ? `Content goal: ${input.contentGoal}.` : "";
  const platformNote = platformGrammar(input.platform, input.mediaType);
  const style = input.brandStyle || brand.tone || "clean modern premium";
  const duration = input.durationSec ?? (input.mediaType === "video" ? 15 : 0);
  const char = input.characterProfile ? `Character consistency: ${input.characterProfile}.` : "";
  const refs = input.referenceAssets?.length ? `Reference assets: ${input.referenceAssets.join("; ")}.` : "";

  const core = {
    subject:
      input.adaptation?.concept ||
      trend.summary?.slice(0, 300) ||
      `a creative take on the trend "${trend.title}"`,
    brand: `Brand: ${brand.name}. Tone: ${style}. Positioning: ${brand.positioning ?? "n/a"}.`,
    trend: `Creative springboard (do not copy 1:1, extract the mechanic): ${trend.title} — ${trend.summary ?? ""}`.trim(),
    visual: input.adaptation?.visualDirection || "",
    hook: input.adaptation?.hook ? `Hook: ${input.adaptation.hook}` : "",
  };

  if (input.mediaType === "image") {
    if (profile.grammar === "descriptors") {
      return descriptorPrompt([
        core.visual || core.subject,
        `${brand.name} brand imagery`,
        style,
        platformNote,
        ...profile.technical,
        input.model ? `model: ${input.model}` : "",
        refs,
        profile.guard ?? "",
      ]);
    }
    return naturalPrompt([
      `${core.trend}`,
      `Create a single image for ${brand.name}: ${core.subject}. ${core.visual}`,
      `${platformNote}. ${style} aesthetic. ${goal} ${char} ${refs}`,
      profile.technical.join(". ") + ".",
      langNote,
      profile.guard ?? "",
    ]);
  }

  if (input.mediaType === "video") {
    const beats = [
      core.hook || `Open on the strongest visual of: ${core.subject}`,
      core.visual || `Show ${brand.name}'s product/experience in the trend's context`,
      `Close with the brand signature and a subtle CTA`,
    ];
    return naturalPrompt([
      core.trend,
      scenePrompt(beats, duration),
      `${platformNote}. Style: ${style}. Duration: ${duration}s. ${goal}`,
      profile.technical.join(". ") + ".",
      `${langNote} ${char} ${refs}`,
      profile.guard ?? "No real brand logos, no public figures, no burned-in captions.",
    ]);
  }

  // text — provider grammar barely applies; the pipeline uses LLM directly
  return naturalPrompt([
    `${core.trend}`,
    `Write platform-native copy for ${brand.name} (${input.platform}) in ${input.language}.`,
    `${core.hook} ${core.subject}`.trim(),
    `Goal: ${input.contentGoal || "engagement"}. Tone: ${style}.`,
  ]);
}

/** Which media providers exist per media type — for honest UI boundary notes. */
export function mediaProviderOptions(mediaType: MediaType): { id: string; live: boolean }[] {
  if (mediaType === "image") {
    return [
      { id: "zai-image", live: true },
      { id: "gemini-image", live: false },
      { id: "openai-image", live: false },
      { id: "flux", live: false },
      { id: "ideogram", live: false },
      { id: "recraft", live: false },
    ];
  }
  if (mediaType === "video") {
    return [
      { id: "zai-video", live: true },
      { id: "veo", live: false },
      { id: "kling", live: false },
      { id: "runway", live: false },
      { id: "seedance", live: false },
      { id: "hailuo", live: false },
    ];
  }
  return [{ id: "zai-core", live: true }];
}
