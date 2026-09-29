"use client";

import { useCallback } from "react";
import { useApp } from "@/lib/store";
import { translate, LOCALE_LABELS, LOCALES, type Locale } from "@/lib/i18n";

export function useI18n() {
  const locale = useApp((s) => s.locale);
  const setLocaleStore = useApp((s) => s.setLocale);
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale]
  );
  const setLocale = useCallback(
    (l: Locale) => {
      setLocaleStore(l);
      fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "locale", locale: l }),
      }).catch(() => {});
    },
    [setLocaleStore]
  );
  return { t, locale, setLocale, locales: LOCALES, localeLabels: LOCALE_LABELS };
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

// Single client fetch helper — throws readable errors (actionable UX, not "something went wrong")
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json().catch(() => ({ ok: false, error: { code: "BAD_JSON", message: `HTTP ${res.status}` } }))) as ApiEnvelope<T>;
  if (!res.ok || !json.ok) {
    const err = new Error(json.error?.message ?? `Request failed (${res.status})`);
    (err as Error & { code?: string; details?: unknown }).code = json.error?.code;
    (err as Error & { details?: unknown }).details = json.error?.details;
    throw err;
  }
  return json.data as T;
}
