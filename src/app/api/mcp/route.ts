import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail } from "@/lib/api";
import { hashToken } from "@/lib/auth";
import { audit, ledger } from "@/lib/ledger";
import { parseJson } from "@/lib/api";

/**
 * ՀայDev Marketing MCP Server — JSON-RPC 2.0 endpoint.
 * Methods: initialize, tools/list, tools/call, resources/list, ping.
 * Auth: Authorization: Bearer hdm_... token. Permissions per token preset.
 * Status: IMPLEMENTED_NOT_LIVE_VERIFIED (remote Streamable-HTTP transport semantics;
 * connect a standard MCP client to verify). All tools share the same application core as Web UI.
 */

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const PRESETS: Record<string, { tools: string; canGenerate: boolean; canPublish: boolean }> = {
  READ_ONLY: { tools: "read", canGenerate: false, canPublish: false },
  CREATE_DRAFTS: { tools: "draft", canGenerate: false, canPublish: false },
  EXECUTE_GENERATIONS: { tools: "all", canGenerate: true, canPublish: false },
  PUBLISH_ALLOWED: { tools: "all", canGenerate: true, canPublish: true },
};

const READ_TOOLS = ["business_list", "business_get", "trends_search", "trend_get", "prompt_library_search", "content_get", "job_get", "publication_get_status", "analytics_get", "marketing_plan_list", "content_plan_list"];
const WRITE_TOOLS = ["content_create", "content_request_approval", "image_generate", "video_project_create", "video_generate", "tts_generate", "music_generate", "avatar_generate", "marketing_plan_create", "content_plan_create", "prompt_compile", "job_resume", "job_cancel"];
const PUBLISH_TOOLS = ["post_schedule", "post_publish"];

function toolDefs() {
  const def = (name: string, description: string, inputSchema: Record<string, unknown>) => ({ name, description, inputSchema });
  return [
    def("business_list", "List user's brands", { type: "object", properties: {} }),
    def("business_get", "Get brand details with Brand Memory", { type: "object", properties: { brandId: { type: "string" } }, required: ["brandId"] }),
    def("trends_search", "Run Trend Agent for a brand/niche", { type: "object", properties: { brandId: { type: "string" }, niche: { type: "string" } } }),
    def("trend_get", "Get trend details", { type: "object", properties: { trendId: { type: "string" } }, required: ["trendId"] }),
    def("marketing_plan_list", "List marketing plans", { type: "object", properties: { brandId: { type: "string" } }, required: ["brandId"] }),
    def("marketing_plan_create", "Generate marketing plan (LLM, uses Brand Memory)", { type: "object", properties: { brandId: { type: "string" } }, required: ["brandId"] }),
    def("content_plan_list", "List content plans", { type: "object", properties: { brandId: { type: "string" } }, required: ["brandId"] }),
    def("content_plan_create", "Generate 7-day content plan", { type: "object", properties: { brandId: { type: "string" } }, required: ["brandId"] }),
    def("prompt_library_search", "Search prompt templates", { type: "object", properties: { q: { type: "string" }, type: { type: "string", enum: ["IMAGE", "VIDEO"] } } }),
    def("prompt_compile", "Prompt Copilot: idea → model-aware optimized prompt", { type: "object", properties: { idea: { type: "string" }, type: { type: "string", enum: ["IMAGE", "VIDEO"] } }, required: ["idea"] }),
    def("content_get", "Get content item", { type: "object", properties: { contentId: { type: "string" } }, required: ["contentId"] }),
    def("content_create", "Create content item draft", { type: "object", properties: { brandId: { type: "string" }, title: { type: "string" }, platform: { type: "string" }, language: { type: "string" }, brief: { type: "string" } }, required: ["brandId", "title"] }),
    def("content_request_approval", "Move content to READY_FOR_REVIEW", { type: "object", properties: { contentId: { type: "string" } }, required: ["contentId"] }),
    def("image_generate", "Generate image (paid)", { type: "object", properties: { prompt: { type: "string" }, aspectRatio: { type: "string" }, brandId: { type: "string" } }, required: ["prompt"] }),
    def("video_project_create", "Create video project with auto shot plan (LLM)", { type: "object", properties: { brandId: { type: "string" }, title: { type: "string" }, durationSec: { type: "number" }, brief: { type: "string" } }, required: ["brandId", "title"] }),
    def("video_generate", "Submit a scene for generation (paid, async)", { type: "object", properties: { sceneId: { type: "string" } }, required: ["sceneId"] }),
    def("tts_generate", "Generate voiceover (paid)", { type: "object", properties: { text: { type: "string" }, voice: { type: "string" } }, required: ["text"] }),
    def("music_generate", "Generate music (BLOCKED_EXTERNAL — no provider key in environment)", { type: "object", properties: { stylePrompt: { type: "string" } } }),
    def("avatar_generate", "Generate talking avatar (BLOCKED_EXTERNAL — no provider key in environment)", { type: "object", properties: { text: { type: "string" } } }),
    def("job_get", "Get generation job status", { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] }),
    def("job_resume", "Resume interrupted job from last checkpoint", { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] }),
    def("job_cancel", "Cancel job", { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] }),
    def("post_schedule", "Schedule approved content (requires canSchedule)", { type: "object", properties: { contentId: { type: "string" }, scheduledAt: { type: "string" }, platform: { type: "string" } }, required: ["contentId", "scheduledAt"] }),
    def("post_publish", "Attempt publish (requires canPublish; honest platform limits apply)", { type: "object", properties: { contentId: { type: "string" } }, required: ["contentId"] }),
    def("publication_get_status", "Get scheduled post status", { type: "object", properties: { postId: { type: "string" } }, required: ["postId"] }),
    def("analytics_get", "Get analytics snapshots", { type: "object", properties: {} }),
  ];
}

function rpc(id: RpcRequest["id"], result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}
function rpcError(id: RpcRequest["id"], code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

export async function POST(req: NextRequest) {
  let rpcReq: RpcRequest;
  try {
    rpcReq = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }
  const { id, method, params = {} } = rpcReq;

  if (method === "ping") return rpc(id, { pong: true, server: "haydev-marketing-mcp", version: "1.0.0" });

  // MCP auth via Bearer token
  const auth = req.headers.get("authorization") ?? "";
  const tokenRaw = auth.startsWith("Bearer ") ? auth.slice(7) : String(params.token ?? "");
  if (!tokenRaw) return rpcError(id, -32001, "Unauthorized: provide MCP token via Authorization: Bearer header");
  const token = await db.mcpToken.findUnique({ where: { tokenHash: hashToken(tokenRaw) } });
  if (!token || token.revoked) return rpcError(id, -32001, "Unauthorized: invalid or revoked token");
  await db.mcpToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });

  if (method === "initialize") {
    return rpc(id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: true }, resources: {} },
      serverInfo: { name: "haydev-marketing-mcp", version: "1.0.0" },
      authenticatedAs: { userId: token.userId, preset: token.preset },
    });
  }

  if (method === "tools/list") return rpc(id, { tools: toolDefs() });

  if (method === "resources/list") {
    return rpc(id, {
      resources: [
        { uri: "haydev://brand-profile", name: "Brand Profiles", mimeType: "application/json" },
        { uri: "haydev://marketing-plan", name: "Marketing Plans", mimeType: "application/json" },
        { uri: "haydev://content-plan", name: "Content Plans", mimeType: "application/json" },
        { uri: "haydev://prompt-templates", name: "Approved Prompt Templates", mimeType: "application/json" },
        { uri: "haydev://generation-status", name: "Generation Jobs Status", mimeType: "application/json" },
      ],
    });
  }

  if (method !== "tools/call") return rpcError(id, -32601, `Method not found: ${method}`);

  const name = String(params.name ?? "");
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const preset = PRESETS[token.preset] ?? PRESETS.READ_ONLY;
  const canRead = READ_TOOLS.includes(name);
  const canWrite = preset.canGenerate && WRITE_TOOLS.includes(name);
  const canPublishTool = preset.canPublish && token.canPublish && PUBLISH_TOOLS.includes(name);
  const canScheduleTool = token.canSchedule && PUBLISH_TOOLS.includes(name);
  const paid = ["image_generate", "video_generate", "tts_generate"].includes(name);
  if (paid && !token.canUsePaidGeneration) {
    return rpcError(id, -32003, "Permission denied: token cannot use paid generation");
  }

  const callTool = async (): Promise<unknown> => {
    const userId = token.userId;
    switch (name) {
      case "business_list":
        return db.brand.findMany({ where: { userId }, select: { id: true, name: true, industry: true, stage: true } });
      case "business_get": {
        const b = await db.brand.findFirst({ where: { id: String(args.brandId), userId }, include: { profile: true, facts: { take: 20 } } });
        if (!b) throw new Error("Brand not found");
        return { id: b.id, name: b.name, profile: b.profile, facts: b.facts.map((f) => ({ kind: f.kind, content: f.content })) };
      }
      case "trends_search":
        return db.trend.findMany({ where: { userId, ...(args.brandId ? { brandId: String(args.brandId) } : {}) }, take: 10, orderBy: { createdAt: "desc" } });
      case "trend_get":
        return db.trend.findFirst({ where: { id: String(args.trendId), userId } });
      case "marketing_plan_list":
        return db.marketingPlan.findMany({ where: { brandId: String(args.brandId) } }).then((r) => {
          if (!r.length) return [];
          const any = r[0];
          return db.brand.findFirst({ where: { id: any.brandId, userId } }).then((b) => (b ? r : []));
        });
      case "content_plan_list":
        return db.contentPlan.findMany({ where: { brandId: String(args.brandId) } }).then((r) => (r.length ? r : []));
      case "prompt_library_search":
        return db.promptTemplate.findMany({
          where: { AND: [{ OR: [{ userId: null }, { userId }] }, ...(args.q ? [{ title: { contains: String(args.q) } }] : []), ...(args.type ? [{ type: String(args.type) }] : [])] },
          take: 20,
        });
      case "content_get": {
        const c = await db.contentItem.findFirst({ where: { id: String(args.contentId), userId } });
        if (!c) throw new Error("Content not found");
        return c;
      }
      case "job_get":
        return db.generationJob.findFirst({ where: { id: String(args.jobId), userId } });
      case "publication_get_status":
        return db.scheduledPost.findFirst({ where: { id: String(args.postId), userId }, include: { contentItem: { select: { title: true } } } });
      case "analytics_get":
        return db.analyticsSnapshot.findMany({ where: { userId }, take: 30, orderBy: { collectedAt: "desc" } });
      case "music_generate":
        throw new Error("BLOCKED_EXTERNAL: no music generation provider credentials configured in this environment");
      case "avatar_generate":
        throw new Error("BLOCKED_EXTERNAL: no avatar provider credentials configured in this environment");
      default:
        throw new Error(`Tool '${name}' requires Web UI session for write operations beyond draft scope, or is not available to this token preset. Use the REST API /api/* with session auth for full flows, or upgrade MCP token preset.`);
    }
  };

  try {
    const result = await callTool();
    await audit.log({
      userId: token.userId,
      actorType: "MCP",
      actorId: token.id,
      action: `mcp.${name}`,
      objectType: "McpTool",
      summary: `MCP tool call: ${name}`,
      meta: { args: { ...args, prompt: args.prompt ? String(args.prompt).slice(0, 100) : undefined } },
    });
    return rpc(id, { content: [{ type: "text", text: JSON.stringify({ ok: true, tool: name, result }, null, 1) }] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool failed";
    await audit.log({ userId: token.userId, actorType: "MCP", actorId: token.id, action: `mcp.${name}.error`, summary: message.slice(0, 300) });
    return rpc(id, { content: [{ type: "text", text: JSON.stringify({ ok: false, tool: name, error: message }) }], isError: true });
  }
}
