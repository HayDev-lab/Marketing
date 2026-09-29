import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword, validateEmail, validatePassword, createSession, destroySession, getCurrentUser, rateLimit } from "@/lib/auth";
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
      await createSession(user.id, req.headers.get("user-agent") ?? undefined);
      await audit.log({ userId: user.id, action: "auth.register", summary: `User registered: ${email}` });
      return ok({ id: user.id, email: user.email, name: user.name, locale: user.locale });
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
      await createSession(user.id, req.headers.get("user-agent") ?? undefined);
      await audit.log({ userId: user.id, action: "auth.login", summary: `User logged in` });
      return ok({ id: user.id, email: user.email, name: user.name, locale: user.locale });
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
