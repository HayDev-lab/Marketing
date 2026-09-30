// Subscriptions (MASTER PROMPT §31) — four public plans + credit quotas.
//
// Design rules from the spec:
//  - Plans are NEVER bound to concrete model names; each modality policy
//    constrains cost-per-job and quality tier instead, so a deprecated model
//    can be swapped in the registry without touching business logic.
//  - Credits are derived from the real CostLedger (actual estimated spend),
//    not from a counter that can drift.
//  - This environment has no payment processor: switching plans is an honest
//    sandbox switch (instant, audit-logged). Nothing pretends to be billing.

import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";

export type PlanId = "FREE" | "CREATOR" | "PRO" | "BUSINESS";
export const PLAN_IDS: PlanId[] = ["FREE", "CREATOR", "PRO", "BUSINESS"];

export interface ModalityPolicy {
  /** Hard cap per single job in credits (1 credit = $0.01 of estimated cost). */
  maxCostPerJob: number;
  /** Registry quality tiers allowed for this plan ("cost" | "balanced" | "premium"). */
  allowedQualityTiers: ("cost" | "balanced" | "premium")[];
  /** Max generated video length in seconds (video modality only). */
  maxDurationSec?: number;
  /** Monthly count cap for this capability (null = unlimited within credits). */
  monthlyCountCap: number | null;
  manualOverrideAllowed: boolean;
}

export interface PlanConfig {
  id: PlanId;
  monthlyCredits: number;
  maxConcurrentJobs: number;
  maxBrands: number;
  features: {
    autopilot: boolean;
    mcp: boolean;
    avatar: boolean;
    publishing: boolean;
    analytics: boolean;
    advancedTrends: boolean;
  };
  policies: {
    image: ModalityPolicy;
    video: ModalityPolicy;
    tts: ModalityPolicy;
    transcription: ModalityPolicy;
    music: ModalityPolicy;
  };
}

export const PLANS: Record<PlanId, PlanConfig> = {
  FREE: {
    id: "FREE",
    monthlyCredits: 5, // 5.00 credits ≈ 250 cheap image calls
    maxConcurrentJobs: 1,
    maxBrands: 1,
    features: { autopilot: false, mcp: false, avatar: false, publishing: true, analytics: true, advancedTrends: false },
    policies: {
      image: { maxCostPerJob: 0.05, allowedQualityTiers: ["cost"], monthlyCountCap: 120, manualOverrideAllowed: false },
      video: { maxCostPerJob: 0.2, allowedQualityTiers: ["cost"], maxDurationSec: 15, monthlyCountCap: 4, manualOverrideAllowed: false },
      tts: { maxCostPerJob: 0.02, allowedQualityTiers: ["cost"], monthlyCountCap: 60, manualOverrideAllowed: false },
      transcription: { maxCostPerJob: 0.02, allowedQualityTiers: ["cost"], monthlyCountCap: 30, manualOverrideAllowed: false },
      music: { maxCostPerJob: 0.02, allowedQualityTiers: ["cost"], monthlyCountCap: 20, manualOverrideAllowed: false },
    },
  },
  CREATOR: {
    id: "CREATOR",
    monthlyCredits: 30,
    maxConcurrentJobs: 3,
    maxBrands: 3,
    features: { autopilot: true, mcp: false, avatar: false, publishing: true, analytics: true, advancedTrends: true },
    policies: {
      image: { maxCostPerJob: 0.15, allowedQualityTiers: ["cost", "balanced"], monthlyCountCap: 600, manualOverrideAllowed: true },
      video: { maxCostPerJob: 0.6, allowedQualityTiers: ["cost", "balanced"], maxDurationSec: 30, monthlyCountCap: 30, manualOverrideAllowed: true },
      tts: { maxCostPerJob: 0.05, allowedQualityTiers: ["cost", "balanced"], monthlyCountCap: 400, manualOverrideAllowed: true },
      transcription: { maxCostPerJob: 0.05, allowedQualityTiers: ["cost", "balanced"], monthlyCountCap: 200, manualOverrideAllowed: true },
      music: { maxCostPerJob: 0.05, allowedQualityTiers: ["cost", "balanced"], monthlyCountCap: 100, manualOverrideAllowed: true },
    },
  },
  PRO: {
    id: "PRO",
    monthlyCredits: 120,
    maxConcurrentJobs: 6,
    maxBrands: 10,
    features: { autopilot: true, mcp: true, avatar: true, publishing: true, analytics: true, advancedTrends: true },
    policies: {
      image: { maxCostPerJob: 0.5, allowedQualityTiers: ["cost", "balanced", "premium"], monthlyCountCap: 2000, manualOverrideAllowed: true },
      video: { maxCostPerJob: 2, allowedQualityTiers: ["cost", "balanced", "premium"], maxDurationSec: 60, monthlyCountCap: 120, manualOverrideAllowed: true },
      tts: { maxCostPerJob: 0.2, allowedQualityTiers: ["cost", "balanced", "premium"], monthlyCountCap: 1500, manualOverrideAllowed: true },
      transcription: { maxCostPerJob: 0.2, allowedQualityTiers: ["cost", "balanced", "premium"], monthlyCountCap: 800, manualOverrideAllowed: true },
      music: { maxCostPerJob: 0.2, allowedQualityTiers: ["cost", "balanced", "premium"], monthlyCountCap: 400, manualOverrideAllowed: true },
    },
  },
  BUSINESS: {
    id: "BUSINESS",
    monthlyCredits: 500,
    maxConcurrentJobs: 12,
    maxBrands: 50,
    features: { autopilot: true, mcp: true, avatar: true, publishing: true, analytics: true, advancedTrends: true },
    policies: {
      image: { maxCostPerJob: 2, allowedQualityTiers: ["cost", "balanced", "premium"], monthlyCountCap: null, manualOverrideAllowed: true },
      video: { maxCostPerJob: 8, allowedQualityTiers: ["cost", "balanced", "premium"], maxDurationSec: 60, monthlyCountCap: null, manualOverrideAllowed: true },
      tts: { maxCostPerJob: 1, allowedQualityTiers: ["cost", "balanced", "premium"], monthlyCountCap: null, manualOverrideAllowed: true },
      transcription: { maxCostPerJob: 1, allowedQualityTiers: ["cost", "balanced", "premium"], monthlyCountCap: null, manualOverrideAllowed: true },
      music: { maxCostPerJob: 1, allowedQualityTiers: ["cost", "balanced", "premium"], monthlyCountCap: null, manualOverrideAllowed: true },
    },
  },
};

const CAPABILITY_TO_MODALITY: Record<string, keyof PlanConfig["policies"]> = {
  IMAGE_GENERATION: "image",
  VIDEO_GENERATION: "video",
  TTS: "tts",
  TRANSCRIPTION: "transcription",
  MUSIC_GENERATION: "music",
};

export function isPlanId(v: string): v is PlanId {
  return (PLAN_IDS as string[]).includes(v);
}

/** Find or lazily create the user's subscription (everyone starts on FREE). */
export async function getSubscription(userId: string) {
  let sub = await db.subscription.findUnique({ where: { userId } });
  if (!sub) {
    sub = await db.subscription
      .create({ data: { userId, plan: "FREE", renewsAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1) } })
      .catch(async () => db.subscription.findUnique({ where: { userId } }));
  }
  if (!sub) throw new ApiError(500, "SUBSCRIPTION_INIT_FAILED", "Failed to initialize subscription");
  return sub;
}

export interface SubscriptionUsage {
  plan: PlanId;
  credits: { used: number; total: number; remaining: number };
  runningJobs: number;
  monthlyCounts: { image: number; video: number; tts: number; transcription: number; music: number };
  brands: number;
  periodStart: string;
  renewsAt: string | null;
}

/** Real usage snapshot for the current billing month (calendar month). */
export async function getUsage(userId: string, plan: PlanId): Promise<SubscriptionUsage> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [monthAgg, counts, runningJobs, brandCount, musicJobs] = await Promise.all([
    db.costLedger.aggregate({ _sum: { estimatedCost: true }, where: { userId, createdAt: { gte: startOfMonth } } }),
    db.costLedger.groupBy({
      by: ["capability"],
      _count: { _all: true },
      where: { userId, createdAt: { gte: startOfMonth }, capability: { in: Object.keys(CAPABILITY_TO_MODALITY) } },
    }),
    db.generationJob.count({ where: { userId, status: { in: ["PENDING", "RUNNING"] } } }),
    db.brand.count({ where: { userId } }),
    // Music is free (built-in synth) → CostLedger has no rows; count real jobs instead.
    db.generationJob.count({
      where: { userId, kind: "MUSIC", createdAt: { gte: startOfMonth }, status: { notIn: ["FAILED", "CANCELLED", "DRAFT"] } },
    }),
  ]);
  const used = monthAgg._sum.estimatedCost ?? 0;
  const monthlyCounts = { image: 0, video: 0, tts: 0, transcription: 0, music: musicJobs };
  for (const row of counts) {
    const modality = CAPABILITY_TO_MODALITY[row.capability];
    if (modality) monthlyCounts[modality] = row._count._all;
  }
  const sub = await getSubscription(userId);
  return {
    plan,
    credits: { used, total: PLANS[plan].monthlyCredits, remaining: Math.max(0, PLANS[plan].monthlyCredits - used) },
    runningJobs,
    monthlyCounts,
    brands: brandCount,
    periodStart: startOfMonth.toISOString(),
    renewsAt: sub.renewsAt ? sub.renewsAt.toISOString() : null,
  };
}

function modalityFor(capability: string): keyof PlanConfig["policies"] | null {
  return CAPABILITY_TO_MODALITY[capability] ?? null;
}

/**
 * Quota gate for paid generation endpoints. Throws 402 with structured
 * details when the plan's credits, per-modality caps, duration or
 * concurrency limits would be exceeded. Runs BEFORE any provider call.
 */
export async function assertQuota(
  userId: string,
  capability: string,
  estimatedCost: number,
  opts?: { videoDurationSec?: number }
): Promise<void> {
  const sub = await getSubscription(userId);
  const plan = (isPlanId(sub.plan) ? sub.plan : "FREE") as PlanId;
  const config = PLANS[plan];
  const modality = modalityFor(capability);

  // 1) Monthly credits (real spend from CostLedger)
  const usage = await getUsage(userId, plan);
  if (usage.credits.used + estimatedCost > config.monthlyCredits) {
    throw new ApiError(402, "QUOTA_EXCEEDED", `Monthly credit limit reached on the ${plan} plan.`, {
      reason: "credits",
      plan,
      used: Number(usage.credits.used.toFixed(4)),
      limit: config.monthlyCredits,
      needed: Number(estimatedCost.toFixed(4)),
      upgradeTo: suggestUpgrade(plan, "credits"),
    });
  }

  // 2) Per-modality policy
  if (modality) {
    const policy = config.policies[modality];
    if (estimatedCost > policy.maxCostPerJob) {
      throw new ApiError(402, "QUOTA_EXCEEDED", `Cost per job (${estimatedCost.toFixed(2)}) exceeds the ${plan} plan limit for ${modality}.`, {
        reason: "cost_per_job", plan, modality, limit: policy.maxCostPerJob, upgradeTo: suggestUpgrade(plan, "cost_per_job"),
      });
    }
    if (policy.monthlyCountCap !== null && usage.monthlyCounts[modality] >= policy.monthlyCountCap) {
      throw new ApiError(402, "QUOTA_EXCEEDED", `Monthly ${modality} cap (${policy.monthlyCountCap}) reached on the ${plan} plan.`, {
        reason: "monthly_count", plan, modality, used: usage.monthlyCounts[modality], limit: policy.monthlyCountCap,
        upgradeTo: suggestUpgrade(plan, "monthly_count"),
      });
    }
    if (modality === "video" && opts?.videoDurationSec && policy.maxDurationSec && opts.videoDurationSec > policy.maxDurationSec) {
      throw new ApiError(402, "QUOTA_EXCEEDED", `Video length ${opts.videoDurationSec}s exceeds the ${plan} plan limit (${policy.maxDurationSec}s).`, {
        reason: "duration", plan, modality, limit: policy.maxDurationSec, requested: opts.videoDurationSec,
        upgradeTo: suggestUpgrade(plan, "duration"),
      });
    }
  }

  // 3) Concurrency
  if (usage.runningJobs >= config.maxConcurrentJobs) {
    throw new ApiError(402, "QUOTA_EXCEEDED", `Concurrent job limit (${config.maxConcurrentJobs}) reached on the ${plan} plan. Wait for jobs to finish or upgrade.`, {
      reason: "concurrency", plan, running: usage.runningJobs, limit: config.maxConcurrentJobs,
      upgradeTo: suggestUpgrade(plan, "concurrency"),
    });
  }

  // 4) Brand count is checked on brand creation, not here (see brands route).
}

/** Smallest plan that lifts the given constraint. */
function suggestUpgrade(plan: PlanId, reason: string): PlanId | null {
  const order = PLAN_IDS;
  const idx = order.indexOf(plan);
  for (let i = idx + 1; i < order.length; i++) {
    const candidate = order[i];
    if (reason === "credits" && PLANS[candidate].monthlyCredits > PLANS[plan].monthlyCredits) return candidate;
    if (reason === "concurrency" && PLANS[candidate].maxConcurrentJobs > PLANS[plan].maxConcurrentJobs) return candidate;
    if (reason === "monthly_count" || reason === "cost_per_job" || reason === "duration") {
      // modality caps only ever grow with plans
      return candidate;
    }
  }
  return null;
}

/** Brand-count gate used by the brands route. */
export async function assertBrandQuota(userId: string): Promise<void> {
  const sub = await getSubscription(userId);
  const plan = (isPlanId(sub.plan) ? sub.plan : "FREE") as PlanId;
  const count = await db.brand.count({ where: { userId } });
  if (count >= PLANS[plan].maxBrands) {
    throw new ApiError(402, "QUOTA_EXCEEDED", `Brand limit (${PLANS[plan].maxBrands}) reached on the ${plan} plan.`, {
      reason: "brands", plan, limit: PLANS[plan].maxBrands, upgradeTo: suggestUpgrade(plan, "credits"),
    });
  }
}

/** Sandbox plan switch — no payment processor exists here, and we never fake one. */
export async function switchPlan(userId: string, plan: PlanId) {
  const sub = await getSubscription(userId);
  const updated = await db.subscription.update({
    where: { id: sub.id },
    data: {
      plan,
      renewsAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
      metaJson: JSON.stringify({ paymentProvider: "none", mode: "sandbox_switch", switchedAt: new Date().toISOString() }),
    },
  });
  return updated;
}

export { modalityFor };
