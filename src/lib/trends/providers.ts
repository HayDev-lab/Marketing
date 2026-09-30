// Trend provider registry. Today only the web-search provider is configured;
// the rest are honest placeholders that report NOT_CONFIGURED instead of
// faking results. Adding a real source later = implement TrendProvider and
// register it here — no engine changes required.

import { webSearch, isSafeExternalUrl } from "@/lib/ai/zai";
import {
  type TrendProvider,
  type TrendProviderSearchResult,
  type RawTrendSource,
  classifyProviderError,
} from "./types";

// ---------- zai web search (live, the one real provider today) ----------

const webSearchProvider: TrendProvider = {
  id: "zai-web-search",
  getCapabilities() {
    return {
      id: this.id,
      label: "Web Search",
      configured: true,
      statusNote: "live",
      supportsRecency: true,
      maxResults: 10,
    };
  },
  async healthCheck() {
    const { healthCheck: zaiHealth } = await import("@/lib/ai/zai");
    return zaiHealth("zai-research");
  },
  async search(params): Promise<TrendProviderSearchResult> {
    try {
      const res = await webSearch({
        query: params.query,
        num: Math.min(params.limit, this.getCapabilities().maxResults),
        recencyDays: params.recencyDays,
      });
      const all: RawTrendSource[] = (res ?? [])
        .filter((s) => typeof s?.url === "string" && isSafeExternalUrl(s.url))
        .map((s) => ({
          name: String(s.name ?? "").slice(0, 300),
          url: String(s.url),
          snippet: String(s.snippet ?? "").slice(0, 600),
          host: String(s.host_name ?? "").slice(0, 120),
          date: typeof s.date === "string" ? s.date : null,
        }));
      const seen = new Set<string>();
      const sources = all.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
      return { providerId: this.id, sources, empty: sources.length === 0 };
    } catch (e) {
      // honest failure — engine decides how to degrade (never fabricates)
      return { providerId: this.id, sources: [], empty: true, error: classifyProviderError(e) };
    }
  },
};

// ---------- honest placeholders (architecture-ready, NOT live) ----------

function notConfiguredProvider(
  id: string,
  label: string,
  note: string,
): TrendProvider {
  return {
    id,
    getCapabilities() {
      return { id, label, configured: false, statusNote: note, supportsRecency: false, maxResults: 0 };
    },
    async healthCheck() {
      return { ok: false, reason: note };
    },
    async search() {
      return {
        providerId: id,
        sources: [],
        empty: true,
        error: { kind: "UNAVAILABLE", message: `${label}: not configured (${note})`, retryable: false },
      };
    },
  };
}

const rssProvider = notConfiguredProvider(
  "rss",
  "RSS Feeds",
  "add feed URLs in a future release",
);
const googleTrendsProvider = notConfiguredProvider(
  "google-trends",
  "Google Trends",
  "requires a Trends-compatible API key",
);
const manualProvider = notConfiguredProvider(
  "manual",
  "Manual URL",
  "paste-source flow is planned",
);

const REGISTRY: Record<string, TrendProvider> = {
  [webSearchProvider.id]: webSearchProvider,
  [rssProvider.id]: rssProvider,
  [googleTrendsProvider.id]: googleTrendsProvider,
  [manualProvider.id]: manualProvider,
};

export function getTrendProvider(id: string): TrendProvider | null {
  return REGISTRY[id] ?? null;
}

export function listTrendProviders(): TrendProvider[] {
  return Object.values(REGISTRY);
}
