// Trend deduplication: the same story reaches us through different sources and
// different wordings. We normalize both URL and title; two candidates collapse
// when they point at the same canonical URL OR their token sets are near
// identical (high threshold — genuinely different topics must NOT merge).

import { createHash } from "crypto";
import { jaccard, normalizedTitle, titleTokens } from "./scoring";

const TRACKING_PARAMS = /^(utm_.+|fbclid|gclid|igshid|ref|ref_src|ref_url|cmpid|affiliate|mc_cid|mc_eid|spm|share_.+|sh)$/i;

/** Canonical form of a URL: lowercase host, no www/mobile/amp, no tracking params, no trailing slash. */
export function canonicalUrl(input: string): string {
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    let host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^(m|mobile|amp)\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    const keep: [string, string][] = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (!TRACKING_PARAMS.test(k)) keep.push([k, v]);
    }
    keep.sort(([a], [b]) => a.localeCompare(b));
    const qs = keep.length ? `?${keep.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
    return `${u.protocol}//${host}${path}${qs}`;
  } catch {
    return "";
  }
}

/** Stable dedup key for persistence: canonical URL when valid, else normalized title hash. */
export function trendDedupKey(title: string, url: string | null | undefined): string {
  const cu = url ? canonicalUrl(url) : "";
  const basis = cu || normalizedTitle(title);
  return createHash("sha256").update(basis).digest("hex").slice(0, 24);
}

export interface DedupableItem {
  title?: string;
  name?: string;
  sourceUrl?: string | null;
  url?: string | null;
}

/**
 * Collapse near-identical items. Returns kept items in original order plus the
 * number of duplicates removed. URL equality wins; otherwise token-Jaccard
 * >= 0.82 counts as the same story (conservative — different topics survive).
 */
export function dedupTrends<T extends DedupableItem>(items: T[]): { kept: T[]; duplicates: number } {
  const kept: T[] = [];
  const keptUrls = new Set<string>();
  const keptTokens: Set<string>[] = [];
  let duplicates = 0;
  for (const item of items) {
    const cu = canonicalUrl(item.sourceUrl ?? item.url ?? "");
    if (cu && keptUrls.has(cu)) {
      duplicates++;
      continue;
    }
    const tokens = new Set(titleTokens(item.title ?? item.name ?? ""));
    const nearDuplicate = keptTokens.some((prev) => jaccard(prev, tokens) >= 0.82);
    if (nearDuplicate) {
      duplicates++;
      continue;
    }
    kept.push(item);
    if (cu) keptUrls.add(cu);
    keptTokens.push(tokens);
  }
  return { kept, duplicates };
}

/** Backoff helper for bounded retries: min(base * 2^attempt, capMs). */
export function backoffDelayMs(attempt: number, baseMs = 10_000, capMs = 120_000): number {
  return Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
}
