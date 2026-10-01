import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit } from "@/lib/ledger";

// GET /api/video-projects — list user's projects (scene counts) or ?id= single project with scenes.
// Read-model endpoint for the Video Studio cockpit; writes go through actions in
// /api/generate/video plus the ownership-checked PATCH below.
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const project = await db.videoProject.findUnique({
        where: { id },
        include: { scenes: { orderBy: { order: "asc" } } },
      });
      if (!project || project.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Project not found");
      const tracks = await db.subtitleTrack.findMany({
        where: { projectId: id, userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      return ok({
        ...project,
        subtitleTracks: tracks.map((tr) => {
          const cues = (() => {
            try { return tr.cuesJson ? (JSON.parse(tr.cuesJson) as unknown[]) : []; } catch { return []; }
          })();
          return {
            id: tr.id,
            language: tr.language,
            format: tr.format,
            cueCount: cues.length,
            cues,
            createdAt: tr.createdAt,
          };
        }),
      });
    }
    const list = await db.videoProject.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 30,
      include: { _count: { select: { scenes: true } } },
    });
    return ok(list);
  });
}

// PATCH /api/video-projects — ownership-checked edits:
//   { projectId, sceneId, prompt }            → edit scene prompt
//   { projectId, sceneId, reset: true }       → reset COMPLETED/FAILED scene for regeneration (version+1)
//   { projectId, sceneId, voice: { remove: true } } → detach the scene's TTS voice clip
//   { projectId, scenes: [{id, order}] }      → reorder scenes
//   { projectId, soundtrack: {musicAssetId, loopOverride?} | null } → soundtrack for final assembly
//   { projectId, voiceover: { mode?: "single"|"perScene", enabled?, duckMusic?, remove? } } → narration config
//   { projectId, subtitles: { trackId, enabled?, burnIn? } | null } → §23 subtitle config for assembly
//   { projectId, title?, script?, characterBible?, styleBible? } → project-level fields (bibles as plain objects)
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const projectId = String(body.projectId ?? "");
    const project = await db.videoProject.findUnique({ where: { id: projectId } });
    if (!project || project.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Project not found");

    // Scene-level edit (prompt or reset-for-regeneration)
    if (body.sceneId) {
      const scene = await db.videoScene.findUnique({ where: { id: String(body.sceneId) } });
      if (!scene || scene.projectId !== project.id) throw new ApiError(404, "SCENE_NOT_FOUND", "Scene not found");
      if (body.prompt !== undefined || body.reset) {
        const data: Record<string, unknown> = {};
        if (body.prompt !== undefined) data.prompt = String(body.prompt).slice(0, 2000);
        if (body.reset) {
          Object.assign(data, {
            status: "PENDING",
            assetId: null,
            voiceAssetId: null, // the regenerated clip may not match the old narration audio
            voiceDurationSec: null,
            jobId: null,
            error: null,
            lastFrameAssetId: null,
            version: scene.version + 1,
            retries: scene.retries + 1,
          });
        }
        await db.videoScene.update({ where: { id: scene.id }, data: data as never });
        await audit.log({
          userId: user.id,
          action: "video.scene_update",
          objectType: "VideoScene",
          objectId: scene.id,
          summary: body.reset ? "Scene reset for regeneration (voice detached)" : "Scene prompt edited",
        });
      }
      // Scene voice detach ({ projectId, sceneId, voice: { remove: true } })
      if (body.voice && typeof body.voice === "object" && (body.voice as { remove?: unknown }).remove === true) {
        if (!scene.voiceAssetId) throw new ApiError(409, "NO_SCENE_VOICE", "This scene has no voice clip attached");
        await db.videoScene.update({
          where: { id: scene.id },
          data: { voiceAssetId: null, voiceDurationSec: null },
        });
        await audit.log({
          userId: user.id,
          action: "video.scene_voiceover_detach",
          objectType: "VideoScene",
          objectId: scene.id,
          summary: `Scene ${scene.order + 1} voice detached`,
        });
      }
    }

    // Scene reorder
    if (Array.isArray(body.scenes)) {
      const orderPairs = (body.scenes as { id: string; order: number }[]).slice(0, 12);
      await db.$transaction(
        orderPairs.map((s) =>
          db.videoScene.updateMany({
            where: { id: String(s.id), projectId: project.id },
            data: { order: Number(s.order) || 0 },
          })
        )
      );
    }

    // Soundtrack selection (validated ownership; edit-intents live on the MusicAsset)
    if (body.soundtrack !== undefined) {
      let track: { musicAssetId: string; loopOverride: boolean } | null = null;
      if (body.soundtrack && typeof body.soundtrack === "object") {
        const musicAssetId = String((body.soundtrack as { musicAssetId?: unknown }).musicAssetId ?? "");
        const entry = musicAssetId
          ? await db.musicAsset.findFirst({ where: { id: musicAssetId, userId: user.id } })
          : null;
        if (!entry) throw new ApiError(404, "MUSIC_NOT_FOUND", "Music entry not found");
        if (!entry.assetId) throw new ApiError(409, "MUSIC_NO_AUDIO", "This entry has no audio file (lyrics-only) — pick a rendered track");
        track = { musicAssetId: entry.id, loopOverride: Boolean((body.soundtrack as { loopOverride?: unknown }).loopOverride) };
      }
      let meta: Record<string, unknown> = {};
      try { meta = project.metaJson ? (JSON.parse(project.metaJson) as Record<string, unknown>) : {}; } catch { /* rebuild meta */ }
      if (track) meta.soundtrack = track;
      else delete meta.soundtrack;
      await db.videoProject.update({
        where: { id: project.id },
        data: { metaJson: JSON.stringify(meta) },
      });
      await audit.log({
        userId: user.id,
        action: "video.soundtrack_set",
        objectType: "VideoProject",
        objectId: project.id,
        summary: track ? `Soundtrack: ${track.musicAssetId}, loop=${track.loopOverride}` : "Soundtrack cleared",
      });
    }

    // Voiceover config toggles (audio itself is produced by /api/generate/video)
    //   { projectId, voiceover: { mode?: "single"|"perScene", enabled?: bool, duckMusic?: bool } }
    //   { projectId, voiceover: { remove: true } }  → detach single voiceover entirely
    // mode is a config switch: settable BEFORE any audio exists (per-scene clips live on scenes)
    if (body.voiceover !== undefined) {
      let meta: Record<string, unknown> = {};
      try { meta = project.metaJson ? (JSON.parse(project.metaJson) as Record<string, unknown>) : {}; } catch { /* rebuild meta */ }
      const current = (meta.voiceover ?? null) as { assetId?: string; enabled?: boolean; duckMusic?: boolean; mode?: string } | null;
      const vo = body.voiceover as { enabled?: unknown; duckMusic?: unknown; remove?: unknown; mode?: unknown };
      if (vo.remove === true) {
        if (current) delete meta.voiceover;
        await db.videoProject.update({ where: { id: project.id }, data: { metaJson: JSON.stringify(meta) } });
        await audit.log({ userId: user.id, action: "video.voiceover_config", objectType: "VideoProject", objectId: project.id, summary: "Voiceover detached" });
      } else {
        // mode can be set without audio; the other toggles require an existing single track
        const modeValue = vo.mode === "perScene" || vo.mode === "single" ? String(vo.mode) : undefined;
        if (!modeValue && !current?.assetId && !(vo.enabled === undefined && vo.duckMusic === undefined)) {
          throw new ApiError(409, "NO_VOICEOVER", "No voiceover generated for this project yet — generate the narration audio first");
        }
        if (current?.assetId || modeValue) {
          const next = {
            ...current,
            mode: modeValue ?? current?.mode ?? "single",
            enabled: vo.enabled !== undefined ? Boolean(vo.enabled) : Boolean(current?.enabled ?? true),
            duckMusic: vo.duckMusic !== undefined ? Boolean(vo.duckMusic) : Boolean(current?.duckMusic ?? true),
          };
          meta.voiceover = next;
          await db.videoProject.update({ where: { id: project.id }, data: { metaJson: JSON.stringify(meta) } });
          await audit.log({ userId: user.id, action: "video.voiceover_config", objectType: "VideoProject", objectId: project.id, summary: `Voiceover: mode=${next.mode}, enabled=${next.enabled}, duckMusic=${next.duckMusic}` });
        }
      }
    }

    // §23 subtitle config for the final assembly
    //   { projectId, subtitles: { trackId, enabled?, burnIn? } | null }
    if (body.subtitles !== undefined) {
      let meta: Record<string, unknown> = {};
      try { meta = project.metaJson ? (JSON.parse(project.metaJson) as Record<string, unknown>) : {}; } catch { /* rebuild meta */ }
      let track: { trackId: string; enabled: boolean; burnIn: boolean } | null = null;
      if (body.subtitles && typeof body.subtitles === "object") {
        const trackId = String((body.subtitles as { trackId?: unknown }).trackId ?? "");
        const sub = trackId ? await db.subtitleTrack.findFirst({ where: { id: trackId, userId: user.id, projectId: project.id } }) : null;
        if (!sub) throw new ApiError(404, "SUBTITLE_TRACK_NOT_FOUND", "Subtitle track not found for this project");
        track = {
          trackId: sub.id,
          enabled: (body.subtitles as { enabled?: unknown }).enabled !== false,
          burnIn: Boolean((body.subtitles as { burnIn?: unknown }).burnIn),
        };
      }
      if (track) meta.subtitles = track;
      else delete meta.subtitles;
      await db.videoProject.update({ where: { id: project.id }, data: { metaJson: JSON.stringify(meta) } });
      await audit.log({
        userId: user.id,
        action: "video.subtitles_config",
        objectType: "VideoProject",
        objectId: project.id,
        summary: track ? `Subtitles: track=${track.trackId}, burnIn=${track.burnIn}` : "Subtitle config cleared",
      });
    }

    // Project-level fields
    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = String(body.title).slice(0, 200);
    if (body.script !== undefined) data.script = String(body.script).slice(0, 8000);
    if (body.characterBible !== undefined) data.characterBibleJson = JSON.stringify(body.characterBible ?? {});
    if (body.styleBible !== undefined) data.styleBibleJson = JSON.stringify(body.styleBible ?? {});
    if (Object.keys(data).length) {
      await db.videoProject.update({ where: { id: project.id }, data: data as never });
      await audit.log({ userId: user.id, action: "video.project_update", objectType: "VideoProject", objectId: project.id });
    }

    const full = await db.videoProject.findUnique({
      where: { id: project.id },
      include: { scenes: { orderBy: { order: "asc" } } },
    });
    return ok(full);
  });
}
