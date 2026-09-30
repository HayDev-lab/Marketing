import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import type { User } from "@prisma/client";

const SESSION_COOKIE = "haydev_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, userAgent?: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({ data: { token: hashToken(token), userId, expiresAt, userAgent: userAgent ?? null } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function destroySession() {
  // Cookie is primary; the x-session-token header is the fallback for
  // cross-site iframe contexts where the browser drops SameSite=Lax cookies.
  const jar = await cookies();
  let token = jar.get(SESSION_COOKIE)?.value ?? null;
  if (!token) {
    const h = await headers();
    token = h.get("x-session-token");
  }
  if (token) {
    await db.session.deleteMany({ where: { token: hashToken(token) } });
  }
  jar.delete(SESSION_COOKIE);
}

// Resolve the session token from cookie first, then header fallback.
async function resolveSessionToken(): Promise<string | null> {
  const jar = await cookies();
  const cookieToken = jar.get(SESSION_COOKIE)?.value;
  if (cookieToken) return cookieToken;
  const h = await headers();
  return h.get("x-session-token");
}

// Resolve a user directly from a raw session token (query-param fallback for
// media elements that cannot send headers/cookies, e.g. <img>, <video>).
export async function getUserFromToken(rawToken: string | null | undefined): Promise<User | null> {
  if (!rawToken) return null;
  const session = await db.session.findUnique({ where: { token: hashToken(rawToken) }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
}

export async function getCurrentUser(): Promise<User | null> {
  const token = await resolveSessionToken();
  if (!token) return null;
  return getUserFromToken(token);
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePassword(password: string): { ok: boolean; reason?: string } {
  if (password.length < 8) return { ok: false, reason: "password_too_short" };
  if (password.length > 128) return { ok: false, reason: "password_too_long" };
  return { ok: true };
}

// Rate limiting (in-memory, per process) — brute force protection
const attempts = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true };
}
