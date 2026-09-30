// Trend scoring: freshness decay + market relevance heuristics.
// Pure functions — cheap to sanity-check, no IO.

/** Exponential freshness decay with a 7-day half-life, clamped to [0,1]. */
export function freshnessScore(publishedAt: Date | string | null | undefined, now: Date = new Date()): number {
  if (!publishedAt) return 0.35; // unknown age — neutral-low, honest uncertainty
  const t = typeof publishedAt === "string" ? new Date(publishedAt) : publishedAt;
  if (Number.isNaN(t.getTime())) return 0.35;
  const ageDays = Math.max(0, (now.getTime() - t.getTime()) / 86_400_000);
  const score = Math.exp((-Math.LN2 * ageDays) / 7);
  return Math.min(1, Math.max(0, Number(score.toFixed(3))));
}

const STOP = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "your", "you",
  "are", "was", "how", "why", "what", "new", "not", "but", "all", "can", "has",
  "ամեն", "որը", "սա", "եւ", "և", "ինչ", "համար", "նոր", "как", "для", "это",
  "что", "новый", "новые", "тренд", "trend", "trends", "viral",
]);

export function titleTokens(title: string): string[] {
  const cleaned = normalizedTitle(title);
  return Array.from(new Set(cleaned.split(" ").filter((w) => w.length >= 3 && !STOP.has(w))));
}

/** Lowercase, strip punctuation/emoji, collapse whitespace. */
export function normalizedTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Jaccard similarity of token sets. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Keyword overlap share: how many of the given keywords appear in the text. */
export function keywordHitRatio(text: string, keywords: string[]): number {
  if (!keywords.length) return 0;
  const hay = normalizedTitle(text);
  const hits = keywords.filter((k) => k.trim().length >= 2 && hay.includes(normalizedTitle(k))).length;
  return hits / keywords.length;
}

export function clamp01(v: unknown, fallback = 0.5): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}
