"use client";
import { useCallback, useEffect, useState } from "react";
import { api, useI18n } from "@/lib/use-i18n";
import { useApp } from "@/lib/store";
import { Square, Loader2 } from "lucide-react";
interface Snapshot {
    policy: {
        enabled: boolean;
    };
    cycles: {
        id: string;
        action: string;
        summary: string | null;
        createdAt: string;
    }[];
}
export function AutopilotOperator() {
    const { t, locale } = useI18n();
    const [data, setData] = useState<Snapshot | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [jobs, setJobs] = useState<{id:string;kind:string;status:string;error:string|null}[]>([]);
    const setMode = useApp(s => s.setMode);
    const load = useCallback(async () => { try {
        const [snapshot, feed] = await Promise.all([api<Snapshot>("/api/autopilot"), api<{id:string;kind:string;status:string;error:string|null}[]>("/api/jobs?limit=50")]);
            setData(snapshot);
            setJobs(feed);
        setError("");
    }
    catch (e) {
        setError((e as Error).message);
    } }, []);
    useEffect(() => { void Promise.resolve().then(load); const timer = setInterval(load, 10000); return () => clearInterval(timer); }, [load]);
    const stop = async () => { setBusy(true); try {
        await api("/api/autopilot", { method: "PATCH", body: JSON.stringify({ enabled: false, paidGeneration: false, autoGeneration: false, trendSchedulerEnabled: false }) });
        setMode("manual");
        await load();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } };
    return <div className="os-panel p-6 space-y-6"><header className="flex flex-wrap gap-4 justify-between items-center"><h2 className="text-2xl font-semibold">{t("signal.operator")}</h2><span className="status-label">{data ? t(`mode.${data.policy.enabled ? "autopilot" : "manual"}`) : "—"}</span></header>{error && <p role="alert" className="os-error">{error}</p>}<button disabled={busy || !data?.policy.enabled} onClick={() => void stop()} className="os-stop">{busy ? <Loader2 className="animate-spin" size={18}/> : <Square size={18}/>} {t("signal.stop")}</button>{data && !data.policy.enabled && <p className="text-muted-foreground">{t("signal.stopped")}</p>}<section aria-live="polite"><h3 className="font-semibold mb-3">{t("signal.jobs")}</h3>{jobs.length ? jobs.map(job => <div className="job-row" key={job.id}><div><strong>{job.kind}</strong><small>{t(`job.status.${job.status}`)}</small>{job.error && <p className="os-error">{job.error}</p>}</div></div>) : <p className="text-muted-foreground">{t("signal.noJobs")}</p>}</section><ol className="activity-stream">{data?.cycles.map(c => <li key={c.id}><time>{new Date(c.createdAt).toLocaleTimeString(locale)}</time><div><strong>{c.action}</strong><p>{c.summary}</p></div></li>)}</ol></div>;
}
