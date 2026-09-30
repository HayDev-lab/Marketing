"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/lib/store";
import { useI18n, api } from "@/lib/use-i18n";
import { SignalCore } from "@/components/signal-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Radar, Globe, ShieldCheck, Languages, Zap, KeyRound, ArrowLeft, CheckCircle2, Link2, Copy } from "lucide-react";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n";

type ResetStage = "idle" | "request" | "confirm" | "done";

/** Read the one-time reset token from the URL (?reset=<token>) once on load. */
function readResetTokenFromUrl(): string | null {
  try {
    const token = new URLSearchParams(window.location.search).get("reset");
    if (token && /^[a-f0-9]{64}$/.test(token)) return token;
    return null;
  } catch {
    return null;
  }
}

export function AuthView({ onAuthed }: { onAuthed: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const setLocaleStore = useApp((s) => s.setLocale);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // password reset flow state
  const [resetStage, setResetStage] = useState<ResetStage>(() => (readResetTokenFromUrl() ? "confirm" : "idle"));
  const [resetToken, setResetToken] = useState<string | null>(() => readResetTokenFromUrl());
  const [resetEmail, setResetEmail] = useState("");
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // login/register tab (controlled so reset flow can return to it)
  const [tab, setTab] = useState<"login" | "register">("login");

  // if arrived via ?reset=<token>, scrub the token from the address bar
  useEffect(() => {
    if (readResetTokenFromUrl()) {
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const submit = async (mode: "login" | "register", form: FormData) => {
    setLoading(true);
    setError(null);
    setNotice(null);
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
    setNotice(null);
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

  // Step 1: request a reset link for an email
  const requestReset = async (form: FormData) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    const email = String(form.get("email") ?? "").trim();
    try {
      const res = await api<{ delivery: string; resetPath: string; expiresInMin: number }>("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "request-reset", email }),
      });
      if (res?.delivery === "dev_inline" && res.resetPath) {
        setResetLink(res.resetPath);
        setResetEmail(email);
        // dev-inline delivery: show the one-time link directly — no SMTP in
        // this environment, and we never pretend an email was sent
        setResetStage("request");
        setNotice(t("auth.resetDevNote", { min: res.expiresInMin }));
      } else {
        // production path (email delivery configured) — honest confirmation
        setNotice(t("auth.resetEmailSent"));
        setResetStage("idle");
      }
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === "NO_ACCOUNT") setError(t("auth.resetNoAccount"));
      else if (code === "RATE_LIMITED") setError(t("auth.rateLimited"));
      else if (code === "INVALID_EMAIL") setError(t("auth.invalidEmail"));
      else setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  // Step 2: set the new password using the one-time token
  const completeReset = async (form: FormData) => {
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    setError(null);
    setNotice(null);
    if (password !== confirm) {
      setError(t("auth.resetMismatch"));
      return;
    }
    setLoading(true);
    try {
      await api("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "reset-password", token: resetToken, password }),
      });
      setResetStage("done");
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === "INVALID_TOKEN") {
        setError(t("auth.resetInvalidToken"));
      } else if (code === "WEAK_PASSWORD") {
        setError(t("auth.passwordTooShort"));
      } else if (code === "RATE_LIMITED") {
        setError(t("auth.rateLimited"));
      } else {
        setError(t("common.error"));
      }
    } finally {
      setLoading(false);
    }
  };

  const backToLogin = () => {
    setResetStage("idle");
    setResetToken(null);
    setResetLink(null);
    setResetEmail("");
    setError(null);
    setNotice(null);
    setCopied(false);
    setTab("login");
  };

  const copyLink = async () => {
    if (!resetLink) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${resetLink}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the open button still works */
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
              {resetStage === "idle" && (
                <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "register")}>
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
                          <div className="flex items-center justify-between gap-2">
                            <Label htmlFor={`password-${mode}`}>{t("auth.password")}</Label>
                            {mode === "login" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setError(null);
                                  setNotice(null);
                                  setResetStage("request");
                                }}
                                className="text-xs text-[var(--neon)] underline-offset-4 transition hover:underline"
                              >
                                {t("auth.forgot")}
                              </button>
                            )}
                          </div>
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
                        {notice && !error && (
                          <p className="rounded-lg border border-[var(--neon)]/30 bg-[var(--neon)]/10 px-3 py-2 text-sm text-foreground">{notice}</p>
                        )}

                        <Button type="submit" disabled={loading} className="mt-1 h-11 w-full bg-[var(--neon)]/25 text-foreground hover:bg-[var(--neon)]/40">
                          {loading ? t("common.loading") : mode === "login" ? t("auth.login") : t("auth.register")}
                        </Button>
                      </form>
                    </TabsContent>
                  ))}
                </Tabs>
              )}

              {resetStage === "request" && (
                <div>
                  <button
                    type="button"
                    onClick={backToLogin}
                    className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                    {t("auth.backToLogin")}
                  </button>
                  <h2 className="mb-1 flex items-center gap-2 text-xl font-semibold">
                    <KeyRound className="h-5 w-5 text-[var(--neon)]" aria-hidden />
                    {t("auth.resetTitle")}
                  </h2>
                  <p className="mb-6 text-sm text-muted-foreground">{t("auth.resetSubtitle")}</p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      requestReset(new FormData(e.currentTarget));
                    }}
                    className="grid gap-4"
                  >
                    <div className="grid gap-2">
                      <Label htmlFor="reset-email">{t("auth.email")}</Label>
                      <Input
                        id="reset-email"
                        name="email"
                        type="email"
                        required
                        autoComplete="email"
                        defaultValue={resetEmail}
                        placeholder="you@example.com"
                        className="h-11"
                      />
                    </div>

                    {error && (
                      <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {error}
                      </p>
                    )}

                    <Button type="submit" disabled={loading} className="h-11 w-full bg-[var(--neon)]/25 text-foreground hover:bg-[var(--neon)]/40">
                      {loading ? t("common.loading") : t("auth.resetRequest")}
                    </Button>
                  </form>

                  {/* dev-inline delivery: the one-time link is shown directly.
                      Honest behavior — no email is sent in this environment. */}
                  {resetLink && notice && (
                    <div className="mt-5 rounded-xl border border-[var(--neon)]/30 bg-[var(--neon)]/10 p-4">
                      <p className="text-xs leading-relaxed text-muted-foreground">{notice}</p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          onClick={() => {
                            const token = resetLink.split("?reset=")[1];
                            if (token) setResetToken(token);
                            setError(null);
                            setResetStage("confirm");
                          }}
                          className="h-10 flex-1 gap-2"
                        >
                          <Link2 className="h-4 w-4" aria-hidden />
                          {t("auth.resetOpenLink")}
                        </Button>
                        <Button type="button" variant="outline" onClick={copyLink} className="h-10 gap-2">
                          <Copy className="h-4 w-4" aria-hidden />
                          {copied ? t("common.copied") : t("common.copy")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {resetStage === "confirm" && (
                <div>
                  <button
                    type="button"
                    onClick={backToLogin}
                    className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                    {t("auth.backToLogin")}
                  </button>
                  <h2 className="mb-1 flex items-center gap-2 text-xl font-semibold">
                    <KeyRound className="h-5 w-5 text-[var(--neon)]" aria-hidden />
                    {t("auth.resetNewTitle")}
                  </h2>
                  <p className="mb-6 text-sm text-muted-foreground">{t("auth.resetNewSubtitle")}</p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      completeReset(new FormData(e.currentTarget));
                    }}
                    className="grid gap-4"
                  >
                    <div className="grid gap-2">
                      <Label htmlFor="new-password">{t("auth.resetNewPassword")}</Label>
                      <Input id="new-password" name="password" type="password" required minLength={8} autoComplete="new-password" className="h-11" />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="confirm-password">{t("auth.resetConfirmPassword")}</Label>
                      <Input id="confirm-password" name="confirm" type="password" required minLength={8} autoComplete="new-password" className="h-11" />
                    </div>

                    {error && (
                      <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {error}
                      </p>
                    )}

                    <Button type="submit" disabled={loading} className="h-11 w-full bg-[var(--neon)]/25 text-foreground hover:bg-[var(--neon)]/40">
                      {loading ? t("common.loading") : t("auth.resetSave")}
                    </Button>
                  </form>
                </div>
              )}

              {resetStage === "done" && (
                <div className="py-4 text-center">
                  <CheckCircle2 className="mx-auto h-12 w-12 text-[var(--neon-2)]" aria-hidden />
                  <h2 className="mt-4 text-xl font-semibold">{t("auth.resetSuccessTitle")}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{t("auth.resetSuccess")}</p>
                  <Button onClick={backToLogin} className="mt-6 h-11 w-full bg-[var(--neon)]/25 text-foreground hover:bg-[var(--neon)]/40">
                    {t("auth.backToLogin")}
                  </Button>
                </div>
              )}

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
                <Button variant="outline" disabled className="mt-3 h-11 w-full justify-center gap-2 opacity-50" title={t("auth.googleBlocked")}>
                  <Globe className="h-4 w-4 shrink-0" aria-hidden /> Google OAuth
                  <span className="sr-only">{t("auth.googleBlocked")}</span>
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
