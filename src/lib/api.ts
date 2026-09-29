import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function ok<T>(data: T, init?: number) {
  return NextResponse.json({ ok: true, data }, { status: init ?? 200 });
}

export function fail(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ ok: false, error: { code, message, details } }, { status });
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
  return user;
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.status, err.code, err.message, err.details);
    }
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[api]", message);
    return fail(500, "INTERNAL", message);
  }
}

// Ownership check helpers — strict object isolation
export async function assertBrandOwnership(brandId: string, userId: string) {
  const brand = await db.brand.findUnique({ where: { id: brandId } });
  if (!brand || brand.userId !== userId) throw new ApiError(404, "BRAND_NOT_FOUND", "Brand not found");
  return brand;
}

export async function assertContentOwnership(contentId: string, userId: string) {
  const item = await db.contentItem.findUnique({ where: { id: contentId } });
  if (!item || item.userId !== userId) throw new ApiError(404, "CONTENT_NOT_FOUND", "Content item not found");
  return item;
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
