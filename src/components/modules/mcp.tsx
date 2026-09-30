"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useI18n, api } from "@/lib/use-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Braces, Bot, KeyRound, Copy, Loader2, TriangleAlert, Wrench,
  Eye, PenLine, Sparkles, Send, ShieldCheck, Terminal,
} from "lucide-react";

// ===== types =====
type Preset = "READ_ONLY" | "CREATE_DRAFTS" | "EXECUTE_GENERATIONS" | "PUBLISH_ALLOWED";

interface TokenRow {
  id: string; name: string; prefix: string; preset: Preset;
  canUsePaidGeneration: boolean; canSchedule: boolean; canPublish: boolean;
  maxSpend: number; revoked: boolean; lastUsedAt: string | null; createdAt: string;
}

const PRESETS: Preset[] = ["READ_ONLY", "CREATE_DRAFTS", "EXECUTE_GENERATIONS", "PUBLISH_ALLOWED"];

// Tool registry — honest static mirror of the MCP server spec (POST /api/mcp, JSON-RPC 2.0)
const TOOL_GROUPS: { group: Preset; tools: string[] }[] = [
  {
    group: "READ_ONLY",
    tools: ["business_list", "business_get", "trends_search", "trend_get", "marketing_plan_list", "content_plan_list", "prompt_library_search", "content_get", "analytics_get", "publication_get_status", "job_get"],
  },
  {
    group: "CREATE_DRAFTS",
    tools: ["marketing_plan_create", "content_plan_create", "prompt_compile", "content_create", "content_request_approval"],
  },
  {
    group: "EXECUTE_GENERATIONS",
    tools: ["image_generate", "video_project_create", "video_generate", "tts_generate", "music_generate", "avatar_generate", "job_resume", "job_cancel"],
  },
  {
    group: "PUBLISH_ALLOWED",
    tools: ["post_schedule", "post_publish"],
  },
];

function presetAccent(p: Preset): { style: React.CSSProperties } {
  const varName = p === "READ_ONLY" ? "var(--neon-2)" : p === "CREATE_DRAFTS" ? "var(--neon)" : p === "EXECUTE_GENERATIONS" ? "var(--neon-3)" : "var(--neon)";
  return {
    style: { background: `color-mix(in oklab, ${varName} 14%, transparent)`, color: varName, borderColor: `color-mix(in oklab, ${varName} 40%, transparent)` },
  };
}

// ===== main module =====
export function McpModule(_props: { onBrandsChanged?: () => void }) {
  const { t } = useI18n();

  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<Preset>("READ_ONLY");
  const [canUsePaidGeneration, setCanUsePaidGeneration] = useState(false);
  const [canSchedule, setCanSchedule] = useState(false);
  const [canPublish, setCanPublish] = useState(false);
  const [maxSpend, setMaxSpend] = useState("0");
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setTokens(await api<TokenRow[]>("/api/mcp/tokens"));
    } catch {
      setTokens([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const res = await api<{ id: string; token: string }>("/api/mcp/tokens", {
        method: "POST",
        body: JSON.stringify({ name: name || "MCP client", preset, canUsePaidGeneration, canSchedule, canPublish, maxSpend: Number(maxSpend) || 0 }),
      });
      setFreshToken(res.token);
      setCopied(false);
      setName("");
      setCanUsePaidGeneration(false);
      setCanSchedule(false);
      setCanPublish(false);
      setMaxSpend("0");
      await load();
    } catch (e) {
      toast.error(t("common.error"), { description: (e as Error).message });
    } finally {
      setCreating(false);
    }
  };

  const copyToken = async () => {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken);
      setCopied(true);
      toast.success(t("common.copied"));
    } catch {
      toast.error(t("mcp.createdWarn"));
    }
  };

  const revoke = async (tok: TokenRow) => {
    try {
      await api("/api/mcp/tokens", { method: "PATCH", body: JSON.stringify({ id: tok.id, revoked: true }) });
      setTokens((prev) => (prev ?? []).map((x) => (x.id === tok.id ? { ...x, revoked: true } : x)));
      toast.success(`${tok.prefix}… — ${t("mcp.revoked")}`);
    } catch (e) {
      toast.error(t("common.error"), { description: (e as Error).message });
    }
  };

  return (
    <div className="grid gap-5">
      {/* header */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-strong neon-border rounded-2xl p-5 sm:p-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
          <Braces className="h-5 w-5 text-[var(--neon)]" aria-hidden /> {t("mcp.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("mcp.subtitle")}</p>
      </motion.section>

      {/* explanation */}
      <Card className="glass rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Bot className="h-4 w-4 text-[var(--neon)]" aria-hidden /> {t("mcp.whatTitle")}
            <Badge variant="outline" className="text-[10px]" style={{ background: "color-mix(in oklab, var(--neon-3) 14%, transparent)", color: "var(--neon-3)", borderColor: "color-mix(in oklab, var(--neon-3) 40%, transparent)" }}>
              {t("mcp.status.IMPLEMENTED_NOT_LIVE_VERIFIED")}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0">
          <p className="text-sm leading-relaxed text-foreground/85">{t("mcp.whatDesc")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("mcp.endpoint")}</p>
              <p className="mt-1 flex items-center gap-2 font-mono text-sm">
                <Terminal className="h-4 w-4 text-[var(--neon-2)]" aria-hidden /> POST /api/mcp
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("mcp.protocol")}</p>
              <p className="mt-1 flex items-center gap-2 font-mono text-sm">
                <Braces className="h-4 w-4 text-[var(--neon-3)]" aria-hidden /> JSON-RPC 2.0
              </p>
            </div>
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground" role="note">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--neon-3)]" aria-hidden /> {t("mcp.honestNote")}
          </p>
        </CardContent>
      </Card>

      {/* token create */}
      <Card className="glass rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-[var(--neon-2)]" aria-hidden /> {t("mcp.createTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("mcp.tokensDesc")}</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* fresh token — shown ONCE */}
          {freshToken && (
            <div className="grid gap-2 rounded-xl border border-[color-mix(in_oklab,var(--neon)_50%,transparent)] bg-[color-mix(in_oklab,var(--neon)_10%,transparent)] p-4" role="alert">
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--neon)]">
                <ShieldCheck className="h-4 w-4" aria-hidden /> {t("mcp.createdTitle")}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border/60 bg-background/60 px-3 py-2.5 font-mono text-xs">{freshToken}</code>
                <Button size="sm" className="min-h-11 shrink-0" onClick={copyToken} aria-label={t("common.copy")}>
                  <Copy className="h-4 w-4" aria-hidden /> {copied ? t("common.copied") : t("common.copy")}
                </Button>
              </div>
              <p className="flex items-center gap-2 text-xs text-[var(--neon-3)]">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> {t("mcp.createdWarn")}
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="tok-name">{t("mcp.f.name")}</Label>
              <Input id="tok-name" className="min-h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude Desktop" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tok-preset">{t("mcp.f.preset")}</Label>
              <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
                <SelectTrigger id="tok-preset" className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p} value={p}>
                      <span className="flex flex-col">
                        <span className="font-mono text-xs">{t(`mcp.preset.${p}`)}</span>
                        <span className="text-[10px] text-muted-foreground">{t(`mcp.presetDesc.${p}`)}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{t(`mcp.presetDesc.${preset}`)}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              { label: t("mcp.f.canUsePaidGeneration"), value: canUsePaidGeneration, set: setCanUsePaidGeneration },
              { label: t("mcp.f.canSchedule"), value: canSchedule, set: setCanSchedule },
              { label: t("mcp.f.canPublish"), value: canPublish, set: setCanPublish },
            ]).map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 p-3">
                <Label className="text-xs">{row.label}</Label>
                <Switch checked={row.value} onCheckedChange={row.set} aria-label={row.label} />
              </div>
            ))}
            <div className="grid gap-1.5">
              <Label htmlFor="tok-spend" className="text-xs">{t("mcp.f.maxSpend")}</Label>
              <Input id="tok-spend" type="number" min={0} step="0.5" className="min-h-11" value={maxSpend} onChange={(e) => setMaxSpend(e.target.value)} />
            </div>
          </div>

          <Button className="min-h-11 w-full sm:w-auto sm:justify-self-end" disabled={creating} onClick={create}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
            {t("mcp.createBtn")}
          </Button>
        </CardContent>
      </Card>

      {/* token list */}
      <Card className="glass rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("mcp.listTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="max-h-64 overflow-y-auto scrollbar-thin">
          {tokens === null ? (
            <div className="grid gap-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl bg-muted/40" />)}</div>
          ) : tokens.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("mcp.noTokens")}</p>
          ) : (
            <ul className="grid gap-2">
              {tokens.map((tok) => {
                const accent = presetAccent(tok.preset);
                return (
                  <li key={tok.id} className={`rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 ${tok.revoked ? "opacity-50" : ""}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-[10px]" style={accent.style}>{t(`mcp.preset.${tok.preset}`)}</Badge>
                        <span className="truncate text-sm font-medium">{tok.name}</span>
                        <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{tok.prefix}…</code>
                      </div>
                      {!tok.revoked && (
                        <Button size="sm" variant="outline" className="min-h-11" onClick={() => revoke(tok)} aria-label={`${t("mcp.revoke")} ${tok.name}`}>
                          <TriangleAlert className="h-4 w-4 text-[var(--neon-3)]" aria-hidden /> {t("mcp.revoke")}
                        </Button>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {tok.revoked && <Badge variant="outline" className="text-[10px]">{t("mcp.revoked")}</Badge>}
                      {tok.canUsePaidGeneration && <Badge variant="outline" className="gap-1 text-[10px]"><Sparkles className="h-3 w-3" aria-hidden /> gen</Badge>}
                      {tok.canSchedule && <Badge variant="outline" className="gap-1 text-[10px]"><PenLine className="h-3 w-3" aria-hidden /> sched</Badge>}
                      {tok.canPublish && <Badge variant="outline" className="gap-1 text-[10px]"><Send className="h-3 w-3" aria-hidden /> pub</Badge>}
                      <span>{t("mcp.lastUsed")}: {tok.lastUsedAt ? new Date(tok.lastUsedAt).toLocaleString() : t("mcp.never")}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* tools list */}
      <Card className="glass rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="h-4 w-4 text-[var(--neon-3)]" aria-hidden /> {t("mcp.toolsTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("mcp.toolsDesc")}</p>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 pt-0 sm:grid-cols-2">
          {TOOL_GROUPS.map(({ group, tools }) => {
            const accent = presetAccent(group);
            return (
              <section key={group} aria-label={t(`mcp.group.${group}`)}>
                <Badge variant="outline" className="mb-2 text-[10px]" style={accent.style}>
                  {group === "READ_ONLY" ? <Eye className="mr-1 h-3 w-3" aria-hidden /> : group === "CREATE_DRAFTS" ? <PenLine className="mr-1 h-3 w-3" aria-hidden /> : group === "EXECUTE_GENERATIONS" ? <Sparkles className="mr-1 h-3 w-3" aria-hidden /> : <Send className="mr-1 h-3 w-3" aria-hidden />}
                  {t(`mcp.group.${group}`)} · {t(`mcp.preset.${group}`)}
                </Badge>
                <div className="flex flex-wrap gap-1.5">
                  {tools.map((tool) => (
                    <code key={tool} className="rounded-lg border border-border/60 bg-muted/20 px-2 py-1 font-mono text-[11px] text-foreground/80">
                      {tool}
                    </code>
                  ))}
                </div>
              </section>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
