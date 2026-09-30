import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, requireUser } from "@/lib/api";

// GET /api/audit?actorType= — audit trail (secrets never logged)
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const actorType = new URL(req.url).searchParams.get("actorType");
    const logs = await db.auditLog.findMany({
      where: { userId: user.id, ...(actorType ? { actorType } : {}) },
      orderBy: { createdAt: "desc" },
      take: 80,
    });
    return ok(logs);
  });
}
