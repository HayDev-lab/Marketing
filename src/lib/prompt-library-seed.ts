// Prompt Library seed — 20 niches × (5 image + 5 video) templates = 200 starters.
// Templates contain editable variables {{like_this}} and brand placeholders.

export interface SeedTemplate {
  niche: string;
  type: "IMAGE" | "VIDEO";
  title: string;
  body: string;
  variables: string[];
  tags: string[];
}

const NICHES = [
  "Restaurants", "Bakery", "Fashion", "Beauty", "Cosmetics",
  "Clinics/Dentistry", "Fitness", "Real Estate", "Construction", "Furniture/Interior",
  "Automotive", "Electronics", "Legal/Accounting", "Education", "Hotels/Tourism",
  "Delivery/Transport", "Flowers/Gifts", "Pets", "Software/AI", "Events/Weddings",
] as const;

const IMAGE_TEMPLATES: { title: string; body: string }[] = [
  {
    title: "Signature Product Hero",
    body: "Ultra-premium advertising photo of {{product}} for {{brand_name}}, hero shot on {{background}}, dramatic rim lighting, shallow depth of field, floating composition, subtle dust particles, color palette {{palette}}, commercial photography, 8k detail, negative space for headline text",
  },
  {
    title: "Lifestyle In-Use Scene",
    body: "Authentic lifestyle photo of a {{audience}} using {{product}} in a natural {{location}} setting, warm golden hour light, candid genuine expression, cinematic color grading, brand aesthetic of {{brand_name}}, editorial magazine quality",
  },
  {
    title: "Promo Offer Card",
    body: "Bold promotional graphic for {{brand_name}} announcing {{offer}}, dynamic diagonal composition, product photo of {{product}} center-right, high contrast {{palette}} color scheme, clean space top-left for price badge, premium retail advertising style",
  },
  {
    title: "Before/After Transformation",
    body: "Split-frame professional photo showing before and after result of {{service}} for {{brand_name}}, left side muted desaturated, right side vibrant polished, clean vertical divider, studio lighting, trust-building commercial aesthetic",
  },
  {
    title: "Team & Trust Portrait",
    body: "Professional team portrait for {{brand_name}}, {{profession}} specialists in modern {{location}} environment, approachable confident expressions, soft window light, corporate premium look, space for trust badge overlay",
  },
];

const VIDEO_TEMPLATES: { title: string; body: string }[] = [
  {
    title: "3-Second Hook Product Reveal",
    body: "Vertical video, hook: {{hook_text}}. Fast camera push-in on {{product}} emerging from shadow into spotlight, dust particles sparkle, punchy micro-zoom on detail, {{brand_name}} color grade {{palette}}, ending frame holds product with copy space",
  },
  {
    title: "Day-in-Life Story Arc",
    body: "Vertical 15s story: scene1 {{audience}} wakes up facing {{pain_point}}, scene2 discovers {{brand_name}} {{product}}, scene3 transformation moment with genuine smile, natural handheld feel, warm cinematic grade, subtle motion blur transitions",
  },
  {
    title: "Process B-Roll Montage",
    body: "Vertical montage of craftsmanship process at {{brand_name}}: close-up macro shots of {{process_steps}}, rhythmic cuts synced to beat, steam/flour/light textures, artisan premium aesthetic, final hero shot of {{product}} with logo reveal",
  },
  {
    title: "Testimonial-Style Monologue",
    body: "Vertical talking-head style video: {{audience}} character looks into camera and shares authentic experience about {{brand_name}}, soft key light on face, shallow depth of field background {{location}}, natural gestures, documentary realism, B-roll cutaway to {{product}} at {{cutaway_time}}",
  },
  {
    title: "Offer Countdown Promo",
    body: "Vertical urgent promo: dynamic typographic overlays showing {{offer}} with countdown numbers, product {{product}} rotating on pedestal, energetic camera orbit, flash transitions, bold {{palette}} gradients, CTA frame '>{{cta}}' with strong final zoom",
  },
];

export function buildSeedTemplates(): SeedTemplate[] {
  const templates: SeedTemplate[] = [];
  for (const niche of NICHES) {
    for (const t of IMAGE_TEMPLATES) {
      templates.push({
        niche,
        type: "IMAGE",
        title: `${niche} — ${t.title}`,
        body: t.body,
        variables: extractVars(t.body),
        tags: ["image", niche.toLowerCase(), "starter"],
      });
    }
    for (const t of VIDEO_TEMPLATES) {
      templates.push({
        niche,
        type: "VIDEO",
        title: `${niche} — ${t.title}`,
        body: t.body,
        variables: extractVars(t.body),
        tags: ["video", niche.toLowerCase(), "starter"],
      });
    }
  }
  return templates;
}

function extractVars(body: string): string[] {
  const vars = new Set<string>();
  const re = /\{\{([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) vars.add(m[1].trim());
  return [...vars];
}

// Hooks & CTA patterns per niche (used by Trend/Planner agents and Copilot)
export const NICHE_HOOKS: Record<string, string[]> = Object.fromEntries(
  NICHES.map((n) => [
    n,
    [
      `Stop scrolling if you ever wanted ${n.toLowerCase()} results`,
      `Nobody tells you this about ${n.toLowerCase()}…`,
      `POV: you found the best ${n.toLowerCase()} in town`,
      `3 things ${n.toLowerCase()} pros never do`,
      `This is what {{price}} gets you at {{brand_name}}`,
    ],
  ])
);

export const CTA_PATTERNS = [
  "DM us '{{keyword}}' to get started",
  "Link in bio",
  "Book your spot today",
  "Visit us this week — {{address}}",
  "Comment 'YES' and we'll reach out",
];
