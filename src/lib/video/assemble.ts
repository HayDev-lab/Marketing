// Video Assembly Engine — REAL final video via local FFmpeg (no fake success).
//
// Pipeline (per project):
//   1. probe each COMPLETED scene clip (ffprobe) — honest failure if a file is missing
//   2. normalize every clip to the project geometry (scale+pad, 30fps, h264, audio stripped)
//   3. concat via the concat demuxer (stream copy — all intermediates share codec params)
//   4. soundtrack mixdown (optional): Music Studio edit-intents (§20) are APPLIED here —
//      volume / trim / fades / loop-to-fit; duck is recorded but not applied until
//      voiceover mixing ships (honest note in output meta)
//   5. final MP4 → MediaAsset → project.finalAssetId + status ASSEMBLED
//
// Runs inside a durable GenerationJob (kind=ASSEMBLE): the API route creates the job
// and kicks the runner fire-and-forget; the client polls /api/jobs/[id]. A crash
// leaves the job resumable (resume re-kicks the runner).

import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/ledger";
import { jobs } from "@/lib/jobs";
import { UPLOADS_DIR, saveAssetBuffer } from "@/lib/ai/zai";

const execFileAsync = promisify(execFile);

export const ASSEMBLE_GEOMETRY: Record<string, { w: number; h: number }> = {
  "9:16": { w: 720, h: 1280 },
  "1:1": { w: 720, h: 720 },
  "16:9": { w: 1280, h: 720 },
};

export interface EditIntents {
  volume: number;
  trimStartSec: number;
  trimEndSec: number | null;
  fadeInSec: number;
  fadeOutSec: number;
  loop: boolean;
  duckEnabled: boolean;
  duckDb: number | null;
}

interface AssembleInput {
  projectId: string;
}

// In-process guard: the same job is never run twice concurrently in this tab/process.
const running = new Set<string>();

export function isAssembling(jobId: string): boolean {
  return running.has(jobId);
}

/** Fire-and-forget kick with honest failure capture into the job row. */
export function kickAssembly(jobId: string): void {
  if (running.has(jobId)) return;
  running.add(jobId);
  void runAssemblyJob(jobId)
    .catch(async (err: unknown) => {
      const message = err instanceof ApiError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : "Assembly failed";
      try { await jobs.markFailed(jobId, message); } catch { /* job may be gone */ }
    })
    .finally(() => running.delete(jobId));
}

function run(cmd: string, args: string[], label: string): Promise<string> {
  return execFileAsync(cmd, args, { timeout: 5 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 })
    .then((r) => String(r.stdout ?? ""))
    .catch((err: unknown) => {
      const e = err as { stderr?: string; message?: string };
      const detail = (e.stderr ?? e.message ?? "unknown ffmpeg error").slice(-600);
      throw new Error(`${label} failed: ${detail}`);
    });
}

interface ProbeResult {
  durationSec: number;
  hasAudio: boolean;
}

async function probeMedia(file: string): Promise<ProbeResult> {
  if (!existsSync(file)) throw new ApiError(409, "SOURCE_MISSING", `Source file missing on disk: ${path.basename(file)}`);
  const out = await run("ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file,
  ], "ffprobe");
  let parsed: { format?: { duration?: string }; streams?: { codec_type?: string }[] } = {};
  try { parsed = JSON.parse(out); } catch { /* handled below as invalid */ }
  const duration = Number(parsed.format?.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new ApiError(409, "BAD_SOURCE", `Unreadable media (no duration): ${path.basename(file)}`);
  }
  return { durationSec: duration, hasAudio: (parsed.streams ?? []).some((s) => s.codec_type === "audio") };
}

function parseEdit(raw: string | null | undefined): Partial<EditIntents> {
  if (!raw) return {};
  try {
    const meta = JSON.parse(raw) as { edit?: Partial<EditIntents> };
    return meta.edit ?? {};
  } catch {
    return {};
  }
}

/**
 * Run one ASSEMBLE job end-to-end. Throws ApiError with honest codes:
 *   JOB_NOT_FOUND / JOB_NOT_ASSEMBLE / BAD_STATE / NO_SCENES / SOURCE_MISSING /
 *   BAD_SOURCE / NO_SOUNDTRACK / SOUNDTRACK_MISSING
 * On success the job row is COMPLETED and the project carries the final asset.
 */
export async function runAssemblyJob(jobId: string) {
  const job = await db.generationJob.findUnique({ where: { id: jobId } });
  if (!job) throw new ApiError(404, "JOB_NOT_FOUND", "Assembly job not found");
  if (job.kind !== "ASSEMBLE") throw new ApiError(400, "JOB_NOT_ASSEMBLE", "Not an assembly job");
  if (job.status === "COMPLETED") return job;
  if (["FAILED", "CANCELLED"].includes(job.status)) throw new ApiError(409, "BAD_STATE", "Job already terminal");
  if (job.status !== "QUEUED" && job.status !== "RETRYING" && job.status !== "PROCESSING") {
    throw new ApiError(409, "BAD_STATE", `Job not runnable in status ${job.status}`);
  }

  const input = (job.inputJson ? JSON.parse(job.inputJson) : {}) as Partial<AssembleInput>;
  const projectId = String(input.projectId ?? "");
  if (!projectId) throw new ApiError(400, "VALIDATION", "projectId missing from job input");

  const project = await db.videoProject.findUnique({
    where: { id: projectId },
    include: { scenes: { orderBy: { order: "asc" } } },
  });
  if (!project || project.userId !== job.userId) throw new ApiError(404, "NOT_FOUND", "Project not found");

  const ready = project.scenes.filter((s) => s.status === "COMPLETED" && s.assetId);
  if (ready.length === 0) {
    throw new ApiError(409, "NO_SCENES", "No generated scenes to assemble — generate at least one scene first");
  }
  const skipped = project.scenes
    .filter((s) => !(s.status === "COMPLETED" && s.assetId))
    .map((s) => ({ id: s.id, order: s.order, status: s.status }));

  // ---- soundtrack resolution (edit-intents §20, loop override per project) ----
  const projMeta = (() => {
    try { return project.metaJson ? (JSON.parse(project.metaJson) as Record<string, unknown>) : {}; } catch { return {}; }
  })();
  const soundtrack = (projMeta.soundtrack ?? null) as { musicAssetId?: string; loopOverride?: boolean } | null;
  let musicFile: string | null = null;
  let edit: EditIntents = {
    volume: 1, trimStartSec: 0, trimEndSec: null, fadeInSec: 0, fadeOutSec: 0, loop: false, duckEnabled: false, duckDb: null,
  };
  if (soundtrack?.musicAssetId) {
    const entry = await db.musicAsset.findFirst({ where: { id: soundtrack.musicAssetId, userId: job.userId } });
    if (!entry) throw new ApiError(404, "NO_SOUNDTRACK", "Selected soundtrack entry no longer exists");
    if (!entry.assetId) throw new ApiError(409, "NO_SOUNDTRACK", "Selected soundtrack has no audio file (lyrics-only entry)");
    const asset = await db.mediaAsset.findUnique({ where: { id: entry.assetId } });
    if (!asset) throw new ApiError(404, "NO_SOUNDTRACK", "Soundtrack media asset missing");
    musicFile = path.join(UPLOADS_DIR, asset.storageKey);
    edit = { ...edit, ...parseEdit(entry.metaJson) };
    if (typeof soundtrack.loopOverride === "boolean") edit.loop = soundtrack.loopOverride;
  }

  await jobs.markProcessing(jobId);

  const geometry = ASSEMBLE_GEOMETRY[project.aspectRatio] ?? ASSEMBLE_GEOMETRY["9:16"];
  const tmp = await mkdtemp(path.join(tmpdir(), "assemble-"));

  try {
    // ---- 1+2: normalize every ready scene to project geometry (video-only) ----
    const normFiles: string[] = [];
    for (const scene of ready) {
      const media = await db.mediaAsset.findUnique({ where: { id: scene.assetId! } });
      if (!media) throw new ApiError(404, "SOURCE_MISSING", `Scene ${scene.order + 1} media asset missing`);
      const file = path.join(UPLOADS_DIR, media.storageKey);
      await probeMedia(file); // honest early failure per scene
      const out = path.join(tmp, `norm_${scene.order}_${normFiles.length}.mp4`);
      await run("ffmpeg", [
        "-y", "-i", file,
        "-vf",
        `scale=${geometry.w}:${geometry.h}:force_original_aspect_ratio=decrease,pad=${geometry.w}:${geometry.h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30`,
        "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        out,
      ], `normalize scene ${scene.order + 1}`);
      normFiles.push(out);
    }

    // ---- 3: concat (stream copy — identical codec params) ----
    const listFile = path.join(tmp, "list.txt");
    await writeFile(listFile, normFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n", "utf8");
    const concatFile = path.join(tmp, "concat.mp4");
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", concatFile], "concat scenes");
    const concatProbe = await probeMedia(concatFile);
    const videoDur = concatProbe.durationSec;

    // ---- 4: soundtrack mixdown with applied edit-intents ----
    let finalFile = concatFile;
    const editApplied: Record<string, unknown> = { music: false };
    if (musicFile) {
      await probeMedia(musicFile); // honest failure if soundtrack file missing
      const musicProbe = await probeMedia(musicFile);
      const tStart = Math.min(edit.trimStartSec ?? 0, Math.max(0, musicProbe.durationSec - 0.5));
      const tEnd = edit.trimEndSec != null ? Math.min(edit.trimEndSec, musicProbe.durationSec) : musicProbe.durationSec;
      const trimmedDur = Math.max(0.2, tEnd - tStart);
      const fits = trimmedDur >= videoDur - 0.05;
      const audioEnd = edit.loop ? videoDur : Math.min(trimmedDur, videoDur);
      const fadeIn = Math.min(edit.fadeInSec ?? 0, audioEnd);
      const fadeOut = Math.min(edit.fadeOutSec ?? 0, Math.max(0, audioEnd - fadeIn));
      const chain = [
        "atrim=start=" + tStart.toFixed(3) + ":end=" + tEnd.toFixed(3),
        "asetpts=PTS-STARTPTS",
        fadeIn > 0.01 ? `afade=t=in:st=0:d=${fadeIn.toFixed(3)}` : null,
        fadeOut > 0.01 ? `afade=t=out:st=${Math.max(0, audioEnd - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}` : null,
        `volume=${Math.min(2, Math.max(0, edit.volume ?? 1)).toFixed(3)}`,
        "aresample=44100",
      ].filter(Boolean).join(",");

      finalFile = path.join(tmp, "final.mp4");
      const args = ["-y", "-i", concatFile];
      if (edit.loop && !fits) args.push("-stream_loop", "-1");
      args.push("-i", musicFile);
      args.push("-map", "0:v:0", "-map", "1:a:0");
      if (edit.loop && !fits) args.push("-t", videoDur.toFixed(3));
      args.push("-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-af", chain, "-movflags", "+faststart", finalFile);
      await run("ffmpeg", args, "soundtrack mixdown");
      Object.assign(editApplied, {
        music: true,
        musicAssetId: soundtrack?.musicAssetId,
        volume: edit.volume,
        trimSec: tEnd < musicProbe.durationSec || tStart > 0 ? [tStart, tEnd] : null,
        fadeInSec: fadeIn,
        fadeOutSec: fadeOut,
        loop: edit.loop && !fits,
        loopReason: edit.loop && !fits ? "music shorter than video — looped to fit" : null,
        duck: edit.duckEnabled ? "recorded — voiceover mixing ships later" : false,
        audioEndsAtSec: edit.loop ? null : Number(Math.min(trimmedDur, videoDur).toFixed(2)),
      });
    } else {
      Object.assign(editApplied, { music: false, note: "no soundtrack selected — final video is silent" });
    }

    const finalProbe = await probeMedia(finalFile);
    const buf = await readFile(finalFile);

    // ---- 5: persist final asset + project state ----
    const asset = await saveAssetBuffer(project.userId, buf, "VIDEO", "video/mp4", `final_${project.title.slice(0, 40).replace(/\s+/g, "_")}_v${project.currentVersion}.mp4`, {
      assembled: true,
      assembler: "ffmpeg-local",
      geometry: `${geometry.w}x${geometry.h}`,
      fps: 30,
      scenesIncluded: ready.length,
      scenesSkipped: skipped,
      durationSec: Number(finalProbe.durationSec.toFixed(2)),
      editApplied,
    });

    const nextMeta = { ...projMeta, soundtrack, assembly: { assembledAt: new Date().toISOString(), assetId: asset.id, scenesIncluded: ready.length, scenesSkipped: skipped, durationSec: Number(finalProbe.durationSec.toFixed(2)), hasAudio: Boolean(musicFile), editApplied } };
    const allDone = ready.length === project.scenes.length;
    await db.videoProject.update({
      where: { id: project.id },
      data: {
        finalAssetId: asset.id,
        status: allDone ? "ASSEMBLED" : project.status,
        metaJson: JSON.stringify(nextMeta),
      },
    });

    await jobs.markCompleted(
      jobId,
      { assetId: asset.id, url: `/api/assets/${asset.id}/raw`, durationSec: Number(finalProbe.durationSec.toFixed(2)), scenesIncluded: ready.length, scenesSkipped: skipped, hasAudio: Boolean(musicFile) },
      asset.id,
      0,
    );
    await audit.log({
      userId: job.userId,
      actorType: "SYSTEM",
      action: "video.assembled",
      objectType: "VideoProject",
      objectId: project.id,
      summary: `${ready.length}/${project.scenes.length} scenes, ${finalProbe.durationSec.toFixed(1)}s, ${musicFile ? "soundtrack mixed" : "silent"}, ${(buf.length / 1024 / 1024).toFixed(1)}MB`,
    });

    return await db.generationJob.findUnique({ where: { id: jobId } });
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => { /* temp best-effort */ });
  }
}
