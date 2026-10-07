"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useI18n } from "@/lib/use-i18n";
import { ContentCalendar } from "./calendar";
const Planning = dynamic(()=>import("@/components/modules/planner").then(m=>m.PlannerModule));
export function PlannerWorkspace(){const {t}=useI18n();const [tab,setTab]=useState("calendar");return <div className="space-y-6"><nav className="type-tabs" aria-label={t("nav.planner")}><button className={tab==="calendar"?"selected":""} onClick={()=>setTab("calendar")}>{t("signal.calendar")}</button><button className={tab==="strategy"?"selected":""} onClick={()=>setTab("strategy")}>{t("dash.qa.strategy")}</button></nav>{tab==="calendar"?<ContentCalendar/>:<Planning/>}</div>;}
