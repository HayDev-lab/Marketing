"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useI18n, api } from "@/lib/use-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Instagram, Music2, Facebook, Send, Link2, Unlink, CalendarClock, TriangleAlert,
  Download, RefreshCw, Loader2, CircleAlert, ClipboardCheck, Hand,
  CalendarRange, ChevronLeft, ChevronRight, GripVertical,
} from "lucide-react";
import { PlatformIcon } from "@/components/modules/content";

// ===== types =====
type ConnMode = "DIRECT_PUBLISH_AVAILABLE" | "DRAFT_TRANSFER_ONLY" | "USER_ACTION_REQUIRED" | "NOT_AVAILABLE";

interface Connection {
  id: string; platform: string; accountName: string | null; status: string; mode: ConnMode;
}

interface ScheduledPost {
  id: string; platform: string; scheduledAt: string; timezone: string; status: string;
  caption: string | null; preflightJson: string | null; error: string | null;
  contentItem?: { id: string; title: string; approvalState: string } | null;
}

interface ContentLite { id: string; title: string; platform: string }

interface AttemptResult { platform: string; caption: string | null; mediaUrl: string | null }

const PLATFORM_TITLES: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", telegram: "Telegram" };
const PLATFORMS = Object.keys(PLATFORM_TITLES);
const TIMEZONES = ["Asia/Yerevan", "Europe/Moscow", "Europe/London", "America/New_York", "UTC"];

function toLocalInput(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function postStatusAccent(status: string): { style?: React.CSSProperties; className?: string } {
  switch (status) {
    case "SCHEDULED":
    case "PUBLISHED":
      return { style: { background: "color-mix(in oklab, var(--neon-2) 16%, transparent)", color: "var(--neon-2)", borderColor: "color-mix(in oklab, var(--neon-2) 40%, transparent)" } };
    case "READY":
      return { style: { background: "color-mix(in oklab, var(--neon) 16%, transparent)", color: "var(--neon)", borderColor: "color-mix(in oklab, var(--neon) 40%, transparent)" } };
    case "ACTION_REQUIRED":
    case "SUBMITTING":
    case "PROVIDER_ACCEPTED":
      return { style: { background: "color-mix(in oklab, var(--neon-3) 18%, transparent)", color: "var(--neon-3)", borderColor: "color-mix(in oklab, var(--neon-3) 45%, transparent)" } };
    case "FAILED":
      return { className: "bg-destructive/15 text-destructive border-destructive/40" };
    default:
      return { className: "bg-muted/40 text-muted-foreground border-border" };
  }
}

// ===== main module =====
export function PublishingModule(_props: { onBrandsChanged?: () => void }) {
  const { t, locale } = useI18n();

  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [posts, setPosts] = useState<ScheduledPost[] | null>(null);
  const [honestResult, setHonestResult] = useState<Record<string, { reason: string; requiredSetup: string }>>({});

  // connect dialog
  const [connectPlatform, setConnectPlatform] = useState<string | null>(null);
  const [accountName, setAccountName] = useState("");
  const [connecting, setConnecting] = useState(false);

  // schedule dialog
  const [schedOpen, setSchedOpen] = useState(false);
  const [approvedItems, setApprovedItems] = useState<ContentLite[] | null>(null);
  const [schedItemId, setSchedItemId] = useState<string>("");
  const [schedPlatform, setSchedPlatform] = useState<string>("instagram");
  const [schedAt, setSchedAt] = useState<string>(toLocalInput(new Date(Date.now() + 3600_000)));
  const [schedTz, setSchedTz] = useState("Asia/Yerevan");
  const [scheduling, setScheduling] = useState(false);
  const [schedIssues, setSchedIssues] = useState<string[] | null>(null);

  // per-post actions
  const [attemptResult, setAttemptResult] = useState<AttemptResult | null>(null);
  const [busyPost, setBusyPost] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState("");

  // week board
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekPostId, setWeekPostId] = useState<string | null>(null);
  const [weekReschedValue, setWeekReschedValue] = useState("");
  const [dragPostId, setDragPostId] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    try {
      setConnections(await api<Connection[]>("/api/publishing/connections"));
    } catch {
      setConnections([]);
    }
  }, []);

  const loadPosts = useCallback(async () => {
    try {
      setPosts(await api<ScheduledPost[]>("/api/schedule"));
    } catch {
      setPosts([]);
    }
  }, []);

  useEffect(() => { loadConnections(); loadPosts(); }, [loadConnections, loadPosts]);

  const connect = async () => {
    if (!connectPlatform) return;
    setConnecting(true);
    try {
      const res = await api<{ connection: Connection; honestStatus: string; reason: string; requiredSetup: string }>(
        "/api/publishing/connections",
        { method: "POST", body: JSON.stringify({ platform: connectPlatform, accountName: accountName || undefined }) }
      );
      setConnections((prev) => {
        const rest = (prev ?? []).filter((c) => c.platform !== res.connection.platform);
        return [...rest, res.connection];
      });
      // Honest outcome: external OAuth credentials are absent — never pretend "Connected"
      setHonestResult((prev) => ({ ...prev, [res.connection.platform]: { reason: res.reason, requiredSetup: res.requiredSetup } }));
      toast.warning(t("publishing.connectBlocked"), { description: res.reason });
      setConnectPlatform(null);
      setAccountName("");
    } catch (e) {
      toast.error(t("publishing.err.default"), { description: (e as Error).message });
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async (conn: Connection) => {
    try {
      await api("/api/publishing/connections", { method: "PATCH", body: JSON.stringify({ id: conn.id, disconnect: true }) });
      setConnections((prev) => (prev ?? []).map((c) => (c.id === conn.id ? { ...c, status: "NOT_CONNECTED", accountName: null } : c)));
      toast.success(`${PLATFORM_TITLES[conn.platform]} — ${t("publishing.status.NOT_CONNECTED")}`);
    } catch (e) {
      toast.error(t("publishing.err.default"), { description: (e as Error).message });
    }
  };

  const openSchedule = async () => {
    setSchedOpen(true);
    setSchedIssues(null);
    try {
      const items = await api<ContentLite[]>("/api/content?state=APPROVED");
      setApprovedItems(items);
      if (items.length) {
        setSchedItemId(items[0].id);
        setSchedPlatform(items[0].platform);
      } else {
        setSchedItemId("");
      }
    } catch {
      setApprovedItems([]);
    }
  };

  const submitSchedule = async () => {
    if (!schedItemId) return;
    if (!schedAt || isNaN(new Date(schedAt).getTime())) {
      toast.warning(t("publishing.dateTime"), { description: t("publishing.err.default") });
      return;
    }
    setScheduling(true);
    setSchedIssues(null);
    try {
      const res = await api<{ post: ScheduledPost; preflight: { ok: boolean; issues: string[] } }>(
        "/api/schedule",
        { method: "POST", body: JSON.stringify({ contentItemId: schedItemId, platform: schedPlatform, scheduledAt: new Date(schedAt).toISOString(), timezone: schedTz }) }
      );
      if (res.preflight.ok) {
        toast.success(t("publishing.scheduleCreated"));
        setSchedOpen(false);
      } else {
        setSchedIssues(res.preflight.issues);
        toast.warning(t("publishing.scheduleWithIssues"), { description: res.preflight.issues.join(" · ") });
      }
      setPosts((prev) => (prev ? [res.post, ...prev] : [res.post]));
    } catch (e) {
      const code = (e as { code?: string }).code;
      toast.error(code === "NOT_APPROVED" ? t("publishing.err.NOT_APPROVED") : t("publishing.err.default"), { description: (e as Error).message });
    } finally {
      setScheduling(false);
    }
  };

  const cancelPost = async (post: ScheduledPost) => {
    setBusyPost(post.id);
    try {
      const updated = await api<ScheduledPost>(`/api/schedule/${post.id}`, { method: "PATCH", body: JSON.stringify({ action: "cancel" }) });
      setPosts((prev) => (prev ?? []).map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
      toast.success(t("publishing.cancelled"));
    } catch (e) {
      toast.error(t("publishing.err.default"), { description: (e as Error).message });
    } finally {
      setBusyPost(null);
    }
  };

  const reschedule = async (post: ScheduledPost, value: string) => {
    if (!value || isNaN(new Date(value).getTime())) {
      toast.warning(t("publishing.newDateTime"), { description: t("publishing.err.default") });
      return;
    }
    setBusyPost(post.id);
    try {
      const updated = await api<ScheduledPost>(`/api/schedule/${post.id}`, { method: "PATCH", body: JSON.stringify({ action: "reschedule", scheduledAt: new Date(value).toISOString() }) });
      setPosts((prev) => (prev ?? []).map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
      setRescheduleId(null);
      toast.success(t("publishing.rescheduled"));
    } catch (e) {
      toast.error(t("publishing.err.default"), { description: (e as Error).message });
    } finally {
      setBusyPost(null);
    }
  };

  // Honest publish attempt: the API returns USER_ACTION_REQUIRED + export package (never a fake success)
  const attemptPublish = async (post: ScheduledPost) => {
    setBusyPost(post.id);
    try {
      const res = await api<{ post: ScheduledPost; honestStatus: string; exportPackage: { caption: string | null; platform: string; mediaUrl: string | null } }>(
        `/api/schedule/${post.id}`,
        { method: "PATCH", body: JSON.stringify({ action: "attempt_publish" }) }
      );
      setPosts((prev) => (prev ?? []).map((p) => (p.id === res.post.id ? { ...p, ...res.post } : p)));
      setAttemptResult({ platform: res.exportPackage.platform, caption: res.exportPackage.caption, mediaUrl: res.exportPackage.mediaUrl });
      toast.warning(t("publishing.attemptResult"), { description: t("publishing.attemptExplain") });
    } catch (e) {
      toast.error(t("publishing.err.default"), { description: (e as Error).message });
    } finally {
      setBusyPost(null);
    }
  };

  const platformMeta = useMemo(() => {
    const map: Record<string, Connection | undefined> = {};
    for (const c of connections ?? []) map[c.platform] = c;
    return map;
  }, [connections]);

  // week board data: Monday..Sunday of the selected week, local-date bucketed
  const weekDays = useMemo(() => {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  }, [weekOffset]);
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const postsByDay = useMemo(() => {
    const map: Record<string, ScheduledPost[]> = {};
    for (const p of posts ?? []) {
      const k = dayKey(new Date(p.scheduledAt));
      (map[k] ??= []).push(p);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
    return map;
  }, [posts]);
  const todayKey = dayKey(new Date());
  const weekLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
    return `${fmt.format(weekDays[0])} — ${fmt.format(weekDays[6])}`;
  }, [weekDays, locale]);
  const weekdayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short" }), [locale]);
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }), [locale]);
  const liveWeekPost = (posts ?? []).find((p) => p.id === weekPostId) ?? null;

  // Drag & drop rescheduling: dropping a SCHEDULED chip on another day keeps the time-of-day.
  // The post id comes from dataTransfer (authoritative) — React state may lag behind native events.
  const dropOnDay = (day: Date, postId: string | null) => {
    const k = dayKey(day);
    setDragOverDay(null);
    setDragPostId(null);
    if (!postId) return;
    const post = (posts ?? []).find((p) => p.id === postId);
    if (!post) return;
    if (post.status !== "SCHEDULED") {
      toast.warning(t("publishing.weekDragLocked"));
      return;
    }
    const old = new Date(post.scheduledAt);
    if (dayKey(old) === k) return; // same day — nothing to change
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), old.getHours(), old.getMinutes());
    void reschedule(post, toLocalInput(next));
  };

  return (
    <div className="grid gap-5">
      {/* header */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-strong neon-border rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
              <Send className="h-5 w-5 text-[var(--neon)]" aria-hidden /> {t("publishing.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("publishing.connectionsDesc")}</p>
          </div>
          <Button size="sm" className="min-h-11" onClick={openSchedule} aria-label={t("publishing.scheduleNew")}>
            <CalendarClock className="h-4 w-4" aria-hidden /> {t("publishing.scheduleNew")}
          </Button>
        </div>
      </motion.section>

      {/* connections */}
      <section aria-label={t("publishing.connections")}>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground">{t("publishing.connections")}</h2>
        {!connections ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl bg-muted/40" />)}</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {PLATFORMS.map((p, i) => {
              const conn = platformMeta[p];
              const honest = honestResult[p];
              return (
                <motion.div key={p} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="glass glass-hover flex flex-col gap-3 rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <span className="rounded-lg p-1.5" style={{ background: "color-mix(in oklab, var(--neon) 14%, transparent)" }}>
                        <PlatformIcon platform={p} className="h-4 w-4 text-[var(--neon)]" />
                      </span>
                      {PLATFORM_TITLES[p]}
                    </span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{t(`publishing.mode.${conn?.mode ?? "NOT_AVAILABLE"}`)}</Badge>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{t(`publishing.mode.explain.${conn?.mode ?? "NOT_AVAILABLE"}`)}</p>
                  <div className="mt-auto grid gap-2">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{t("common.status")}: {conn?.status === "NOT_CONNECTED" ? t("publishing.status.NOT_CONNECTED") : conn?.status === "CONNECTED" ? t("publishing.status.CONNECTED") : t("publishing.status.ACTION_REQUIRED")}</span>
                      {conn?.accountName && <span className="truncate max-w-24">{conn.accountName}</span>}
                    </div>
                    {conn && !conn.id.startsWith("virtual_") ? (
                      <Button size="sm" variant="outline" className="min-h-11" onClick={() => disconnect(conn)} aria-label={t("publishing.disconnect")}>
                        <Unlink className="h-4 w-4" aria-hidden /> {t("publishing.disconnect")}
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="min-h-11" onClick={() => { setConnectPlatform(p); setAccountName(""); }} aria-label={`${t("publishing.connect")} ${PLATFORM_TITLES[p]}`}>
                        <Link2 className="h-4 w-4" aria-hidden /> {t("publishing.connect")}
                      </Button>
                    )}
                  </div>
                  {honest && (
                    <div className="rounded-xl border border-[color-mix(in_oklab,var(--neon-3)_50%,transparent)] bg-[color-mix(in_oklab,var(--neon-3)_10%,transparent)] p-3 text-[11px]" role="alert">
                      <p className="flex items-center gap-1 font-medium text-[var(--neon-3)]">
                        <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> {t("publishing.connectBlocked")}
                      </p>
                      <p className="mt-1 text-foreground/80">{honest.reason}</p>
                      <p className="mt-1 text-muted-foreground"><span className="font-medium">{t("publishing.requiredSetup")}:</span> {honest.requiredSetup}</p>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {/* honest publish attempt result */}
      {attemptResult && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} role="alert">
          <Card className="rounded-2xl border-[color-mix(in_oklab,var(--neon-3)_50%,transparent)] bg-[color-mix(in_oklab,var(--neon-3)_8%,transparent)]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Hand className="h-4 w-4 text-[var(--neon-3)]" aria-hidden /> {t("publishing.attemptResult")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 pt-0 text-sm">
              <p className="text-foreground/85">{t("publishing.attemptExplain")}</p>
              {attemptResult.caption && (
                <>
                  <p className="text-xs font-medium text-muted-foreground">{t("publishing.exportCaption")}</p>
                  <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border/60 bg-background/40 p-3 text-xs scrollbar-thin">{attemptResult.caption}</pre>
                </>
              )}
              {attemptResult.mediaUrl ? (
                <a href={attemptResult.mediaUrl} download className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-border/60 px-4 text-sm font-medium glass-hover" aria-label={t("publishing.exportMedia")}>
                  <Download className="h-4 w-4 text-[var(--neon-2)]" aria-hidden /> {t("publishing.exportMedia")}
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">{t("publishing.noMediaToExport")}</p>
              )}
              <Button size="sm" variant="ghost" className="min-h-11 w-fit" onClick={() => setAttemptResult(null)}>{t("common.close")}</Button>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* week board */}
      <Card className="glass rounded-2xl">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange className="h-4 w-4 text-[var(--neon)]" aria-hidden /> {t("publishing.weekBoard")}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label={t("publishing.weekPrev")} onClick={() => setWeekOffset((w) => w - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <span className="min-w-[118px] text-center text-xs font-medium text-muted-foreground" aria-live="polite">{weekLabel}</span>
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label={t("publishing.weekNext")} onClick={() => setWeekOffset((w) => w + 1)}>
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
            {weekOffset !== 0 && (
              <Button variant="ghost" size="sm" className="min-h-9 text-xs" onClick={() => setWeekOffset(0)}>{t("publishing.thisWeek")}</Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-2">
          <p className="text-xs text-muted-foreground">{t("publishing.weekHint")}</p>
          <div
            className="grid grid-flow-col auto-cols-[minmax(138px,1fr)] gap-2 overflow-x-auto pb-1 scrollbar-thin sm:auto-cols-fr sm:grid-flow-row sm:grid-cols-7"
            role="table"
            aria-label={t("publishing.weekBoard")}
          >
            {weekDays.map((d) => {
              const k = dayKey(d);
              const dayPosts = postsByDay[k] ?? [];
              const isToday = k === todayKey;
              const isDropTarget = dragOverDay === k && dragPostId !== null;
              return (
                <div
                  key={k}
                  role="row"
                  onDragOver={(e) => {
                    // always allow the drop — id is resolved from dataTransfer in onDrop
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragPostId) setDragOverDay(k);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverDay((cur) => (cur === k ? null : cur));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain") || dragPostId;
                    dropOnDay(d, id);
                  }}
                  className={`flex min-h-24 flex-col gap-1.5 rounded-xl border p-2 transition-colors ${
                    isDropTarget ? "drop-target bg-[var(--neon)]/[0.08]" : isToday ? "neon-border bg-[var(--neon)]/[0.06]" : "border-border/60 bg-muted/20"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span className={`text-[11px] font-semibold capitalize ${isToday ? "text-[var(--neon)]" : "text-muted-foreground"}`}>
                      {weekdayFmt.format(d)}
                    </span>
                    <span className={`text-[11px] ${isToday ? "font-bold text-[var(--neon)]" : "text-muted-foreground"}`}>{d.getDate()}</span>
                  </div>
                  {dayPosts.length === 0 ? (
                    <span className={`text-[10px] ${isDropTarget ? "font-medium text-[var(--neon)]" : "text-muted-foreground/50"}`}>
                      {isDropTarget ? t("publishing.weekDropHere") : "—"}
                    </span>
                  ) : (
                    dayPosts.map((p) => {
                      const accent = postStatusAccent(p.status);
                      const draggable = p.status === "SCHEDULED";
                      return (
                        <button
                          key={p.id}
                          type="button"
                          draggable={draggable}
                          onDragStart={(e) => {
                            if (!draggable) return;
                            e.dataTransfer.setData("text/plain", p.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDragPostId(p.id);
                          }}
                          onDragEnd={() => {
                            setDragPostId(null);
                            setDragOverDay(null);
                          }}
                          onClick={() => { setWeekPostId(p.id); setWeekReschedValue(toLocalInput(new Date(p.scheduledAt))); }}
                          className={`w-full rounded-lg border px-1.5 py-1 text-left transition hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon)]/60 ${accent.className ?? ""} ${
                            draggable ? "lift cursor-grab active:cursor-grabbing" : ""
                          } ${dragPostId === p.id ? "opacity-40" : ""}`}
                          style={accent.style}
                          aria-label={`${new Date(p.scheduledAt).toLocaleTimeString()} · ${p.contentItem?.title ?? p.platform}${draggable ? ` · ${t("publishing.weekDragA11y")}` : ""}`}
                        >
                          <span className="flex items-center gap-1 text-[10px] font-semibold opacity-90">
                            <PlatformIcon platform={p.platform} className="h-3 w-3 shrink-0" />
                            {timeFmt.format(new Date(p.scheduledAt))}
                            {draggable && <GripVertical className="ml-auto h-3 w-3 shrink-0 opacity-40" aria-hidden />}
                          </span>
                          <span className="line-clamp-2 text-[11px] leading-tight">{p.contentItem?.title ?? p.platform}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* scheduled posts */}
      <Card className="glass rounded-2xl">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4 text-[var(--neon-2)]" aria-hidden /> {t("publishing.scheduledPosts")}
          </CardTitle>
          <Button variant="ghost" size="sm" className="min-h-11" onClick={loadPosts} aria-label={t("content.refresh")}>
            <RefreshCw className="h-4 w-4" aria-hidden />
          </Button>
        </CardHeader>
        <CardContent className="max-h-96 overflow-y-auto scrollbar-thin">
          {!posts ? (
            <div className="grid gap-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl bg-muted/40" />)}</div>
          ) : posts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="rounded-full p-3" style={{ background: "color-mix(in oklab, var(--neon-2) 10%, transparent)" }}>
                <CalendarClock className="h-6 w-6 text-[var(--neon-2)]" aria-hidden />
              </span>
              <p className="max-w-sm text-sm text-muted-foreground">{t("publishing.noScheduled")}</p>
            </div>
          ) : (
            <ul className="grid gap-2">
              {posts.map((p) => {
                let preflight: { ok: boolean; issues: string[] } | null = null;
                if (p.preflightJson) { try { preflight = JSON.parse(p.preflightJson); } catch { preflight = null; } }
                const accent = postStatusAccent(p.status);
                return (
                  <li key={p.id} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.contentItem?.title ?? p.platform}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(p.scheduledAt).toLocaleString()} · {p.timezone}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="gap-1 text-[10px]"><PlatformIcon platform={p.platform} /> {p.platform}</Badge>
                        <Badge variant="outline" className={`shrink-0 text-[10px] ${accent.className ?? ""}`} style={accent.style}>{p.status}</Badge>
                      </div>
                    </div>

                    {preflight && !preflight.ok && (
                      <div className="mt-2 text-[11px] text-destructive" role="alert">
                        <p className="flex items-center gap-1 font-medium"><CircleAlert className="h-3.5 w-3.5" aria-hidden /> {t("publishing.preflightIssues")}</p>
                        <ul className="mt-1 list-inside list-disc space-y-0.5">
                          {preflight.issues.map((iss, k) => <li key={k}>{iss}</li>)}
                        </ul>
                      </div>
                    )}
                    {p.error && preflight?.ok !== false && <p className="mt-2 text-[11px] text-muted-foreground">{p.error}</p>}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {rescheduleId === p.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Input type="datetime-local" value={rescheduleValue} onChange={(e) => setRescheduleValue(e.target.value)} className="min-h-11 w-56 text-xs" aria-label={t("publishing.newDateTime")} />
                          <Button size="sm" className="min-h-11" disabled={busyPost === p.id} onClick={() => reschedule(p, rescheduleValue)}>{t("publishing.rescheduleBtn")}</Button>
                          <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setRescheduleId(null)}>{t("common.cancel")}</Button>
                        </div>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="min-h-11" disabled={busyPost === p.id} onClick={() => { setRescheduleId(p.id); setRescheduleValue(toLocalInput(new Date(p.scheduledAt))); }}>
                            {t("publishing.rescheduleTitle")}
                          </Button>
                          <Button size="sm" variant="outline" className="min-h-11" disabled={busyPost === p.id} onClick={() => cancelPost(p)}>
                            {t("publishing.cancelPost")}
                          </Button>
                          <Button size="sm" className="min-h-11" disabled={busyPost === p.id} onClick={() => attemptPublish(p)}>
                            {busyPost === p.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ClipboardCheck className="h-4 w-4" aria-hidden />}
                            {t("publishing.attemptPublish")}
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ClipboardCheck className="h-3.5 w-3.5 text-[var(--neon-2)]" aria-hidden /> {t("publishing.honestNote")}
      </p>

      {/* connect dialog */}
      <Dialog open={connectPlatform !== null} onOpenChange={(o) => { if (!o) setConnectPlatform(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("publishing.connect")} — {connectPlatform ? PLATFORM_TITLES[connectPlatform] : ""}</DialogTitle>
            <DialogDescription>{connectPlatform ? t(`publishing.mode.explain.${platformMeta[connectPlatform]?.mode ?? "NOT_AVAILABLE"}`) : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="conn-account">{t("publishing.accountName")}</Label>
              <Input id="conn-account" className="min-h-11" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            </div>
            <Button className="min-h-11" disabled={connecting} onClick={connect}>
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
              {connecting ? t("publishing.connecting") : t("publishing.connect")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* schedule dialog */}
      <Dialog open={schedOpen} onOpenChange={(o) => { if (!o) setSchedOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-[var(--neon)]" aria-hidden /> {t("publishing.scheduleNew")}</DialogTitle>
            <DialogDescription>{t("publishing.connectionsDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {!approvedItems ? (
              <Skeleton className="h-24 rounded-xl bg-muted/40" />
            ) : approvedItems.length === 0 ? (
              <p className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">{t("publishing.noApproved")}</p>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label>{t("publishing.selectContent")}</Label>
                  <Select value={schedItemId} onValueChange={(v) => {
                    setSchedItemId(v);
                    const it = approvedItems.find((x) => x.id === v);
                    if (it) setSchedPlatform(it.platform);
                  }}>
                    <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {approvedItems.map((it) => <SelectItem key={it.id} value={it.id}>{it.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("publishing.selectPlatform")}</Label>
                  <Select value={schedPlatform} onValueChange={setSchedPlatform}>
                    <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{PLATFORM_TITLES[p]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sched-at">{t("publishing.dateTime")}</Label>
                  <Input id="sched-at" type="datetime-local" className="min-h-11" value={schedAt} onChange={(e) => setSchedAt(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("publishing.timezone")}</Label>
                  <Select value={schedTz} onValueChange={setSchedTz}>
                    <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {schedIssues && (
                  <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive" role="alert">
                    <p className="font-medium">{t("publishing.preflightIssues")}</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                      {schedIssues.map((iss, k) => <li key={k}>{iss}</li>)}
                    </ul>
                  </div>
                )}
                <Button className="min-h-11" disabled={scheduling || !schedItemId} onClick={submitSchedule}>
                  {scheduling ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarClock className="h-4 w-4" aria-hidden />}
                  {t("common.schedule")}
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {/* week post details dialog */}
      <Dialog open={liveWeekPost !== null} onOpenChange={(o) => { if (!o) setWeekPostId(null); }}>
        <DialogContent className="sm:max-w-md">
          {liveWeekPost && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <CalendarRange className="h-4 w-4 text-[var(--neon)]" aria-hidden /> {t("publishing.weekDetails")}
                </DialogTitle>
                <DialogDescription className="line-clamp-2">{liveWeekPost.contentItem?.title ?? liveWeekPost.platform}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="gap-1 text-[10px]"><PlatformIcon platform={liveWeekPost.platform} /> {liveWeekPost.platform}</Badge>
                  {(() => { const a = postStatusAccent(liveWeekPost.status); return (
                    <Badge variant="outline" className={`text-[10px] ${a.className ?? ""}`} style={a.style}>{liveWeekPost.status}</Badge>
                  ); })()}
                  <span className="text-xs text-muted-foreground">{new Date(liveWeekPost.scheduledAt).toLocaleString()} · {liveWeekPost.timezone}</span>
                </div>

                {(() => {
                  let preflight: { ok: boolean; issues: string[] } | null = null;
                  if (liveWeekPost.preflightJson) { try { preflight = JSON.parse(liveWeekPost.preflightJson); } catch { preflight = null; } }
                  return preflight && !preflight.ok ? (
                    <div className="text-[11px] text-destructive" role="alert">
                      <p className="flex items-center gap-1 font-medium"><CircleAlert className="h-3.5 w-3.5" aria-hidden /> {t("publishing.preflightIssues")}</p>
                      <ul className="mt-1 list-inside list-disc space-y-0.5">
                        {preflight.issues.map((iss, k) => <li key={k}>{iss}</li>)}
                      </ul>
                    </div>
                  ) : null;
                })()}

                <div className="grid gap-1.5">
                  <Label htmlFor="wk-resched">{t("publishing.weekNewTime")}</Label>
                  <Input
                    id="wk-resched"
                    type="datetime-local"
                    value={weekReschedValue}
                    onChange={(e) => setWeekReschedValue(e.target.value)}
                    className="min-h-11 text-xs"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="min-h-11"
                    disabled={busyPost === liveWeekPost.id}
                    onClick={() => reschedule(liveWeekPost, weekReschedValue)}
                  >
                    {busyPost === liveWeekPost.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarClock className="h-4 w-4" aria-hidden />}
                    {t("publishing.rescheduleBtn")}
                  </Button>
                  <Button size="sm" variant="outline" className="min-h-11" disabled={busyPost === liveWeekPost.id} onClick={() => cancelPost(liveWeekPost)}>
                    {t("publishing.cancelPost")}
                  </Button>
                  <Button size="sm" className="min-h-11" disabled={busyPost === liveWeekPost.id} onClick={() => { setWeekPostId(null); attemptPublish(liveWeekPost); }}>
                    {busyPost === liveWeekPost.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ClipboardCheck className="h-4 w-4" aria-hidden />}
                    {t("publishing.attemptPublish")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
