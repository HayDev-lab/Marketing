// Fingerprinting for TREND_SEARCH idempotency (durable-job level) and
// per-run bucketing. Identical searches (same business, market, language,
// platform, query, within the same time bucket) map to the same job —
// repeated submits return the existing job instead of spawning duplicates.

import { createHash } from "crypto";

export interface TrendSearchKeyInput {
  userId: string;
  brandId?: string | null;
  market: string;
  language: string;
  platform: string;
  query: string;
  recencyDays: number;
  /** time bucket in hours — identical searches in the same bucket dedupe */
  bucketHours?: number;
}

export function searchFingerprint(input: TrendSearchKeyInput): string {
  const bucketHours = input.bucketHours ?? 1;
  const now = Date.now();
  const bucket = Math.floor(now / (bucketHours * 3_600_000));
  const basis = JSON.stringify({
    u: input.userId,
    b: input.brandId ?? "",
    m: input.market.toLowerCase().trim(),
    l: input.language,
    p: input.platform,
    q: input.query.toLowerCase().replace(/\s+/g, " ").trim(),
    r: input.recencyDays,
    t: bucket,
  });
  return createHash("sha256").update(basis).digest("hex").slice(0, 24);
}

export function trendSearchIdempotencyKey(userId: string, fingerprint: string): string {
  return `trendsearch:${userId}:${fingerprint}`;
}
