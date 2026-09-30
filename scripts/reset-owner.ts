import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";

const db = new PrismaClient();
const EMAIL = "owner@haydev.am";
const NEW_PASSWORD = "HayDev2026!";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const user = await db.user.findUnique({ where: { email: EMAIL } });
  if (!user) throw new Error(`User ${EMAIL} not found`);

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(NEW_PASSWORD),
      resetToken: null,
      resetExpires: null,
    },
  });

  // force re-login everywhere — old cookies are dead
  const killed = await db.session.deleteMany({ where: { userId: user.id } });

  await db.auditLog.create({
    data: {
      userId: user.id,
      actorType: "SYSTEM",
      action: "auth.serverReset",
      objectType: "User",
      objectId: user.id,
      summary: "Server-side password reset to restore panel access (user locked out, 6x 401 in logs)",
    },
  });

  console.log(JSON.stringify({ ok: true, email: EMAIL, sessionsKilled: killed.count }));
}
main().finally(() => db.$disconnect());
