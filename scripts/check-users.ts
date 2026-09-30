import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const users = await db.user.findMany({
    select: { id: true, email: true, name: true, createdAt: true, resetToken: true, resetExpires: true },
  });
  console.log("=== USERS ===");
  for (const u of users) {
    console.log(JSON.stringify({
      email: u.email, name: u.name, id: u.id.slice(-6),
      hasResetToken: !!u.resetToken, resetExpires: u.resetExpires,
      createdAt: u.createdAt.toISOString(),
    }));
  }
  const sessions = await db.session.findMany({
    select: { id: true, userId: true, expiresAt: true, createdAt: true, userAgent: true },
  });
  console.log("=== SESSIONS ===");
  for (const s of sessions) {
    const u = users.find(x => x.id === s.userId);
    console.log(JSON.stringify({
      email: u?.email ?? "?", expiresAt: s.expiresAt.toISOString(),
      createdAt: s.createdAt.toISOString(), ua: (s.userAgent ?? "").slice(0, 60),
    }));
  }
  const brands = await db.brand.findMany({ select: { id: true, name: true, userId: true } });
  console.log("=== BRANDS ===");
  for (const b of brands) {
    const u = users.find(x => x.id === b.userId);
    console.log(JSON.stringify({ name: b.name, owner: u?.email }));
  }
  const contentCount = await db.contentItem.count();
  const jobCount = await db.generationJob.count();
  console.log(JSON.stringify({ contentCount, jobCount }));
}
main().finally(() => db.$disconnect());
