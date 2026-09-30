import { NextRequest } from "next/server";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { llmCompleteJson } from "@/lib/ai/zai";
import { routeCapability, PROVIDER_REGISTRY, getProviderModel } from "@/lib/ai/registry";

interface CopilotResult {
  optimizedPrompt: string;
  chosenProvider: string;
  chosenModel: string;
  whyChosen: string;
  parameters: Record<string, unknown>;
  estimatedCost?: number;
  negativeConstraints?: string;
}

// POST /api/prompts/compile — Prompt Copilot: user intent → model-aware optimized prompt
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const idea = String(body.idea ?? "").slice(0, 2000);
    const type = body.type === "VIDEO" ? "VIDEO" : "IMAGE";
    if (!idea) throw new ApiError(400, "VALIDATION", "Describe your idea first");

    const capability = type === "VIDEO" ? "VIDEO_GENERATION" : "IMAGE_GENERATION";
    const route = routeCapability({ capability, userPreferenceProvider: body.provider, aspectRatio: body.aspectRatio });
    const available = PROVIDER_REGISTRY.filter((p) => p.models.some((m) => m.capabilities.includes(capability)));
    const modelConstraints = route ? getProviderModel(route.providerId, route.modelId) : undefined;

    const system = `You are Prompt Copilot. Convert the user's idea into an optimized generative prompt that respects the target model's REAL constraints.
Model constraints (authoritative): ${JSON.stringify(modelConstraints?.constraints ?? {})}
Available providers: ${JSON.stringify(available.map((p) => ({ id: p.providerId, status: p.status, models: p.models.map((m) => m.id) })))}
Rules: prompt in English; keep brand placeholders as {{placeholders}} when brand data missing; respect aspect ratio; for VIDEO include hook pacing (0-2s), scene beats, camera grammar; add negative constraints only if meaningful.
Never invent provider capabilities beyond the constraints given.`;

    const prompt = `USER IDEA: ${idea}
TARGET TYPE: ${type}
${body.brandContext ? `BRAND CONTEXT: ${String(body.brandContext).slice(0, 1000)}` : ""}
Return JSON: {"optimizedPrompt": str, "chosenProvider": "${route?.providerId ?? ""}", "chosenModel": "${route?.modelId ?? ""}", "whyChosen": str, "parameters": {"aspectRatio": "${body.aspectRatio ?? "9:16"}"}, "negativeConstraints": str}`;

    const result = await llmCompleteJson<CopilotResult>({ system, prompt });
    await audit.log({ userId: user.id, action: "copilot.compile", summary: `Prompt compiled for ${type}` });
    return ok({
      originalIdea: idea,
      optimizedPrompt: result.optimizedPrompt,
      chosenProvider: result.chosenProvider || route?.providerId,
      chosenModel: result.chosenModel || route?.modelId,
      whyChosen: result.whyChosen || route?.reason,
      parameters: result.parameters ?? {},
      negativeConstraints: result.negativeConstraints,
      estimatedCost: modelConstraints?.estimatedCostPerCall,
    });
  });
}
