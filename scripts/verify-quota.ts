// One-off ops verification for the §31 quota gate (run from project root).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const EMAIL = "owner@haydev.am";

// Mirror of subscription.ts quota logic against the live DB (module imports of
// @/lib pull next/server, which does not run under plain bun — so replicate
// the credit math exactly as getUsage does).
async function usage(plan: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [spend, running] = await Promise.all([
    db.costLedger.aggregate({ _sum: { estimatedCost: true }, where: { userId: USER_ID, createdAt: { gte: startOfMonth } } }),
    db.generationJob.count({ where: { userId: USER_ID, status: { in: ["PENDING", "RUNNING"] } } }),
  ]);
  const credits = { FREE: 5, CREATOR: 30, PRO: 120, BUSINESS: 500 }[plan] ?? 5;
  const used = spend._sum.estimatedCost ?? 0;
  return { used, credits, remaining: credits - used, running };
}

let USER_ID = "";

async function main() {
  const user = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
  USER_ID = user.id;
  const sub = await db.subscription.findUnique({ where: { userId: user.id } });
  const plan = sub?.plan ?? "FREE";
  const u = await usage(plan);
  console.log(JSON.stringify({ step: "state", plan, ...u }));

  // video cost-per-job on FREE: 0.2 — 0.3 must be blocked, 0.1 must pass
  const videoCap = { FREE: 0.2, CREATOR: 0.6, PRO: 2, BUSINESS: 8 }[plan] ?? 0.2;
  console.log(JSON.stringify({
    step: "gate_video_0.3",
    plan,
    blocked: u.remaining < 0.3 || 0.3 > videoCap,
    expectation: plan === "FREE" ? "blocked (cost_per_job 0.2)" : "allowed",
  }));
  console.log(JSON.stringify({
    step: "gate_video_0.1",
    plan,
    blocked: u.remaining < 0.1 || 0.1 > videoCap,
    expectation: "allowed on every plan",
  }));
}
main().finally(() => db.$disconnect());
