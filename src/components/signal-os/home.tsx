"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, ImageIcon, Clapperboard, FileText, Radar, CalendarDays, Loader2 } from "lucide-react";
import { SignalCore } from "@/components/signal-core";
import { useApp, type ViewId } from "@/lib/store";
import { api, useI18n } from "@/lib/use-i18n";
interface Content {
    id: string;
    title: string;
    approvalState: string;
    type?: string;
    createdAt: string;
}
interface Job {
    id: string;
    kind: string;
    status: string;
    error?: string | null;
}
export function SignalHome() {
    const { t, locale } = useI18n();
    const setView = useApp(s => s.setView);
    const core = useApp(s => s.coreState);
    const mode = useApp(s => s.mode);
    const brand = useApp(s => s.activeBrandId);
    const [opening, setOpening] = useState(false);
    const [brief, setBrief] = useState("");
    const [format, setFormat] = useState<"image" | "video" | "content">("video");
    const [items, setItems] = useState<Content[]>([]);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const load = useCallback(async () => { setError(""); try {
        const [content, feed] = await Promise.all([api<Content[]>(`/api/content${brand ? `?brandId=${encodeURIComponent(brand)}` : ""}`), api<Job[]>("/api/jobs?limit=6")]);
        setItems(content.slice(0, 5));
        setJobs(feed);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setLoading(false);
    } }, [brand]);
    useEffect(() => { void Promise.resolve().then(load); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [load]);
    const open = async () => { if (opening)
        return; setOpening(true); try {
        if (format === "content" && brief.trim()) {
            if (!brand) {
                setView("brands");
                return;
            }
            const item = await api<{
                id: string;
            }>("/api/content", { method: "POST", body: JSON.stringify({ brandId: brand, title: brief.trim(), caption: brief.trim(), contentType: "POST", platform: "instagram", language: locale, aiWrite: false }) });
            useApp.getState().setContentSeed(item.id);
        }
        else if (brief.trim()) {
            window.localStorage.setItem(format === "video" ? "haydev-prompt-to-video" : "haydev-prompt-to-studio", brief.trim());
        }
        setView(format);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setOpening(false);
    } };
    const quick: {
        id: ViewId;
        icon: typeof Radar;
        key: string;
    }[] = [{ id: "trends", icon: Radar, key: "dash.qa.trends" }, { id: "planner", icon: CalendarDays, key: "dash.qa.strategy" }, { id: "video", icon: Clapperboard, key: "nav.video" }, { id: "image", icon: ImageIcon, key: "nav.image" }, { id: "content", icon: FileText, key: "nav.content" }];
    const displayedState = core !== "IDLE" ? core : jobs.some(j => ["PROCESSING", "WAITING_PROVIDER", "RETRYING"].includes(j.status)) ? "GENERATING" : items.some(i => i.approvalState === "READY_FOR_REVIEW") ? "WAITING_APPROVAL" : mode === "autopilot" ? "AUTOPILOT_ACTIVE" : "IDLE";
    return <div className="home-workspace"><section className="home-hero"><div className="home-composer"><p className="eyebrow">HayDev Marketing · Signal Creative OS</p><h1>{t("signal.title")}</h1><p className="hero-subtitle">{t("signal.intro")}</p><form onSubmit={e => { e.preventDefault(); void open(); }} className="creative-composer"><label className="sr-only" htmlFor="creative-brief">{t("signal.brief")}</label><textarea id="creative-brief" value={brief} onChange={e => setBrief(e.target.value)} placeholder={t("signal.placeholder")} rows={3}/><div className="composer-controls"><select aria-label={t("signal.tools")} value={format} onChange={e => setFormat(e.target.value as typeof format)}><option value="video">{t("nav.video")}</option><option value="image">{t("nav.image")}</option><option value="content">{t("nav.content")}</option></select><button className="os-primary" type="submit" disabled={opening}>{t("signal.open")}<ArrowUpRight size={18}/></button></div></form><div className="quick-actions">{quick.map(({ id, icon: Icon, key }) => <button key={id} onClick={() => setView(id)}><Icon size={17}/>{t(key)}</button>)}</div></div><div className="core-stage"><SignalCore className="core-visual" state={displayedState}/><div className="core-monogram" aria-hidden>H</div><div className="core-caption" role="status">{displayedState === "IDLE" ? t("signal.ready") : displayedState === "WAITING_APPROVAL" ? t("signal.waiting") : displayedState === "AUTOPILOT_ACTIVE" ? t("mode.autopilot") : t(`state.${displayedState}`)}</div></div></section>
 {error && <div className="os-error" role="alert">{t("signal.failed")} <button onClick={() => void load()}>{t("signal.retry")}</button><details><summary>{t("signal.details")}</summary>{error}</details></div>}
 <section className="home-activity"><div className="work-list"><header><h2>{t("signal.recent")}</h2><button onClick={() => setView("content")}>{t("signal.all")}<ArrowUpRight size={16}/></button></header>{loading ? <Loader2 className="animate-spin" aria-label={t("common.loading")}/> : items.length ? items.map(item => <button className="project-row" key={item.id} onClick={() => { useApp.getState().setContentSeed(item.id); setView("content"); }}><div className="project-icon"><FileText size={19}/></div><div><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleDateString(locale)}</small></div><span className="status-label">{t(`content.state.${item.approvalState}`) === `content.state.${item.approvalState}` ? item.approvalState : t(`content.state.${item.approvalState}`)}</span><ArrowUpRight size={16}/></button>) : <div className="os-empty"><Clapperboard size={28}/><p>{t("signal.empty")}</p><button className="os-button" onClick={() => setView("create")}>{t("signal.create")}</button></div>}</div><div className="job-stream"><header><h2>{t("signal.jobs")}</h2><button onClick={() => setView("autopilot")}><ArrowUpRight size={18}/><span className="sr-only">{t("signal.operator")}</span></button></header><div aria-live="polite">{jobs.length ? jobs.map(job => <div className="job-row" key={job.id}><span className="live-dot"/><div><strong>{job.kind}</strong><small>{t(`job.status.${job.status}`)}</small>{job.error && <p role="alert">{job.error}</p>}</div></div>) : <p className="text-muted-foreground text-sm py-8">{t("signal.noJobs")}</p>}</div></div></section></div>;
}
