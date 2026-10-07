"use client";
import { useEffect, useState } from "react";
import { api, assetUrl, useI18n } from "@/lib/use-i18n";
import { useApp } from "@/lib/store";
import { Download, File, Loader2 } from "lucide-react";
interface Asset {
    id: string;
    filename: string;
    kind: string;
    mimeType: string;
    provider: string | null;
    createdAt: string;
    url: string;
}
export function AssetLibrary() {
    const { t, locale } = useI18n();
    const brand = useApp(s => s.activeBrandId);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [filter, setFilter] = useState("ALL");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    useEffect(() => { let alive = true; api<Asset[]>(`/api/assets${brand ? `?brandId=${encodeURIComponent(brand)}` : ""}`).then(a => { if (alive)
        setAssets(a); }).catch(e => { if (alive)
        setError(e.message); }).finally(() => { if (alive)
        setLoading(false); }); return () => { alive = false; }; }, [brand]);
    return <section><header className="flex gap-3 items-center justify-between mb-5"><h2 className="text-2xl">{t("signal.assets")}</h2><select aria-label={t("signal.tools")} className="os-select" value={filter} onChange={e => setFilter(e.target.value)}><option value="ALL">{t("signal.all")}</option>{Array.from(new Set(assets.map(a => a.kind))).map(kind => <option key={kind}>{kind}</option>)}</select></header>{error && <p role="alert" className="os-error">{error}</p>}{loading ? <Loader2 className="animate-spin"/> : !assets.length ? <div className="os-empty"><File /><p>{t("signal.empty")}</p></div> : <div className="asset-grid">{assets.filter(a => filter === "ALL" || a.kind === filter).map(a => <article className="os-panel overflow-hidden" key={a.id}><div className="asset-preview">{a.mimeType.startsWith("image/") ? <img loading="lazy" src={assetUrl(a.url)} alt={a.filename}/> : a.mimeType.startsWith("video/") ? <video preload="none" controls src={assetUrl(a.url)} aria-label={a.filename}/> : a.mimeType.startsWith("audio/") ? <audio controls preload="none" src={assetUrl(a.url)}/> : <File size={35}/>}</div><div className="p-4 space-y-2"><h3 className="truncate" title={a.filename}>{a.filename}</h3><p className="text-xs text-muted-foreground">{a.provider ?? "—"} · {new Date(a.createdAt).toLocaleDateString(locale)}</p><a href={assetUrl(a.url)} download={a.filename} className="os-button" aria-label={`${t("signal.download")} ${a.filename}`}><Download size={16}/>{t("signal.download")}</a></div></article>)}</div>}</section>;
}
