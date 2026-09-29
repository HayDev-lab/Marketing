import { ok, handle, requireUser } from "@/lib/api";
import { ledger } from "@/lib/ledger";

// GET /api/costs — usage dashboard
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const usage = await ledger.usage(user.id);
    return ok(usage);
  });
}
