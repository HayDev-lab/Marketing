import { NextRequest } from "next/server";
import { ok, handle, ApiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/ledger";
import { PLANS, PLAN_IDS, getSubscription, getUsage, switchPlan, isPlanId, type PlanId } from "@/lib/subscription";

// GET /api/subscription — current plan + real usage snapshot + full plan matrix
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    const sub = await getSubscription(user.id);
    const plan = (isPlanId(sub.plan) ? sub.plan : "FREE") as PlanId;
    const usage = await getUsage(user.id, plan);
    return ok({
      subscription: {
        plan: sub.plan,
        status: sub.status,
        billingCycle: sub.billingCycle,
        startedAt: sub.startedAt.toISOString(),
        renewsAt: sub.renewsAt ? sub.renewsAt.toISOString() : null,
        metaJson: sub.metaJson,
      },
      usage,
      plans: PLANS,
    });
  });
}

// POST /api/subscription — { action: "switch", plan }
// Sandbox switch: no payment processor exists in this environment, so the
// switch is instant and honestly labeled (audit + metaJson record it).
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    if (action === "switch") {
      const plan = String(body.plan ?? "");
      if (!isPlanId(plan)) throw new ApiError(400, "BAD_PLAN", `Unknown plan. Valid: ${PLAN_IDS.join(", ")}`);
      const updated = await switchPlan(user.id, plan);
      await audit.log({ userId: user.id, action: "subscription.switched", objectType: "Subscription", objectId: updated.id, summary: `Plan switched to ${plan} (sandbox switch — no billing processor)` });
      return ok({ switched: true, plan, subscription: updated });
    }
    throw new ApiError(400, "BAD_ACTION", "Unknown action. Use: switch");
  });
}
