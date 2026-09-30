"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/lib/store";
import { useI18n, api } from "@/lib/use-i18n";
import { SignalCore } from "@/components/signal-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Radar, Globe, ShieldCheck, Languages, Zap } from "lucide-react";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n";

export function AuthView({ onAuthed }: { onAuthed: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const setLocaleStore = useApp((s) => s.setLocale);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (mode: "login" | "register", form: FormData) => {
    setLoading(true);
    setError(null);
    try {
      await api("/api/auth", {
        method: "POST",
        body: JSON.stringify({
          action: mode,
          email: form.get("email"),
          password: form.get("password"),
          name: form.get("name") || undefined,
          locale,
        }),
      });
      setLocaleStore(locale);
      onAuthed();
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      const map: Record<string, string> = {
        INVALID_CREDENTIALS: "auth.invalidCredentials",
        EMAIL_TAKEN: "auth.emailTaken",
        WEAK_PASSWORD: "auth.passwordTooShort",
        INVALID_EMAIL: "auth.invalidEmail",
      };
      setError(t(map[code as string] ?? "common.error"));
    } finally {
      setLoading(false);
    }
  };

  // One-click demo entrance — the shared sandbox workspace (real account,
  // real data). Credentials never touch the client bundle: the server
  // creates the session itself.
  const demoLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ locale?: string }>("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "demo" }),
      });
      if (res?.locale && ["hy", "ru", "en"].includes(res.locale)) {
        setLocale(res.locale as Locale);
        setLocaleStore(res.locale as Locale);
      }
      onAuthed();
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden">
      <SignalCore className="absolute inset-0 opacity-80" />
      <div className="grid-bg absolute inset-0" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6">
        {/* language switch */}
        <nav className="flex items-center justify-end gap-1" aria-label="Language">
          <Languages className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden />
          {LOCALES.map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={`rounded-full px-3 py-1.5 text-xs transition ${
                locale === l ? "bg-[var(--neon)]/20 text-[var(--neon)] neon-border" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {LOCALE_LABELS[l]}
            </button>
          ))}
        </nav>

        <div className="flex flex-1 flex-col items-center justify-center gap-10 py-10 lg:flex-row lg:gap-20">
          {/* Brand hero */}
          <motion.section
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="max-w-xl text-center lg:text-left"
          >
            <div className="mb-4 inline-flex items-center gap-2 rounded-full glass px-4 py-1.5 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-[var(--neon-2)] status-dot text-[var(--neon-2)]" />
              AI MARKETING OPERATING SYSTEM
            </div>
            <h1 className="text-5xl font-bold leading-tight lg:text-6xl">
              <span className="neon-text">ՀայDev</span> Marketing
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">{t("app.tagline")}</p>
            <ul className="mt-8 grid gap-3 text-sm text-foreground/80 sm:grid-cols-2">
              {[
                { icon: Radar, text: "Trend Intelligence Agent" },
                { icon: Sparkles, text: "Image · Video · Voice · Music" },
                { icon: Globe, text: "Հայերեն · Русский · English" },
                { icon: ShieldCheck, text: "Durable jobs · Resume · Audit" },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="glass glass-hover flex items-center gap-3 rounded-xl px-4 py-3">
                  <Icon className="h-4 w-4 shrink-0 text-[var(--neon)]" aria-hidden />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </motion.section>

          {/* Auth card */}
          <motion.section
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="w-full max-w-md"
          >
            <div className="glass-strong neon-border rounded-2xl p-6 sm:p-8">
              <Tabs defaultValue="login">
                <TabsList className="mb-6 grid w-full grid-cols-2">
                  <TabsTrigger value="login">{t("auth.login")}</TabsTrigger>
                  <TabsTrigger value="register">{t("auth.register")}</TabsTrigger>
                </TabsList>

                {(["login", "register"] as const).map((mode) => (
                  <TabsContent key={mode} value={mode}>
                    <h2 className="mb-1 text-xl font-semibold">{t(`auth.${mode}Title` as const)}</h2>
                    <p className="mb-6 text-sm text-muted-foreground">{t(`auth.${mode}Subtitle` as const)}</p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        submit(mode, new FormData(e.currentTarget));
                      }}
                      className="grid gap-4"
                    >
                      {mode === "register" && (
                        <div className="grid gap-2">
                          <Label htmlFor="name">{t("auth.name")}</Label>
                          <Input id="name" name="name" autoComplete="name" className="h-11" />
                        </div>
                      )}
                      <div className="grid gap-2">
                        <Label htmlFor={`email-${mode}`}>{t("auth.email")}</Label>
                        <Input id={`email-${mode}`} name="email" type="email" required autoComplete="email" className="h-11" />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`password-${mode}`}>{t("auth.password")}</Label>
                        <Input
                          id={`password-${mode}`}
                          name="password"
                          type="password"
                          required
                          minLength={8}
                          autoComplete={mode === "login" ? "current-password" : "new-password"}
                          className="h-11"
                        />
                      </div>

                      {error && (
                        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                          {error}
                        </p>
                      )}

                      <Button type="submit" disabled={loading} className="mt-1 h-11 w-full bg-[var(--neon)]/25 text-foreground hover:bg-[var(--neon)]/40">
                        {loading ? t("common.loading") : mode === "login" ? t("auth.login") : t("auth.register")}
                      </Button>
                    </form>
                  </TabsContent>
                ))}
              </Tabs>

              <div className="mt-6 border-t border-border pt-4">
                <Button
                  type="button"
                  disabled={loading}
                  onClick={demoLogin}
                  className="h-11 w-full justify-center bg-[var(--neon-2)]/15 text-foreground hover:bg-[var(--neon-2)]/25"
                >
                  <Zap className="mr-2 h-4 w-4 text-[var(--neon-2)]" aria-hidden />
                  {loading ? t("common.loading") : t("auth.demoLogin")}
                </Button>
                <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
                  {t("auth.demoHint")}
                </p>
                <Button variant="outline" disabled className="mt-3 h-11 w-full justify-center opacity-50" title={t("auth.googleBlocked")}>
                  <Globe className="mr-2 h-4 w-4" /> Google OAuth — {t("auth.googleBlocked")}
                </Button>
                <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
                  Email + Password auth is live. Google OAuth adapter is BLOCKED_EXTERNAL in this environment (no OAuth credentials).
                </p>
              </div>
            </div>
          </motion.section>
        </div>

        {/* sticky footer */}
        <footer className="mt-auto flex items-center justify-between border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} ՀայDev Marketing</span>
          <span>{t("footer.rights")}</span>
        </footer>
      </div>
    </main>
  );
}
