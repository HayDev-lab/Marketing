"use client";
import dynamic from "next/dynamic";
import { useApp, type ViewId } from "@/lib/store";
import { useI18n } from "@/lib/use-i18n";
import { ImageIcon, Clapperboard, FileText, Music4, AudioLines, ScanFace, Library } from "lucide-react";
const ImageStudio = dynamic(() => import("@/components/modules/image-studio").then(m => m.ImageStudioModule));
const Video = dynamic(() => import("@/components/modules/video-studio").then(m => m.VideoStudioModule));
const Post = dynamic(() => import("@/components/modules/content").then(m => m.ContentModule));
const Music = dynamic(() => import("@/components/modules/music-studio").then(m => m.MusicModule));
const Voice = dynamic(() => import("@/components/modules/voice").then(m => m.VoiceModule));
const Avatar = dynamic(() => import("@/components/modules/avatar-studio").then(m => m.AvatarStudioModule));
export const CREATIVE_VIEWS: ViewId[] = ["create", "image", "video", "content", "music", "voice", "avatar"];
const TYPES = [{ id: "image", icon: ImageIcon }, { id: "video", icon: Clapperboard }, { id: "content", icon: FileText }, { id: "music", icon: Music4 }, { id: "voice", icon: AudioLines }, { id: "avatar", icon: ScanFace }] as const;
export function CreateWorkspace() {
    const { t } = useI18n();
    const view = useApp(s => s.view);
    const setView = useApp(s => s.setView);
    const selected = view === "create" ? "image" : view;
    return <section className="create-workspace space-y-6"><header className="flex items-center justify-between gap-3"><div><p className="eyebrow">Signal Creative OS</p><h1 className="text-3xl font-semibold">{t("signal.create")}</h1></div><button className="os-button" onClick={() => setView("prompts")}><Library size={16}/>{t("signal.library")}</button></header>
 <nav className="type-tabs" aria-label={t("signal.tools")}>{TYPES.map(({ id, icon: Icon }) => <button key={id} aria-pressed={selected === id} className={selected === id ? "selected" : ""} onClick={() => setView(id)}><Icon size={17}/>{t(`nav.${id}`)}</button>)}</nav>
 {selected === "video" && <ol className="workflow-steps" aria-label={t("signal.workflow")}>{["idea", "script", "storyboard", "generate", "edit", "publish"].map((step, i) => <li key={step}><span>{i + 1}</span>{t(`signal.${step}`)}</li>)}</ol>}
 <div className="studio-surface">{selected === "video" ? <Video /> : selected === "content" ? <Post /> : selected === "music" ? <Music /> : selected === "voice" ? <Voice /> : selected === "avatar" ? <Avatar /> : <ImageStudio />}</div>
 </section>;
}
