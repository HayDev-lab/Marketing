import { NextRequest } from "next/server";
import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword, validateEmail, validatePassword, createSession, destroySession, getCurrentUser, rateLimit, hashToken } from "@/lib/auth";
import { ok, fail, handle, ApiError } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { buildSeedTemplates } from "@/lib/prompt-library-seed";
import { PROVIDER_REGISTRY } from "@/lib/ai/registry";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await req.json();
    const action = body?.action;

    if (action === "register") {
      const ip = req.headers.get("x-forwarded-for") ?? "local";
      const rl = rateLimit(`register:${ip}`, 10, 60_000);
      if (!rl.allowed) throw new ApiError(429, "RATE_LIMITED", `Too many attempts. Retry in ${rl.retryAfterSec}s`);
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const name = body.name ? String(body.name).slice(0, 100) : null;
      if (!validateEmail(email)) throw new ApiError(400, "INVALID_EMAIL", "Invalid email address");
      const pw = validatePassword(password);
      if (!pw.ok) throw new ApiError(400, "WEAK_PASSWORD", pw.reason ?? "Weak password");
      const existing = await db.user.findUnique({ where: { email } });
      if (existing) throw new ApiError(409, "EMAIL_TAKEN", "This email is already taken");

      const user = await db.user.create({
        data: { email, name, passwordHash: hashPassword(password), locale: ["hy", "ru", "en"].includes(body.locale) ? body.locale : "hy" },
      });

      // Seed global prompt library (once) + default provider configs + autopilot policy
      const templateCount = await db.promptTemplate.count({ where: { userId: null } });
      if (templateCount === 0) {
        const seeds = buildSeedTemplates();
        await db.promptTemplate.createMany({
          data: seeds.map((s) => ({
            niche: s.niche,
            type: s.type,
            title: s.title,
            body: s.body,
            variablesJson: JSON.stringify(s.variables),
            tagsJson: JSON.stringify(s.tags),
          })),
        });
      }
      await db.providerConfig.createMany({
        data: PROVIDER_REGISTRY.map((p) => ({
          userId: user.id,
          providerId: p.providerId,
          category: p.category,
          enabled: p.status !== "BLOCKED_EXTERNAL",
          status: p.status,
          defaultModel: p.defaultModel,
        })),
      });
      await db.autopilotPolicy.create({ data: { userId: user.id } }).catch(() => {});
      const sessionToken = await createSession(user.id, req.headers.get("user-agent") ?? undefined);
      await audit.log({ userId: user.id, action: "auth.register", summary: `User registered: ${email}` });
      // sessionToken: needed when cookies are unavailable (cross-site iframe preview)
      return ok({ id: user.id, email: user.email, name: user.name, locale: user.locale, sessionToken });
    }

    if (action === "login") {
      const ip = req.headers.get("x-forwarded-for") ?? "local";
      const rl = rateLimit(`login:${ip}`, 15, 60_000);
      if (!rl.allowed) throw new ApiError(429, "RATE_LIMITED", `Too many attempts. Retry in ${rl.retryAfterSec}s`);
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const user = await db.user.findUnique({ where: { email } });
      if (!user || !verifyPassword(password, user.passwordHash)) {
        throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
      }
      const sessionToken = await createSession(user.id, req.headers.get("user-agent") ?? undefined);
      await audit.log({ userId: user.id, action: "auth.login", summary: `User logged in` });
      return ok({ id: user.id, email: user.email, name: user.name, locale: user.locale, sessionToken });
    }

    if (action === "demo") {
      // Demo entrance: one click into the shared sandbox workspace (real
      // account, real data — nothing is faked). The credentials stay
      // server-side; the client bundle never contains them.
      const ip = req.headers.get("x-forwarded-for") ?? "local";
      const rl = rateLimit(`demo:${ip}`, 10, 60_000);
      if (!rl.allowed) throw new ApiError(429, "RATE_LIMITED", `Too many attempts. Retry in ${rl.retryAfterSec}s`);
      const email = "qa4@haydev.am";
      let user = await db.user.findUnique({ where: { email } });
      if (!user) {
        // self-heal: recreate the demo workspace if it was ever wiped
        const password = `demo-${createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 18)}`;
        const created = await db.user.create({
          data: { email, name: "Demo Workspace", passwordHash: hashPassword(password), locale: "hy" },
        });
        user = created;
        const templateCount = await db.promptTemplate.count({ where: { userId: null } });
        if (templateCount === 0) {
          const seeds = buildSeedTemplates();
          await db.promptTemplate.createMany({
            data: seeds.map((s) => ({
              niche: s.niche, type: s.type, title: s.title, body: s.body,
              variablesJson: JSON.stringify(s.variables), tagsJson: JSON.stringify(s.tags),
            })),
          });
        }
        await db.providerConfig.createMany({
          data: PROVIDER_REGISTRY.map((p) => ({
            userId: created.id, providerId: p.providerId, category: p.category,
            enabled: p.status !== "BLOCKED_EXTERNAL", status: p.status, defaultModel: p.defaultModel,
          })),
        });
        await db.autopilotPolicy.create({ data: { userId: created.id } }).catch(() => {});
      }
      const sessionToken = await createSession(user.id, req.headers.get("user-agent") ?? undefined);
      await audit.log({ userId: user.id, action: "auth.demo", summary: "Demo workspace login" });
      return ok({ id: user.id, email: user.email, name: user.name, locale: user.locale, demo: true, sessionToken });
    }

    if (action === "request-reset") {
      const ip = req.headers.get("x-forwarded-for") ?? "local";
      const rl = rateLimit(`reset-req:${ip}`, 5, 60_000);
      if (!rl.allowed) throw new ApiError(429, "RATE_LIMITED", `Too many attempts. Retry in ${rl.retryAfterSec}s`);
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!validateEmail(email)) throw new ApiError(400, "INVALID_EMAIL", "Invalid email address");
      const user = await db.user.findUnique({ where: { email } });
      if (!user) throw new ApiError(404, "NO_ACCOUNT", "No account found with this email");

      // One-time reset token: raw token never stored — only its SHA-256 hash.
      // Expires in 30 minutes; a successful reset invalidates it and every
      // active session of the account.
      const token = randomBytes(32).toString("hex");
      const resetExpires = new Date(Date.now() + 30 * 60 * 1000);
      await db.user.update({ where: { id: user.id }, data: { resetToken: hashToken(token), resetExpires } });
      await audit.log({ userId: user.id, action: "auth.resetRequested", summary: `Password reset requested for ${email}` });

      // Honest delivery status: this sandbox has no SMTP provider, so the
      // one-time link is returned inline (labeled dev_inline) instead of
      // pretending an email was sent. In production this branch would
      // dispatch an email and return { delivery: "email" } with no token.
      return ok({
        delivery: "dev_inline" as const,
        resetPath: `/?reset=${token}`,
        expiresInMin: 30,
      });
    }

    if (action === "reset-password") {
      const ip = req.headers.get("x-forwarded-for") ?? "local";
      const rl = rateLimit(`reset-do:${ip}`, 10, 60_000);
      if (!rl.allowed) throw new ApiError(429, "RATE_LIMITED", `Too many attempts. Retry in ${rl.retryAfterSec}s`);
      const token = String(body.token ?? "");
      const password = String(body.password ?? "");
      if (!token) throw new ApiError(400, "INVALID_TOKEN", "Reset link is invalid or expired");
      const pw = validatePassword(password);
      if (!pw.ok) throw new ApiError(400, "WEAK_PASSWORD", pw.reason ?? "Weak password");
      const user = await db.user.findFirst({ where: { resetToken: hashToken(token) } });
      if (!user || !user.resetExpires || user.resetExpires.getTime() < Date.now()) {
        throw new ApiError(400, "INVALID_TOKEN", "Reset link is invalid or expired");
      }
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: hashPassword(password), resetToken: null, resetExpires: null },
      });
      // force re-login everywhere after a password change
      await db.session.deleteMany({ where: { userId: user.id } });
      await audit.log({ userId: user.id, action: "auth.resetCompleted", summary: `Password reset completed for ${user.email}` });
      return ok({ reset: true, email: user.email });
    }

    if (action === "logout") {
      const user = await getCurrentUser();
      await destroySession();
      if (user) await audit.log({ userId: user.id, action: "auth.logout" });
      return ok({ loggedOut: true });
    }

    if (action === "locale") {
      const user = await getCurrentUser();
      if (!user) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
      if (!["hy", "ru", "en"].includes(body.locale)) throw new ApiError(400, "INVALID", "Bad locale");
      await db.user.update({ where: { id: user.id }, data: { locale: body.locale } });
      return ok({ locale: body.locale });
    }

    throw new ApiError(400, "BAD_ACTION", "Unknown action");
  });
}
