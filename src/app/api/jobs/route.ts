import { NextRequest } from "next/server";
import { ok, handle, requireUser } from "@/lib/api";
import { jobs } from "@/lib/jobs";

// GET /api/jobs — user's job feed (dashboard)
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const limit = Number(new URL(req.url).searchParams.get("limit") ?? 30);
    const list = await jobs.listForUser(user.id, Math.min(100, Math.max(1, limit)));
    return ok(list);
  });
}
