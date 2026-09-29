import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, parseJson } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { llmCompleteJson } from "@/lib/ai/zai";
import { routeCapability, PROVIDER_REGISTRY } from "@/lib/ai/registry";

// GET /api/prompts?q=&niche=&type=&favorite= — search library (global + user custom)
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const q = url.searchParams.get("q") ?? "";
    const niche = url.searchParams.get("niche") ?? "";
    const type = url.searchParams.get("type") ?? "";
    const favorite = url.searchParams.get("favorite") === "1";
    const where = {
      OR: [{ userId: null }, { userId: user.id }],
      ...(niche ? { niche } : {}),
      ...(type && ["IMAGE", "VIDEO"].includes(type) ? { type } : {}),
      ...(favorite ? { isFavorite: true } : {}),
      ...(q ? { OR: [{ title: { contains: q } }, { body: { contains: q } }, { niche: { contains: q } }] } : {}),
    };
    // merge OR conditions correctly: q search must be inside scope
    const templates = await db.promptTemplate.findMany({
      where: {
        AND: [{ OR: [{ userId: null }, { userId: user.id }] }, ...(niche ? [{ niche }] : []), ...(type ? [{ type }] : []), ...(favorite ? [{ isFavorite: true }] : []), ...(q ? [{ OR: [{ title: { contains: q } }, { body: { contains: q } }, { niche: { contains: q } }] }] : [])],
      },
      orderBy: [{ usageCount: "desc" }, { createdAt: "desc" }],
      take: 120,
    });
    const niches = [...new Set((await db.promptTemplate.findMany({ where: { OR: [{ userId: null }, { userId: user.id }] }, select: { niche: true }, distinct: ["niche"] })).map((n) => n.niche))];
    return ok({ templates, niches });
  });
}

// POST /api/prompts — create custom / duplicate / favorite toggle
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();

    if (body.action === "favorite") {
      const tpl = await db.promptTemplate.findUnique({ where: { id: String(body.id) } });
      if (!tpl || (tpl.userId && tpl.userId !== user.id)) throw new ApiError(404, "NOT_FOUND", "Template not found");
      const updated = await db.promptTemplate.update({ where: { id: tpl.id }, data: { isFavorite: !tpl.isFavorite } });
      return ok(updated);
    }
    if (body.action === "duplicate") {
      const tpl = await db.promptTemplate.findUnique({ where: { id: String(body.id) } });
      if (!tpl || (tpl.userId && tpl.userId !== user.id)) throw new ApiError(404, "NOT_FOUND", "Template not found");
      const copy = await db.promptTemplate.create({
        data: {
          userId: user.id,
          niche: tpl.niche,
          type: tpl.type,
          title: `${tpl.title} (copy)`,
          body: tpl.body,
          platform: tpl.platform,
          language: tpl.language,
          variablesJson: tpl.variablesJson,
          tagsJson: tpl.tagsJson,
          isCustom: true,
          parentTemplateId: tpl.id,
        },
      });
      return ok(copy, 201);
    }
    // create custom
    const title = String(body.title ?? "Custom prompt").slice(0, 200);
    const promptBody = String(body.body ?? "").slice(0, 6000);
    if (!promptBody) throw new ApiError(400, "VALIDATION", "Prompt body required");
    const created = await db.promptTemplate.create({
      data: {
        userId: user.id,
        niche: String(body.niche ?? "Custom").slice(0, 80),
        type: body.type === "VIDEO" ? "VIDEO" : "IMAGE",
        title,
        body: promptBody,
        platform: body.platform ?? null,
        language: body.language ?? null,
        variablesJson: JSON.stringify([...promptBody.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1].trim())),
        tagsJson: JSON.stringify(body.tags ?? ["custom"]),
        isCustom: true,
      },
    });
    await audit.log({ userId: user.id, action: "prompt.create", objectType: "PromptTemplate", objectId: created.id });
    return ok(created, 201);
  });
}

// PATCH /api/prompts — update custom template (versioned)
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const tpl = await db.promptTemplate.findUnique({ where: { id: String(body.id) } });
    if (!tpl || tpl.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Template not found (global templates are read-only — duplicate first)");
    const data: Record<string, unknown> = { version: tpl.version + 1 };
    if (body.title !== undefined) data.title = String(body.title).slice(0, 200);
    if (body.body !== undefined) {
      data.body = String(body.body).slice(0, 6000);
      data.variablesJson = JSON.stringify([...String(body.body).matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1].trim()));
    }
    const updated = await db.promptTemplate.update({ where: { id: tpl.id }, data });
    return ok(updated);
  });
}
