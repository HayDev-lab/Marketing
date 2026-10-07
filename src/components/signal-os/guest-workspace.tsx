"use client";
import { useApp } from '@/lib/store';
import { useI18n } from '@/lib/use-i18n';
import { VideoCanvas } from './video-canvas';
import { SceneTimeline, SceneAssets } from './scene-timeline';
export function GuestWorkspace({onRequestAuth}:{onRequestAuth:()=>void}){
 const {t}=useI18n();const view=useApp(s=>s.view);const setView=useApp(s=>s.setView);
 return <section className="create-workspace space-y-6"><h1 className="text-3xl font-semibold">{t('signal.create')}</h1><nav className="type-tabs" aria-label={t('signal.tools')}>{(['image','video','content','music','voice','avatar'] as const).map(id=><button key={id} aria-pressed={view===id} onClick={()=>setView(id)}>{t(`nav.${id}`)}</button>)}</nav><ol className="workflow-steps">{['idea','script','storyboard','generate','edit','publish'].map((key,i)=><li key={key}><span>{i+1}</span>{t(`signal.${key}`)}</li>)}</ol><div className="video-editor-layout"><SceneAssets scenes={[]} onSelect={()=>{}}/><VideoCanvas scenes={[]} ratio="9:16" selection="final" onSelect={()=>{}}/><aside className="os-panel p-5 space-y-4"><h2>{t('signal.brief')}</h2><p className="text-sm text-muted-foreground">{t('signal.signInHelp')}</p><button className="os-primary" onClick={onRequestAuth}>{t('auth.login')}</button></aside><SceneTimeline scenes={[]} selected="final" onSelect={()=>{}} cues={[]}/></div></section>;
}
