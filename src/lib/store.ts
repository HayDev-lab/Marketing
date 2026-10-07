"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Locale } from "@/lib/i18n";

export type ViewId =
  | "create"
  | "autopilot"
  | "assets"
  | "dashboard"
  | "brands"
  | "trends"
  | "planner"
  | "content"
  | "prompts"
  | "image"
  | "video"
  | "voice"
  | "music"
  | "avatar"
  | "publishing"
  | "analytics"
  | "settings"
  | "admin"
  | "mcp";

// Marketing Signal Core states — the WebGL heart reacts to these
export type CoreState =
  | "WAITING_APPROVAL"
  | "AUTOPILOT_ACTIVE"
  | "IDLE"
  | "ANALYZING"
  | "TREND_SEARCH"
  | "PLANNING"
  | "GENERATING"
  | "PUBLISHING"
  | "SUCCESS"
  | "ERROR";

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  locale: string;
  isAdmin?: boolean;
}

interface AppState {
  user: SessionUser | null;
  locale: Locale;
  view: ViewId;
  activeBrandId: string | null;
  mode: "manual" | "autopilot";
  coreState: CoreState;
  /** Transient: content item id that Content should auto-open once on next mount (trend → draft bridge). */
  contentSeed: string | null;
  setUser: (u: SessionUser | null) => void;
  setLocale: (l: Locale) => void;
  setView: (v: ViewId) => void;
  setActiveBrand: (id: string | null) => void;
  setMode: (m: "manual" | "autopilot") => void;
  setCoreState: (s: CoreState) => void;
  setContentSeed: (id: string | null) => void;
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      locale: "hy",
      view: "dashboard",
      activeBrandId: null,
      mode: "manual",
      coreState: "IDLE",
      contentSeed: null,
      setUser: (user) => set({ user }),
      setLocale: (locale) => set({ locale }),
      setView: (view) => set({ view }),
      setActiveBrand: (activeBrandId) => set({ activeBrandId }),
      setMode: (mode) => set({ mode }),
      setCoreState: (coreState) => set({ coreState }),
      setContentSeed: (contentSeed) => set({ contentSeed }),
    }),
    {
      name: "haydev-app",
      partialize: (s) => ({ locale: s.locale, view: s.view, mode: s.mode, activeBrandId: s.activeBrandId }),
    }
  )
);

// Convenience: signal core briefly, then return to IDLE
let coreTimer: ReturnType<typeof setTimeout> | null = null;
export function pulseCore(state: CoreState, ms = 4000) {
  const { setCoreState } = useApp.getState();
  setCoreState(state);
  if (coreTimer) clearTimeout(coreTimer);
  coreTimer = setTimeout(() => setCoreState("IDLE"), ms);
}
