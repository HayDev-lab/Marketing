"use client";
import { useEffect, useState } from 'react';
import { api, useI18n } from '@/lib/use-i18n';
interface Configuration {active:string;providers:{id:string;configured:boolean;model:string|null}[]}
export function CloudProviders(){
 const {t}=useI18n();const [config,setConfig]=useState<Configuration|null>(null);const [failed,setFailed]=useState(false);
 useEffect(()=>{let alive=true;api<Configuration>('/api/settings/cloud').then(v=>{if(alive)setConfig(v);}).catch(()=>{if(alive)setFailed(true);});return()=>{alive=false;};},[]);
 return <section className="os-panel cloud-providers"><h2>{t('signal.cloud')}</h2><p>{t('signal.cloudHelp')}</p>{failed?<p role="alert">{t('signal.failed')}</p>:!config?<p role="status">{t('common.loading')}</p>:config.providers.map(p=><div key={p.id} className="cloud-provider-row"><strong>{p.id==='google'?'Google Gemini':'OpenRouter'}</strong><span>{t(p.configured&&p.model?'signal.configured':'signal.notConfigured')}</span><code>{p.model ?? '—'}</code><small>{config.active===p.id?t('signal.activeProvider'):t('signal.inactiveProvider')}</small></div>)}</section>;
}
