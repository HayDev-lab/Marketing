import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const rows = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 12 });
  for (const r of rows) {
    console.log(JSON.stringify({
      at: r.createdAt.toISOString(), action: r.action, actor: r.actorType,
      summary: (r.summary ?? "").slice(0, 70),
    }));
  }
}
main().finally(() => db.$disconnect());
