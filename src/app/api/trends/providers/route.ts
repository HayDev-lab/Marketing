import { NextRequest } from "next/server";
import { ok, handle, requireUser } from "@/lib/api";
import { listTrendProviders } from "@/lib/trends/providers";

// GET /api/trends/providers — honest provider capability report.
// The UI shows exactly what is live vs. prepared — no fake sources.
export async function GET(_req: NextRequest) {
  return handle(async () => {
    await requireUser();
    return ok(listTrendProviders().map((p) => p.getCapabilities()));
  });
}
