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
      // persist for the signed-in user only; on the auth screen there is no
      // session — the store already updated optimistically, so a 401 here is
      // expected and must stay silent (no user-facing error, no log noise)
      fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json", ...sessionHeaders() },
        body: JSON.stringify({ action: "locale", locale: l }),
      })
        .then((r) => {
          if (!r.ok && r.status !== 401) console.warn(`locale persist failed (${r.status})`);
        })
        .catch(() => {});
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

// ---- Session token fallback -------------------------------------------------
// The app may run inside a cross-site iframe (preview panels). In that context
// the browser refuses SameSite=Lax cookies, so a cookie-only session never
// sticks and the user is bounced back to the login screen after every request.
// Fix: the auth endpoints also return the raw session token; we keep it in
// localStorage and send it via the `x-session-token` header on every request.
// Media tags (<img>/<video>/<audio>) cannot send headers, so asset URLs get
// `?token=` appended via assetUrl() instead.
const SESSION_TOKEN_KEY = "haydev_session_token";

export function getStoredSessionToken(): string | null {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(SESSION_TOKEN_KEY, token);
    else window.localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // storage unavailable — cookie-only mode still applies where it can
  }
}

function sessionHeaders(): Record<string, string> {
  const token = getStoredSessionToken();
  return token ? { "x-session-token": token } : {};
}

// Append ?token= for media elements that cannot carry headers.
export function assetUrl(path: string): string {
  const token = getStoredSessionToken();
  if (!token) return path;
  return `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

// Single client fetch helper — throws readable errors (actionable UX, not "something went wrong")
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...sessionHeaders(), ...(init?.headers ?? {}) },
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
