"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, Building2, Flame, CalendarRange, FileStack, Library,
  ImageIcon, Clapperboard, AudioLines, Send, BarChart3, Settings, Plug,
  Command, Hand, Zap, Languages, Search, ScanFace,
} from "lucide-react";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import { useApp, type ViewId } from "@/lib/store";
import { useI18n } from "@/lib/use-i18n";
import type { Locale } from "@/lib/i18n";
import { Music4, ShieldCheck } from "lucide-react";

const NAV_ITEMS: { id: ViewId; icon: React.ComponentType<{ className?: string }>; key: string; shortcut: string }[] = [
  { id: "dashboard", icon: LayoutDashboard, key: "nav.dashboard", shortcut: "G D" },
  { id: "brands", icon: Building2, key: "nav.brands", shortcut: "G B" },
  { id: "trends", icon: Flame, key: "nav.trends", shortcut: "G T" },
  { id: "planner", icon: CalendarRange, key: "nav.planner", shortcut: "G P" },
  { id: "content", icon: FileStack, key: "nav.content", shortcut: "G C" },
  { id: "prompts", icon: Library, key: "nav.prompts", shortcut: "G L" },
  { id: "image", icon: ImageIcon, key: "nav.image", shortcut: "G I" },
  { id: "video", icon: Clapperboard, key: "nav.video", shortcut: "G V" },
  { id: "voice", icon: AudioLines, key: "nav.voice", shortcut: "G O" },
  { id: "avatar", icon: ScanFace, key: "nav.avatar", shortcut: "G F" },
  { id: "music", icon: Music4, key: "nav.music", shortcut: "G U" },
  { id: "publishing", icon: Send, key: "nav.publishing", shortcut: "G S" },
  { id: "analytics", icon: BarChart3, key: "nav.analytics", shortcut: "G A" },
  { id: "settings", icon: Settings, key: "nav.settings", shortcut: "G ," },
  { id: "admin", icon: ShieldCheck, key: "nav.admin", shortcut: "G X" }, // §30 — admins only (filtered below)
  { id: "mcp", icon: Plug, key: "nav.mcp", shortcut: "G M" },
];

const LANGS: { id: Locale; label: string; flag: string }[] = [
  { id: "hy", label: "Հայերեն", flag: "🇦🇲" },
  { id: "ru", label: "Русский", flag: "🇷🇺" },
  { id: "en", label: "English", flag: "🇬🇧" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [seq, setSeq] = useState<string>("");
  const setView = useApp((s) => s.setView);
  const view = useApp((s) => s.view);
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const { t, locale, setLocale } = useI18n();
  const isAdmin = useApp((s) => s.user)?.isAdmin === true;
  const navItems = useMemo(
    () => NAV_ITEMS.filter((item) => item.id !== "admin" || isAdmin),
    [isAdmin]
  );

  // ⌘K / Ctrl+K toggles the palette; "g<letter>" jumps between modules
  useEffect(() => {
    let gArmed = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (open || typing) return;
      if (e.key.toLowerCase() === "g" && !gArmed) {
        gArmed = true;
        setSeq("G");
        if (gTimer) clearTimeout(gTimer);
        gTimer = setTimeout(() => { gArmed = false; setSeq(""); }, 1600);
        return;
      }
      if (gArmed) {
        const letter = e.key.toLowerCase();
        const map: Record<string, ViewId> = {
          d: "dashboard", b: "brands", t: "trends", p: "planner", c: "content",
          l: "prompts", i: "image", v: "video", o: "voice", f: "avatar", u: "music", s: "publishing",
          a: "analytics", ",": "settings", m: "mcp",
        };
        gArmed = false;
        setSeq("");
        if (gTimer) clearTimeout(gTimer);
        if (map[letter] && (map[letter] !== "admin" || isAdmin)) {
          e.preventDefault();
          setView(map[letter]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (gTimer) clearTimeout(gTimer);
    };
  }, [open, setView, isAdmin]);

  // expose an opener for the top bar button
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("haydev:open-command-palette", handler);
    return () => window.removeEventListener("haydev:open-command-palette", handler);
  }, []);

  const navGroups = useMemo(() => (
    <CommandGroup heading={t("cmd.navigate")}>
      {navItems.map((item) => (
        <CommandItem
          key={item.id}
          value={t(item.key) + " " + item.id}
          onSelect={() => { setView(item.id); setOpen(false); }}
          className="gap-3 aria-selected:bg-[var(--neon)]/15"
        >
          <item.icon className="h-4 w-4 text-[var(--neon)]" aria-hidden />
          <span>{t(item.key)}</span>
          {view === item.id && <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-[var(--neon-2)]">{t("cmd.current")}</span>}
          {view !== item.id && <CommandShortcut className="font-mono text-[10px] text-muted-foreground">{item.shortcut}</CommandShortcut>}
        </CommandItem>
      ))}
    </CommandGroup>
  ), [t, setView, view, navItems]);

  const actionGroups = useMemo(() => (
    <>
      <CommandSeparator />
      <CommandGroup heading={t("cmd.actions")}>
        <CommandItem
          value={mode === "manual" ? t("cmd.toAutopilot") : t("cmd.toManual")}
          onSelect={() => { setMode(mode === "manual" ? "autopilot" : "manual"); setOpen(false); }}
          className="gap-3"
        >
          {mode === "manual" ? <Zap className="h-4 w-4 text-[var(--neon-3)]" aria-hidden /> : <Hand className="h-4 w-4 text-[var(--neon-2)]" aria-hidden />}
          <span>{mode === "manual" ? t("cmd.toAutopilot") : t("cmd.toManual")}</span>
        </CommandItem>
        {LANGS.map((l) => (
          <CommandItem
            key={l.id}
            value={t("cmd.language") + " " + l.label}
            onSelect={() => { setLocale(l.id); setOpen(false); }}
            className="gap-3"
          >
            <Languages className="h-4 w-4 text-[var(--neon-2)]" aria-hidden />
            <span>{l.flag} {l.label}</span>
            {locale === l.id && <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-[var(--neon-2)]">{t("cmd.current")}</span>}
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  ), [t, mode, setMode, locale, setLocale]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("cmd.title")}
      description={t("cmd.title")}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-4 pt-3">
        <Search className="h-4 w-4 shrink-0 text-[var(--neon)]" aria-hidden />
        <CommandInput placeholder={t("cmd.placeholder")} className="h-11 border-0 focus:ring-0" />
      </div>
      <CommandList className="scrollbar-thin">
        <CommandEmpty>{t("cmd.noResults")}</CommandEmpty>
        {navGroups}
        {actionGroups}
      </CommandList>
      <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Command className="h-3 w-3" aria-hidden /> K — {t("cmd.title")}
        </span>
        <span className="hidden font-mono sm:inline" aria-live="polite">{seq ? seq + "…" : "G→D B T P C L I V O F U S A , M"}</span>
      </div>
    </CommandDialog>
  );
}

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent("haydev:open-command-palette"));
}
