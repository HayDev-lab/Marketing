import { NextRequest } from "next/server";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { listAvatarProviders, resolveAvatarRoute, PLUGIN_SLOT } from "@/lib/avatar/adapter";

const MAX_SCRIPT_CHARS = 5000;
const ASPECT_RATIOS = ["9:16", "1:1", "16:9"] as const;

// POST /api/generate/avatar — talking-avatar (§24).
// Honest contract of this environment: capabilities self-inspection works,
// generation is BLOCKED_EXTERNAL (no provider API key) — no job, no asset, no fake success.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new ApiError(400, "VALIDATION", "Invalid JSON body");

    if (body.action === "capabilities") {
      return ok({
        providers: listAvatarProviders(),
        pluginSlot: {
          interfacePath: PLUGIN_SLOT,
          registryProviderId: "heygen",
          note: "No concrete avatar provider is implemented in this environment. The adapter interface is ready; set HEYGEN_API_KEY and implement generate() in the adapter to activate.",
        },
      });
    }

    if (body.action === "generate") {
      const script = String(body.script ?? "").trim();
      if (!script) throw new ApiError(400, "VALIDATION", "Script is required");
      // validate + normalize; nothing is executed (no provider can be called)
      const options = {
        script: script.slice(0, MAX_SCRIPT_CHARS),
        voiceId: body.voiceId ? String(body.voiceId) : undefined,
        speed: Number(body.speed) || undefined,
        referenceImageAssetId: body.referenceImageAssetId ? String(body.referenceImageAssetId) : undefined,
        aspectRatio: (ASPECT_RATIOS as readonly string[]).includes(body.aspectRatio)
          ? (body.aspectRatio as (typeof ASPECT_RATIOS)[number])
          : ("9:16" as const),
      };

      const decision = resolveAvatarRoute();
      if (!decision.route) {
        // Honest no-op: NO GenerationJob row, NO MediaAsset row.
        await audit.log({
          userId: user.id,
          action: "avatar.generate_blocked",
          objectType: "AvatarGeneration",
          summary: "blocked: no provider key",
          meta: { blockedBy: decision.blockedBy, requiredSetup: ["HEYGEN_API_KEY"], pluginSlot: PLUGIN_SLOT },
        });
        throw new ApiError(
          503,
          "BLOCKED_EXTERNAL",
          "Talking-avatar generation is not available in this environment — no provider API key configured",
          {
            blockedBy: decision.blockedBy,
            requiredSetup: ["HEYGEN_API_KEY"],
            pluginSlot: PLUGIN_SLOT,
            scriptChars: options.script.length,
          },
        );
      }
      // Unreachable today: resolveAvatarRoute() never returns a route in this
      // environment (no adapter is configured+implemented). Kept for the future
      // plugin flow so the route file does not need to change.
      throw new ApiError(503, "BLOCKED_EXTERNAL", "Avatar provider route is not callable", {
        blockedBy: decision.blockedBy,
      });
    }

    throw new ApiError(400, "VALIDATION", "Unknown action — use 'capabilities' or 'generate'");
  });
}
