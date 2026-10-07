"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useI18n } from "@/lib/use-i18n";
import { useApp, type ViewId } from "@/lib/store";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n";
import { CloudProviders } from "./cloud-providers";
import { AutopilotOperator } from "./autopilot";
const Settings = dynamic(() => import("@/components/modules/settings").then(m => m.SettingsModule));
const Brands = dynamic(() => import("@/components/modules/brands").then(m => m.BrandsModule));
const Mcp = dynamic(() => import("@/components/modules/mcp").then(m => m.McpModule));
const Admin = dynamic(() => import("@/components/modules/admin").then(m => m.AdminModule));
const Assets = dynamic(() => import("./assets").then(m => m.AssetLibrary));
export function SettingsHub({ onBrandsChanged, initialView }: {
    onBrandsChanged: () => void;
    initialView: ViewId;
}) {
    const { t, locale, setLocale } = useI18n();
    const user = useApp(s => s.user);
    const [section, setSection] = useState(initialView === "settings" ? "profile" : initialView);
    const sections = [{ id: "profile", key: "signal.profile" }, { id: "brands", key: "nav.brands" }, { id: "settings", key: "settings.tab.providers" }, { id: "autopilot", key: "signal.operator" }, { id: "mcp", key: "nav.mcp" }, { id: "assets", key: "signal.assets" }, ...(user?.isAdmin ? [{ id: "admin", key: "nav.admin" }] : [])];
    return <section className="settings-hub"><header className="mb-6"><p className="eyebrow">Signal Creative OS</p><h1 className="text-3xl font-semibold">{t("nav.settings")}</h1><p className="mt-2 text-muted-foreground">{t("signal.settingsIntro")}</p></header><div className="settings-layout"><nav aria-label={t("nav.settings")}>{sections.map(s => <button key={s.id} aria-current={section === s.id ? "page" : undefined} onClick={() => setSection(s.id)}>{t(s.key)}</button>)}</nav><div className="min-w-0">{section === "profile" ? <div className="os-panel p-6 space-y-5"><h2 className="text-xl">{t("signal.profile")}</h2><p>{user?.name}</p><p className="text-muted-foreground break-all">{user?.email}</p><label className="grid gap-2">{t("signal.profile")}<select className="os-select" value={locale} onChange={e => setLocale(e.target.value as typeof locale)}>{LOCALES.map(l => <option key={l} value={l}>{LOCALE_LABELS[l]}</option>)}</select></label></div> : section === "brands" ? <Brands onBrandsChanged={onBrandsChanged}/> : section === "mcp" ? <Mcp /> : section === "admin" ? <Admin /> : section === "assets" ? <Assets /> : section === "autopilot" ? <AutopilotOperator /> : <div className="space-y-6"><CloudProviders/><Settings onBrandsChanged={onBrandsChanged}/></div>}</div></div></section>;
}
