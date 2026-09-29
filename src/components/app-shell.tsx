"use client";

import { useState } from "react";
import { useApp, type ViewId } from "@/lib/store";
import { useI18n, api } from "@/lib/use-i18n";
import { SignalCore } from "@/components/signal-core";
import { DashboardModule } from "@/components/modules/dashboard";
import { BrandsModule } from "@/components/modules/brands";
import { TrendsModule } from "@/components/modules/trends";
import { PlannerModule } from "@/components/modules/planner";
import { ContentModule } from "@/components/modules/content";
import { PromptLibraryModule } from "@/components/modules/prompt-library";
import { ImageStudioModule } from "@/components/modules/image-studio";
import { VideoStudioModule } from "@/components/modules/video-studio";
import { VoiceModule } from "@/components/modules/voice";
import { PublishingModule } from "@/components/modules/publishing";
import { AnalyticsModule } from "@/components/modules/analytics";
import { SettingsModule } from "@/components/modules/settings";
import { McpModule } from "@/components/modules/mcp";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LayoutDashboard, Building2, Flame, CalendarRange, FileStack, Library,
  ImageIcon, Clapperboard, AudioLines, Send, BarChart3, Settings, Plug, LogOut, Menu, X,
} from "lucide-react";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const NAV: { id: ViewId; icon: React.ComponentType<{ className?: string }>; key: string }[] = [
  { id: "dashboard", icon: LayoutDashboard, key: "nav.dashboard" },
  { id: "brands", icon: Building2, key: "nav.brands" },
  { id: "trends", icon: Flame, key: "nav.trends" },
  { id: "planner", icon: CalendarRange, key: "nav.planner" },
  { id: "content", icon: FileStack, key: "nav.content" },
  { id: "prompts", icon: Library, key: "nav.prompts" },
  { id: "image", icon: ImageIcon, key: "nav.image" },
  { id: "video", icon: Clapperboard, key: "nav.video" },
  { id: "voice", icon: AudioLines, key: "nav.voice" },
  { id: "publishing", icon: Send, key: "nav.publishing" },
  { id: "analytics", icon: BarChart3, key: "nav.analytics" },
  { id: "settings", icon: Settings, key: "nav.settings" },
  { id: "mcp", icon: Plug, key: "nav.mcp" },
];

interface AppShellProps {
  brands: { id: string; name: string; stage: string; website: string | null }[];
  onBrandsChanged: () => void;
}

export function AppShell({ brands, onBrandsChanged }: AppShellProps) {
  const { t, locale, setLocale } = useI18n();
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const user = useApp((s) => s.user);
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const coreState = useApp((s) => s.coreState);
  const activeBrandId = useApp((s) => s.activeBrandId);
  const setActiveBrand = useApp((s) => s.setActiveBrand);
  const [navOpen, setNavOpen] = useState(false);

  const logout = async () => {
    await api("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout" }) }).catch(() => {});
    window.location.reload();
  };

  const renderView = () => {
    switch (view) {
      case "dashboard": return <DashboardModule />;
      case "brands": return <BrandsModule onBrandsChanged={onBrandsChanged} />;
      case "trends": return <TrendsModule />;
      case "planner": return <PlannerModule />;
      case "content": return <ContentModule />;
      case "prompts": return <PromptLibraryModule />;
      case "image": return <ImageStudioModule />;
      case "video": return <VideoStudioModule />;
      case "voice": return <VoiceModule />;
      case "publishing": return <PublishingModule />;
      case "analytics": return <AnalyticsModule />;
      case "settings": return <SettingsModule />;
      case "mcp": return <McpModule />;
      default: return <DashboardModule />;
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* ambient core background */}
      <SignalCore className="fixed inset-0 -z-10 opacity-[0.28]" />

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
          <button className="lg:hidden" onClick={() => setNavOpen(!navOpen)} aria-label="Toggle navigation" aria-expanded={navOpen}>
            {navOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex items-center gap-2" role="status" aria-label={`Core state: ${coreState}`}>
            <span
              className={cn("h-2.5 w-2.5 rounded-full status-dot transition-colors", {
                "bg-[var(--neon)] text-[var(--neon)]": ["IDLE", "SUCCESS"].includes(coreState),
                "bg-[var(--neon-2)] text-[var(--neon-2)]": ["ANALYZING", "PUBLISHING"].includes(coreState),
                "bg-[var(--neon-3)] text-[var(--neon-3)]": coreState === "TREND_SEARCH",
                "bg-fuchsia-400 text-fuchsia-400 animate-pulse-soft": ["GENERATING", "PLANNING"].includes(coreState),
                "bg-destructive text-destructive": coreState === "ERROR",
              })}
            />
            <span className="hidden text-xs font-medium tracking-wide text-muted-foreground sm:inline">{t(`state.${coreState}` as const)}</span>
          </div>

          <div className="mx-auto flex items-center gap-1.5 rounded-full glass px-1 py-1" role="radiogroup" aria-label="Mode">
            {(["manual", "autopilot"] as const).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-all sm:px-4",
                  mode === m ? "bg-[var(--neon)]/25 text-foreground neon-border" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m === "autopilot" ? "⚡ " : "✋ "}{t(`mode.${m}` as const)}
              </button>
            ))}
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <Select value={activeBrandId ?? ""} onValueChange={setActiveBrand}>
              <SelectTrigger className="h-9 w-[170px] text-xs" aria-label="Active brand">
                <SelectValue placeholder={t("dash.noBrand")} />
              </SelectTrigger>
              <SelectContent>
                {brands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1" role="group" aria-label="Language">
              {LOCALES.map((l) => (
                <button
                  key={l}
                  onClick={() => setLocale(l as Locale)}
                  className={cn("rounded px-2 py-1 text-[11px] transition", locale === l ? "bg-[var(--neon)]/20 text-[var(--neon)]" : "text-muted-foreground hover:text-foreground")}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={logout} aria-label={t("auth.logout")} className="text-muted-foreground hover:text-foreground">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside
          className={cn(
            "fixed inset-y-14 left-0 z-30 w-60 transform border-r border-border/70 bg-background/85 backdrop-blur-xl transition-transform lg:static lg:inset-auto lg:z-auto lg:translate-x-0 lg:bg-transparent",
            navOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <ScrollArea className="h-[calc(100vh-8rem)] lg:h-[calc(100vh-7rem)]">
            <nav className="grid gap-1 p-3" aria-label="Main">
              {NAV.map(({ id, icon: Icon, key }) => (
                <button
                  key={id}
                  onClick={() => {
                    setView(id);
                    setNavOpen(false);
                  }}
                  aria-current={view === id ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all",
                    view === id
                      ? "glass text-foreground neon-border shadow-[0_0_20px_oklch(0.72_0.19_315/0.15)]"
                      : "text-muted-foreground hover:bg-[var(--accent)] hover:text-foreground"
                  )}
                >
                  <Icon className={cn("h-4 w-4", view === id && "text-[var(--neon)]")} />
                  {t(key)}
                </button>
              ))}
            </nav>
            <div className="mx-3 mb-4 rounded-xl glass p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t("mode.autopilot")}</span>
                <Switch checked={mode === "autopilot"} onCheckedChange={(v) => setMode(v ? "autopilot" : "manual")} aria-label="Autopilot mode" />
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {mode === "autopilot" ? "Policy-gated automation. Human approval enforced." : "Full manual control at every step."}
              </p>
            </div>
          </ScrollArea>
        </aside>

        {navOpen && <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setNavOpen(false)} aria-hidden />}

        {/* Main content */}
        <main className="min-w-0 flex-1 px-3 py-4 sm:px-6 sm:py-6">
          <div className="mx-auto max-w-7xl">{renderView()}</div>
        </main>
      </div>

      {/* Sticky footer */}
      <footer className="mt-auto border-t border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-muted-foreground sm:px-6">
          <span>© {new Date().getFullYear()} ՀայDev Marketing — {t("app.tagline")}</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[var(--neon-2)] status-dot text-[var(--neon-2)]" />AI Core: cloud</span>
            <span className="hidden sm:inline">{user?.email}</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
