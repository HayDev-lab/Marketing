// Cost Ledger — every AI/API call is recorded; hard budget limits block new paid calls.
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { parseJson } from "@/lib/api";

export interface RecordCostInput {
  userId: string;
  brandId?: string;
  jobId?: string;
  provider: string;
  model?: string;
  capability: string;
  estimatedCost: number;
  note?: string;
}

export const ledger = {
  async record(input: RecordCostInput) {
    return db.costLedger.create({
      data: {
        userId: input.userId,
        brandId: input.brandId,
        jobId: input.jobId,
        provider: input.provider,
        model: input.model,
        capability: input.capability,
        estimatedCost: input.estimatedCost,
        note: input.note,
      },
    });
  },

  async recordActual(userId: string, jobId: string, actualCost: number) {
    const entry = await db.costLedger.findFirst({ where: { userId, jobId }, orderBy: { createdAt: "desc" } });
    if (entry) {
      await db.costLedger.update({ where: { id: entry.id }, data: { actualCost } });
    } else {
      await db.costLedger.create({
        data: { userId, jobId, provider: "unknown", capability: "UNKNOWN", estimatedCost: 0, actualCost },
      });
    }
  },

  async usage(userId: string) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay.getTime() - ((now.getDay() + 6) % 7) * 24 * 3600 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const start14 = new Date(startOfDay.getTime() - 13 * 24 * 3600 * 1000);
    const [today, week, month, byProvider, byCapability, total, recent] = await Promise.all([
      db.costLedger.aggregate({ _sum: { estimatedCost: true }, where: { userId, createdAt: { gte: startOfDay } } }),
      db.costLedger.aggregate({ _sum: { estimatedCost: true }, where: { userId, createdAt: { gte: startOfWeek } } }),
      db.costLedger.aggregate({ _sum: { estimatedCost: true }, where: { userId, createdAt: { gte: startOfMonth } } }),
      db.costLedger.groupBy({ by: ["provider"], _sum: { estimatedCost: true }, where: { userId } }),
      db.costLedger.groupBy({ by: ["capability"], _sum: { estimatedCost: true }, where: { userId } }),
      db.costLedger.aggregate({ _sum: { estimatedCost: true }, where: { userId } }),
      db.costLedger.findMany({
        where: { userId, createdAt: { gte: start14 } },
        select: { estimatedCost: true, createdAt: true },
      }),
    ]);
    // 14-day daily series (UTC-day buckets, oldest → newest) for the dashboard sparkline
    const daily14: { date: string; cost: number }[] = [];
    const dayMap = new Map<string, number>();
    for (const row of recent) {
      const key = row.createdAt.toISOString().slice(0, 10);
      dayMap.set(key, (dayMap.get(key) ?? 0) + (row.estimatedCost ?? 0));
    }
    for (let i = 13; i >= 0; i--) {
      const d = new Date(startOfDay.getTime() - i * 24 * 3600 * 1000);
      const key = d.toISOString().slice(0, 10);
      daily14.push({ date: key, cost: Math.round((dayMap.get(key) ?? 0) * 10000) / 10000 });
    }
    return {
      today: today._sum.estimatedCost ?? 0,
      week: week._sum.estimatedCost ?? 0,
      month: month._sum.estimatedCost ?? 0,
      total: total._sum.estimatedCost ?? 0,
      daily14,
      byProvider: byProvider.map((r) => ({ provider: r.provider, cost: r._sum.estimatedCost ?? 0 })),
      byCapability: byCapability.map((r) => ({ capability: r.capability, cost: r._sum.estimatedCost ?? 0 })),
    };
  },

  // Hard budget gate — blocks NEW paid calls. Does not affect in-flight result retrieval.
  async assertBudget(userId: string, estimatedCost: number) {
    const policy = await db.autopilotPolicy.findUnique({ where: { userId } });
    if (!policy) return; // no policy → no autopilot budgets enforced (manual mode still records costs)
    const usage = await this.usage(userId);
    if (usage.today + estimatedCost > policy.dailyBudget) {
      throw new ApiError(402, "DAILY_BUDGET_EXCEEDED", `Daily budget limit reached (${policy.dailyBudget}). Today: ${usage.today.toFixed(2)}.`);
    }
    if (usage.month + estimatedCost > policy.monthlyBudget) {
      throw new ApiError(402, "MONTHLY_BUDGET_EXCEEDED", `Monthly budget limit reached (${policy.monthlyBudget}).`);
    }
    if (estimatedCost > policy.maxGenerationCost) {
      throw new ApiError(402, "GENERATION_COST_TOO_HIGH", `Estimated cost ${estimatedCost.toFixed(2)} exceeds max generation cost ${policy.maxGenerationCost}.`);
    }
  },

  async mcpSpendCheck(mcpTokenId: string, estimatedCost: number) {
    const token = await db.mcpToken.findUnique({ where: { id: mcpTokenId } });
    if (!token) return;
    if (token.maxSpend > 0) {
      const spent = await db.costLedger.aggregate({
        _sum: { estimatedCost: true },
        where: { userId: (await db.mcpToken.findUnique({ where: { id: token.id } }))!.userId },
      });
      if ((spent._sum.estimatedCost ?? 0) + estimatedCost > token.maxSpend) {
        throw new ApiError(402, "MCP_SPEND_LIMIT", "MCP token spend limit reached");
      }
    }
  },
};

// Audit trail — every action is traceable with actor type (WEB_UI / MCP / AUTOPILOT / SYSTEM).
export const audit = {
  async log(input: {
    userId?: string;
    actorType?: "WEB_UI" | "MCP" | "AUTOPILOT" | "SYSTEM";
    actorId?: string;
    action: string;
    objectType?: string;
    objectId?: string;
    summary?: string;
    meta?: Record<string, unknown>;
  }) {
    await db.auditLog.create({
      data: {
        userId: input.userId,
        actorType: input.actorType ?? "WEB_UI",
        actorId: input.actorId,
        action: input.action,
        objectType: input.objectType,
        objectId: input.objectId,
        summary: input.summary?.slice(0, 500),
        metaJson: input.meta ? JSON.stringify(input.meta) : undefined,
      },
    });
  },
};

export { parseJson };
