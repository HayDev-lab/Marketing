"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useApp, type ViewId } from "@/lib/store";
import { api, useI18n, setStoredSessionToken } from "@/lib/use-i18n";
import { Home, Plus, Radar, CalendarDays, Send, BarChart3, Settings, LogOut, Bot } from "lucide-react";
import { WorkspaceBoundary } from "@/components/signal-os/error-boundary";
import { CREATIVE_VIEWS, CreateWorkspace } from "@/components/signal-os/workspace";
import { CommandPalette } from "@/components/command-palette";
import { BatchWorkerChip } from "@/components/batch-worker-chip";
import { OnboardingTour } from "@/components/onboarding-tour";
const HomeScreen = dynamic(() => import("@/components/signal-os/home").then(m => m.SignalHome));
const SettingsHub = dynamic(() => import("@/components/signal-os/settings-hub").then(m => m.SettingsHub));
const Trends = dynamic(() => import("@/components/modules/trends").then(m => m.TrendsModule));
const Planner = dynamic(() => import("@/components/signal-os/planner").then(m => m.PlannerWorkspace));
const Publishing = dynamic(() => import("@/components/modules/publishing").then(m => m.PublishingModule));
const Analytics = dynamic(() => import("@/components/modules/analytics").then(m => m.AnalyticsModule));
const Prompts = dynamic(() => import("@/components/modules/prompt-library").then(m => m.PromptLibraryModule));
const NAV = [{ id: "dashboard", icon: Home, key: "signal.home" }, { id: "create", icon: Plus, key: "signal.create" }, { id: "trends", icon: Radar, key: "nav.trends" }, { id: "planner", icon: CalendarDays, key: "nav.planner" }, { id: "publishing", icon: Send, key: "nav.publishing" }, { id: "analytics", icon: BarChart3, key: "nav.analytics" }, { id: "settings", icon: Settings, key: "nav.settings" }] as const;
interface Job {
    id: string;
    status: string;
    kind: string;
}
export function AppShell({ brands, onBrandsChanged }: {
    brands: {
        id: string;
        name: string;
        stage: string;
        website: string | null;
    }[];
    onBrandsChanged: () => void;
}) {
    const { t, locale } = useI18n();
    const view = useApp(s => s.view);
    const setView = useApp(s => s.setView);
    const user = useApp(s => s.user);
    const brand = useApp(s => s.activeBrandId);
    const setBrand = useApp(s => s.setActiveBrand);
    const mode = useApp(s => s.mode);
    const setMode = useApp(s => s.setMode);
    const [credits, setCredits] = useState<number | null>(null);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => { let alive = true; const load = async () => { try {
        const [sub, feed, autopilot] = await Promise.all([api<{
                usage: {
                    credits: {
                        remaining: number;
                    };
                };
            }>("/api/subscription"), api<Job[]>("/api/jobs?limit=50"), api<{policy:{enabled:boolean}}>("/api/autopilot")]);
        if (alive) {
            setCredits(sub.usage.credits.remaining);
            setJobs(feed);
                setMode(autopilot.policy.enabled ? "autopilot" : "manual");
        }
    }
    catch (e) {
        if (alive)
            setError((e as Error).message);
    } }; void load(); const timer = setInterval(load, 15000); return () => { alive = false; clearInterval(timer); }; }, [brand, setMode]);
    useEffect(() => { document.documentElement.lang = locale; }, [locale]);
    const changeMode = async (next: "manual" | "autopilot") => { setBusy(true); setError(""); try {
        await api("/api/autopilot", { method: "PATCH", body: JSON.stringify({ enabled: next === "autopilot" }) });
        setMode(next);
        if (next === "autopilot")
            setView("autopilot");
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } };
    const active = jobs.filter(j => ["QUEUED", "PROCESSING", "RUNNING", "WAITING_PROVIDER", "RETRYING"].includes(j.status));
    const current = CREATIVE_VIEWS.includes(view) ? "create" : ["brands", "mcp", "admin", "assets"].includes(view) ? "settings" : view;
    return <div className="signal-os"><a className="skip-link" href="#workspace">{t("signal.skip")}</a><aside className="os-dock"><button className="os-mark" onClick={() => setView("dashboard")} aria-label={t("signal.home")}>H</button><nav data-tour="nav" aria-label={t("signal.tools")}>{NAV.map(({ id, icon: Icon, key }) => <button key={id} title={t(key)} aria-label={t(key)} aria-current={current === id ? "page" : undefined} onClick={() => setView(id)}><Icon size={21}/><span>{t(key)}</span></button>)}</nav><button title={t("signal.operator")} aria-label={t("signal.operator")} onClick={() => setView("autopilot")}><Bot size={21}/></button></aside>
 <div className="os-body"><header className="os-topbar"><select data-tour="brand" aria-label={t("nav.brands")} value={brand ?? ""} onChange={e => e.target.value === "__new" ? setView("brands") : setBrand(e.target.value)}><option value="">{t("dash.noBrand")}</option>{brands.map(b => <option value={b.id} key={b.id}>{b.name}</option>)}<option value="__new">+ {t("nav.brands")}</option></select>
 <div className="mode-switch" data-tour="mode" role="group" aria-label={t("signal.mode")}>{(["manual", "autopilot"] as const).map(m => <button disabled={busy} aria-pressed={mode === m} key={m} onClick={() => void changeMode(m)}>{t(`mode.${m}`)}</button>)}</div>
 <button className="credit-button" onClick={() => setView("settings")} aria-label={t("signal.credits")}>{credits === null ? "—" : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(credits)} <span>{t("signal.credits")}</span></button>
 <button className="jobs-button" aria-live="polite" onClick={() => setView("autopilot")}><span className="live-dot"/>{active.length} <span>{t("signal.jobs")}</span></button><button className="profile-button" aria-label={t("signal.account")} title={user?.email} onClick={() => setView("settings")}>{(user?.name ?? user?.email ?? "H").slice(0, 1).toUpperCase()}</button><button className="top-icon" aria-label={t("auth.logout")} onClick={async () => { try {
        await api("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout" }) });
        setStoredSessionToken(null);
        window.location.reload();
    }
    catch (e) {
        setError((e as Error).message);
    } }}><LogOut size={17}/></button></header>
 {error && <div className="os-error" role="alert">{error}</div>}
 <main id="workspace" tabIndex={-1} className="os-main"><WorkspaceBoundary key={view}>{CREATIVE_VIEWS.includes(view) ? <CreateWorkspace /> : view === "dashboard" ? <HomeScreen /> : view === "trends" ? <Trends /> : view === "planner" ? <Planner /> : view === "publishing" ? <Publishing /> : view === "analytics" ? <Analytics /> : view === "prompts" ? <Prompts /> : <SettingsHub key={view} onBrandsChanged={onBrandsChanged} initialView={view}/>}</WorkspaceBoundary></main>
 </div><CommandPalette /><BatchWorkerChip /><OnboardingTour /></div>;
}
