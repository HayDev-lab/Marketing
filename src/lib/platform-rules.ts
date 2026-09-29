// PlatformRulesRegistry — updatable platform constraints; not hardcoded into prompts permanently.
export interface PlatformRules {
  id: string;
  title: string;
  aspectRatios: string[];
  maxDurationSec: number;
  captionLimit: number;
  hashtagLimit: number;
  thumbnailRequirements: string;
  safeZones: string;
  supportedMedia: string[];
  publishingLimitations: string;
  apiAvailability: "DIRECT_PUBLISH_AVAILABLE" | "DRAFT_TRANSFER_ONLY" | "USER_ACTION_REQUIRED" | "NOT_AVAILABLE";
  notes: string;
}

export const PLATFORM_RULES: Record<string, PlatformRules> = {
  instagram: {
    id: "instagram",
    title: "Instagram",
    aspectRatios: ["9:16", "1:1", "4:5"],
    maxDurationSec: 90,
    captionLimit: 2200,
    hashtagLimit: 30,
    thumbnailRequirements: "JPG, 1080x1350 recommended",
    safeZones: "Top 250px / bottom 310px avoid text overlays in Reels",
    supportedMedia: ["IMAGE", "VIDEO"],
    publishingLimitations: "Graph API publishing requires Instagram Business account linked to Facebook Page",
    apiAvailability: "NOT_AVAILABLE",
    notes: "Direct publishing requires Meta app review + instagram_content_publish permission",
  },
  tiktok: {
    id: "tiktok",
    title: "TikTok",
    aspectRatios: ["9:16"],
    maxDurationSec: 600,
    captionLimit: 2200,
    hashtagLimit: 20,
    thumbnailRequirements: "JPG/WebP, vertical",
    safeZones: "Right side 15% for UI, bottom 20% for caption",
    supportedMedia: ["VIDEO"],
    publishingLimitations: "Content Posting API: direct post requires audited app; unaudited apps get DRAFT_TRANSFER_ONLY",
    apiAvailability: "USER_ACTION_REQUIRED",
    notes: "Without audited developer app — video goes to inbox for manual user post",
  },
  facebook: {
    id: "facebook",
    title: "Facebook",
    aspectRatios: ["16:9", "1:1", "4:5", "9:16"],
    maxDurationSec: 240,
    captionLimit: 63206,
    hashtagLimit: 10,
    thumbnailRequirements: "JPG, min 1200x630",
    safeZones: "Standard video safe areas",
    supportedMedia: ["IMAGE", "VIDEO", "TEXT"],
    publishingLimitations: "Page access token + pages_manage_posts permission required",
    apiAvailability: "NOT_AVAILABLE",
    notes: "Requires Meta developer app with approved permissions",
  },
  telegram: {
    id: "telegram",
    title: "Telegram",
    aspectRatios: ["any"],
    maxDurationSec: 0,
    captionLimit: 1024,
    hashtagLimit: 10,
    thumbnailRequirements: "Any image for preview",
    safeZones: "No strict safe zones",
    supportedMedia: ["IMAGE", "VIDEO", "TEXT", "AUDIO"],
    publishingLimitations: "Bot API requires bot token and channel admin rights",
    apiAvailability: "NOT_AVAILABLE",
    notes: "Bot token configured in Settings enables real posting via Bot API",
  },
};

export function preflightCheck(input: {
  platform: string;
  caption?: string | null;
  mediaDurationSec?: number;
  aspectRatio?: string;
  hasMedia: boolean;
}): { ok: boolean; issues: string[] } {
  const rules = PLATFORM_RULES[input.platform];
  const issues: string[] = [];
  if (!rules) issues.push("Unknown platform");
  if (rules) {
    if (input.caption && input.caption.length > rules.captionLimit) {
      issues.push(`Caption exceeds ${rules.captionLimit} char limit for ${rules.title}`);
    }
    if (input.mediaDurationSec && rules.maxDurationSec > 0 && input.mediaDurationSec > rules.maxDurationSec) {
      issues.push(`Media duration ${input.mediaDurationSec}s exceeds ${rules.title} limit ${rules.maxDurationSec}s`);
    }
    if (input.aspectRatio && !rules.aspectRatios.includes("any") && !rules.aspectRatios.includes(input.aspectRatio)) {
      issues.push(`Aspect ratio ${input.aspectRatio} not recommended for ${rules.title} (${rules.aspectRatios.join(", ")})`);
    }
    if (!input.hasMedia) issues.push("No media attached");
  }
  return { ok: issues.length === 0, issues };
}
