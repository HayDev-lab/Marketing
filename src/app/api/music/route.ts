// /api/music — Music Library (MASTER PROMPT §20 OWN MUSIC).
//
//  GET            → list library entries with playable asset URLs
//  POST upload    → own music upload (base64 audio ≤25MB, honest validation)
//  POST edit      → store §20 edit intent (volume / trim / fade in-out / loop /
//                   duck under voice). Editing intents are stored in metadata and
//                   previewed in the browser via Web Audio; video mixdown applies
//                   them at export time (honest scope, no fake processing).
//  DELETE ?id=    → remove library entry + underlying media asset

import { NextRequest } from "next/server";
import { unlink } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { saveAssetBuffer, UPLOADS_DIR } from "@/lib/ai/zai";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const AUDIO_MIME = /^audio\//i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac|webm)$/i;

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const rows = await db.musicAsset.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const assetIds = rows.map((r) => r.assetId).filter((v): v is string => Boolean(v));
    const assets = assetIds.length
      ? await db.mediaAsset.findMany({ where: { id: { in: assetIds } } })
      : [];
    const assetMap = new Map(assets.map((a) => [a.id, a]));
    const items = rows.map((r) => {
      const asset = r.assetId ? assetMap.get(r.assetId) : undefined;
      let meta: Record<string, unknown> = {};
      try { meta = r.metaJson ? (JSON.parse(r.metaJson) as Record<string, unknown>) : {}; } catch { /* corrupt meta — treat as empty */ }
      return {
        id: r.id,
        title: r.title,
        lyrics: r.lyrics,
        stylePrompt: r.stylePrompt,
        source: r.source,
        provider: r.provider,
        durationSec: r.durationSec,
        cost: r.cost,
        createdAt: r.createdAt,
        meta,
        asset: asset
          ? { id: asset.id, url: `/api/assets/${asset.id}/raw`, mimeType: asset.mimeType, size: asset.size, filename: asset.filename }
          : null,
      };
    });
    return ok({ items });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();

    // ---------- upload own music ----------
    if (body.action === "upload") {
      const base64 = String(body.base64 ?? "");
      const dataUrl = base64.startsWith("data:") ? base64 : `data:${body.mimeType ?? "audio/mpeg"};base64,${base64}`;
      const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
      if (!match) throw new ApiError(400, "VALIDATION", "Invalid audio payload");
      const mimeType = String(body.mimeType ?? match[1] ?? "audio/mpeg");
      if (!AUDIO_MIME.test(mimeType)) {
        throw new ApiError(415, "UNSUPPORTED_TYPE", `Unsupported file type: ${mimeType}. Upload an audio file (mp3, wav, ogg, m4a, flac).`);
      }
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length === 0) throw new ApiError(400, "VALIDATION", "Empty file");
      if (buffer.length > MAX_AUDIO_BYTES) {
        throw new ApiError(413, "TOO_LARGE", "Audio file exceeds the 25 MB limit");
      }
      const rawName = String(body.fileName ?? "upload.mp3");
      if (!AUDIO_EXT.test(rawName) && !AUDIO_MIME.test(mimeType)) {
        throw new ApiError(415, "UNSUPPORTED_TYPE", "Unsupported file extension. Allowed: mp3, wav, ogg, m4a, flac, aac, webm");
      }
      const asset = await saveAssetBuffer(user.id, buffer, "MUSIC", mimeType, rawName.slice(0, 120), { uploaded: true });
      const entry = await db.musicAsset.create({
        data: {
          userId: user.id,
          brandId: typeof body.brandId === "string" && body.brandId ? body.brandId : null,
          title: (String(body.title ?? "").trim() || rawName.replace(/\.[^.]+$/, "")).slice(0, 80),
          source: "UPLOADED",
          provider: "user-upload",
          assetId: asset.id,
          durationSec: null,
          metaJson: JSON.stringify({ mimeType, uploadedAt: new Date().toISOString() }),
        },
      });
      await audit.log({ userId: user.id, action: "music.upload", objectType: "MusicAsset", objectId: entry.id, summary: `${rawName} (${Math.round(buffer.length / 1024)} KB)` });
      return ok({ id: entry.id, assetId: asset.id, url: `/api/assets/${asset.id}/raw` }, 201);
    }

    // ---------- store edit intent (§20) ----------
    if (body.action === "edit") {
      const id = String(body.id ?? "");
      const entry = await db.musicAsset.findFirst({ where: { id, userId: user.id } });
      if (!entry) throw new ApiError(404, "NOT_FOUND", "Music entry not found");

      const e = (body.edit ?? {}) as Record<string, unknown>;
      const num = (v: unknown, min: number, max: number): number => Math.min(max, Math.max(min, Number(v) || 0));
      const edit = {
        volume: num(e.volume, 0, 2),                       // 0 = muted, 2 = +6dB-ish boost
        trimStartSec: num(e.trimStartSec, 0, 600),
        trimEndSec: e.trimEndSec === null || e.trimEndSec === undefined || e.trimEndSec === "" ? null : num(e.trimEndSec, 0, 600),
        fadeInSec: num(e.fadeInSec, 0, 10),
        fadeOutSec: num(e.fadeOutSec, 0, 10),
        loop: Boolean(e.loop),
        duckEnabled: Boolean(e.duckEnabled),
        duckDb: e.duckDb === null || e.duckDb === undefined ? null : num(e.duckDb, -24, 0),
      };
      if (edit.trimEndSec !== null && edit.trimEndSec <= edit.trimStartSec) {
        throw new ApiError(400, "VALIDATION", "Trim end must be greater than trim start");
      }
      let meta: Record<string, unknown> = {};
      try { meta = entry.metaJson ? (JSON.parse(entry.metaJson) as Record<string, unknown>) : {}; } catch { /* reset corrupt meta */ }
      meta.edit = edit;
      const updated = await db.musicAsset.update({ where: { id: entry.id }, data: { metaJson: JSON.stringify(meta) } });
      await audit.log({ userId: user.id, action: "music.edit", objectType: "MusicAsset", objectId: entry.id, summary: `vol=${edit.volume} trim=${edit.trimStartSec}-${edit.trimEndSec ?? "end"} fade=${edit.fadeInSec}/${edit.fadeOutSec} loop=${edit.loop}` });
      return ok({ id: updated.id, edit });
    }

    throw new ApiError(400, "VALIDATION", "Unknown action");
  });
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) throw new ApiError(400, "VALIDATION", "id is required");
    const entry = await db.musicAsset.findFirst({ where: { id, userId: user.id } });
    if (!entry) throw new ApiError(404, "NOT_FOUND", "Music entry not found");

    // Best-effort cleanup of the underlying media asset + file (honest deletion).
    let fileRemoved = false;
    if (entry.assetId) {
      const asset = await db.mediaAsset.findFirst({ where: { id: entry.assetId, userId: user.id } });
      if (asset) {
        await db.mediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
        if (asset.storageKey) {
          const p = path.join(UPLOADS_DIR, asset.storageKey);
          await unlink(p).then(() => { fileRemoved = true; }).catch(() => { fileRemoved = false; });
        }
      }
    }
    await db.musicAsset.delete({ where: { id: entry.id } });
    await audit.log({ userId: user.id, action: "music.delete", objectType: "MusicAsset", objectId: entry.id, summary: `${entry.title} (file: ${fileRemoved ? "removed" : "kept"})` });
    return ok({ id: entry.id, fileRemoved });
  });
}
