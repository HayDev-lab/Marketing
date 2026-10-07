"use client";
import { useRef, useState } from "react";
import { Maximize2, Scan, Film } from "lucide-react";
import { assetUrl, useI18n } from "@/lib/use-i18n";
interface PreviewScene { id: string; order: number; assetId?: string | null; status: string; durationSec: number }
export function VideoCanvas({ scenes, finalAssetId, ratio }: { scenes: PreviewScene[]; finalAssetId?: string | null; ratio: string }) {
 const { t } = useI18n();
 const container = useRef<HTMLDivElement>(null);
 const [selection, setSelection] = useState("final");
 const [safeZones, setSafeZones] = useState(false);
 const [error, setError] = useState("");
 const selected = scenes.find(scene => scene.id === selection);
 const asset = selected?.assetId ?? (selection === "final" ? finalAssetId : null);
 return <section className="video-canvas os-panel" aria-label={t("signal.preview")}>
  <header className="canvas-toolbar"><h2>{t("signal.preview")}</h2><div><button className="top-icon" title={t("signal.safeZones")} aria-label={t("signal.safeZones")} aria-pressed={safeZones} onClick={() => setSafeZones(!safeZones)}><Scan size={18}/></button><button className="top-icon" title={t("signal.fullscreen")} aria-label={t("signal.fullscreen")} onClick={() => { container.current?.requestFullscreen().catch(() => setError(t("signal.fullscreenError"))); }}><Maximize2 size={18}/></button></div></header>
  <div className="canvas-preview" ref={container}>
   <div className="canvas-media" style={{ aspectRatio: ratio.replace(":", "/") }}>
    {asset ? <video key={asset} src={assetUrl(`/api/assets/${asset}/raw`)} controls preload="metadata" aria-label={selected ? t("studio.vid.scene", { n: selected.order + 1 }) : t("studio.vid.assembly.final")}/> : <div className="canvas-empty"><Film size={32}/><p>{t("signal.previewEmpty")}</p>{selected && <span>{t(`studio.vid.status.${selected.status}`)}</span>}</div>}
    {safeZones && <div className="canvas-safe-zone" aria-hidden="true"/>}
   </div>
  </div>
  <nav className="canvas-scenes" aria-label={t("studio.vid.scenes")}><button aria-pressed={selection === "final"} onClick={() => setSelection("final")}>{t("studio.vid.assembly.final")}</button>{scenes.map(scene => <button key={scene.id} aria-pressed={selection === scene.id} onClick={() => setSelection(scene.id)}>{t("studio.vid.scene", { n: scene.order + 1 })} <span>{t(`studio.vid.status.${scene.status}`)}</span></button>)}</nav>
  {error && <p className="os-error" role="alert">{error}</p>}
 </section>;
}
