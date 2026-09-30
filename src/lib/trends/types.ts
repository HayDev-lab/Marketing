// Trend Intelligence — provider abstraction & normalized types.
// A TrendProvider is any source of raw trend evidence (web search, RSS, Google
// Trends, social APIs, manual URL input). Providers are honest by contract:
// if a source is not configured or rate-limited, it reports that instead of
// inventing results.

export interface RawTrendSource {
  name: string;
  url: string;
  snippet: string;
  host: string;
  date: string | null;
}

export type ProviderErrorKind =
  | "RATE_LIMITED" // 429 / quota — must back off, never retry forever
  | "AUTH" // 401 / 403 — configuration problem, user action required
  | "TIMEOUT"
  | "MALFORMED" // unparsable provider payload
  | "EMPTY" // provider reachable, zero results
  | "UNAVAILABLE" // network / 5xx / not configured
  | "UNKNOWN";

export interface ProviderErrorInfo {
  kind: ProviderErrorKind;
  message: string;
  retryable: boolean;
}

export interface ProviderCapabilities {
  id: string;
  label: string;
  /** what the provider can actually deliver today */
  configured: boolean;
  /** honest human-readable note shown in the UI when configured=false */
  statusNote?: string;
  supportsRecency: boolean;
  maxResults: number;
}

export interface TrendSearchParams {
  query: string;
  limit: number;
  recencyDays: number;
  market?: string;
  language?: string;
  platform?: string;
}

export interface TrendProviderSearchResult {
  providerId: string;
  sources: RawTrendSource[];
  /** provider responded but returned fewer/empty results */
  empty: boolean;
  error?: ProviderErrorInfo;
}

export interface TrendProvider {
  id: string;
  getCapabilities(): ProviderCapabilities;
  healthCheck(): Promise<{ ok: boolean; latencyMs?: number; reason?: string }>;
  search(params: TrendSearchParams): Promise<TrendProviderSearchResult>;
}

/** Classify any thrown provider error into an honest, retry-bounded bucket. */
export function classifyProviderError(e: unknown): ProviderErrorInfo {
  const raw = e instanceof Error ? e.message : String(e);
  const msg = raw.toLowerCase();
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("quota") || msg.includes("too many")) {
    return { kind: "RATE_LIMITED", message: raw, retryable: true };
  }
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("forbidden") || msg.includes("api key")) {
    return { kind: "AUTH", message: raw, retryable: false };
  }
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("abort")) {
    return { kind: "TIMEOUT", message: raw, retryable: true };
  }
  if (msg.includes("json") || msg.includes("parse") || msg.includes("malformed") || msg.includes("unexpected")) {
    return { kind: "MALFORMED", message: raw, retryable: true };
  }
  if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("fetch failed") || msg.includes("network") || msg.includes("503") || msg.includes("502")) {
    return { kind: "UNAVAILABLE", message: raw, retryable: true };
  }
  return { kind: "UNKNOWN", message: raw, retryable: true };
}
