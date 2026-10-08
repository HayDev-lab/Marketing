// Video Assembly Engine — REAL final video via local FFmpeg (no fake success).
//
// Pipeline (per project):
//   1. probe each COMPLETED scene clip (ffprobe) — honest failure if a file is missing
//   2. normalize every clip to the project geometry (scale+pad, 30fps, h264, audio stripped)
//   3. concat via the concat demuxer (stream copy — all intermediates share codec params)
//   4. audio mixdown:
//      • soundtrack (optional): Music Studio edit-intents (§20) are APPLIED here —
//        volume / trim / fades / loop-to-fit
//      • voiceover (optional): TTS narration attached to the project (metaJson.voiceover)
//      • when BOTH are present and ducking is on, the music is ducked under the voice
//        with a REAL sidechaincompress filter (threshold derived from the §20 duckDb intent)
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
import { UPLOADS_DIR, saveAssetBuffer, materializeAsset } from "@/lib/ai/zai";

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

export async function probeMedia(file: string): Promise<ProbeResult> {
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
    musicFile = await materializeAsset(asset);
    edit = { ...edit, ...parseEdit(entry.metaJson) };
    if (typeof soundtrack.loopOverride === "boolean") edit.loop = soundtrack.loopOverride;
  }

  await jobs.markProcessing(jobId);

  const geometry = ASSEMBLE_GEOMETRY[project.aspectRatio] ?? ASSEMBLE_GEOMETRY["9:16"];
  const tmp = await mkdtemp(path.join(tmpdir(), "assemble-"));

  try {
    // ---- 1+2: normalize every ready scene to project geometry (video-only) ----
    const normFiles: string[] = [];
    const normDurations: number[] = [];
    for (const scene of ready) {
      const media = await db.mediaAsset.findUnique({ where: { id: scene.assetId! } });
      if (!media) throw new ApiError(404, "SOURCE_MISSING", `Scene ${scene.order + 1} media asset missing`);
      const file = await materializeAsset(media);
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
      // exact normalized length — the per-scene voice offsets depend on the REAL timeline
      const normProbe = await probeMedia(out);
      normDurations.push(normProbe.durationSec);
      normFiles.push(out);
    }

    // ---- 3: concat (stream copy — identical codec params) ----
    const listFile = path.join(tmp, "list.txt");
    await writeFile(listFile, normFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n", "utf8");
    const concatFile = path.join(tmp, "concat.mp4");
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", concatFile], "concat scenes");
    const concatProbe = await probeMedia(concatFile);
    const videoDur = concatProbe.durationSec;

    // ---- 4: audio mixdown — soundtrack (edit-intents §20) + voiceover (real sidechain duck) ----
    // Voiceover source resolution (honest priority):
    //   mode=perScene  → per-scene TTS clips (VideoScene.voiceAssetId) placed at their REAL
  //                    normalized offsets; falls back to the single track only when NO scene
  //                    carries a voice (recorded in editApplied as an honest note).
    //   otherwise      → the single project-level narration track (metaJson.voiceover.assetId)
    const voiceover = (projMeta.voiceover ?? null) as {
      assetId?: string; enabled?: boolean; duckMusic?: boolean; mode?: string;
    } | null;
    const perSceneRequested = voiceover?.mode === "perScene";
    interface SceneVoice { sceneId: string; order: number; assetId: string; offsetSec: number; clipDur: number; voiceDur: number | null; }
    const sceneVoices: SceneVoice[] = [];
    if (perSceneRequested) {
      let acc = 0;
      for (let i = 0; i < ready.length; i++) {
        const scene = ready[i];
        if (scene.voiceAssetId) {
          sceneVoices.push({
            sceneId: scene.id,
            order: scene.order,
            assetId: scene.voiceAssetId,
            offsetSec: acc,
            clipDur: normDurations[i] ?? scene.durationSec,
            voiceDur: scene.voiceDurationSec ?? null,
          });
        }
        acc += normDurations[i] ?? scene.durationSec;
      }
    }
    let voiceFile: string | null = null;
    let voiceMissing = false;
    let perSceneActive = false;
    let perSceneFallbackNote: string | null = null;
    if (perSceneRequested && sceneVoices.length > 0) {
      perSceneActive = true;
    } else {
      if (perSceneRequested) {
        perSceneFallbackNote = "per-scene mode requested but no scene carries a voice clip";
      }
      if (voiceover?.assetId && voiceover.enabled !== false) {
        const voAsset = await db.mediaAsset.findUnique({ where: { id: voiceover.assetId } });
        if (voAsset) voiceFile = await materializeAsset(voAsset);
        else voiceMissing = true; // honest: narration asset deleted from library — proceed without it
      }
    }

    // Resolve per-scene voice files (missing assets are skipped honestly, not fatal)
    const sceneVoiceFiles: { voice: SceneVoice; file: string }[] = [];
    let sceneVoicesMissing = 0;
    if (perSceneActive) {
      for (const v of sceneVoices) {
        const asset = await db.mediaAsset.findUnique({ where: { id: v.assetId } });
        if (asset) sceneVoiceFiles.push({ voice: v, file: await materializeAsset(asset) });
        else sceneVoicesMissing += 1;
      }
      if (sceneVoiceFiles.length === 0) {
        perSceneActive = false;
        perSceneFallbackNote = "per-scene voice assets missing on disk";
      }
    }

    let finalFile = concatFile;
    const editApplied: Record<string, unknown> = { music: false, voice: false };
    // Ducking decision: when any voice rides in the mix, duck the music by default.
    // music-edit duckDb (§20) sets how hard the sidechain pulls the music down.
    const anyVoice = perSceneActive || Boolean(voiceFile);
    const duckApplied = Boolean(musicFile && anyVoice && voiceover?.duckMusic !== false);
    const duckDb = edit.duckDb ?? -12;
    const duckThreshold = Math.min(0.4, Math.max(0.005, Math.pow(10, duckDb / 20) * 0.3));

    if (musicFile) await probeMedia(musicFile); // honest failure if soundtrack file missing

    if (perSceneActive) {
      // ---- per-scene mixdown: music chain + N delayed voice clips → duck → amix ----
      const inputIdx = (i: number) => (musicFile ? 2 : 1) + i;
      const parts: string[] = [];
      if (musicFile) {
        const musicProbe = await probeMedia(musicFile);
        const tStart = Math.min(edit.trimStartSec ?? 0, Math.max(0, musicProbe.durationSec - 0.5));
        const tEnd = edit.trimEndSec != null ? Math.min(edit.trimEndSec, musicProbe.durationSec) : musicProbe.durationSec;
        const trimmedDur = Math.max(0.2, tEnd - tStart);
        const fits = trimmedDur >= videoDur - 0.05;
        const audioEnd = edit.loop ? videoDur : Math.min(trimmedDur, videoDur);
        const fadeIn = Math.min(edit.fadeInSec ?? 0, audioEnd);
        const fadeOut = Math.min(edit.fadeOutSec ?? 0, Math.max(0, audioEnd - fadeIn));
        const musicChain = [
          "atrim=start=" + tStart.toFixed(3) + ":end=" + tEnd.toFixed(3),
          "asetpts=PTS-STARTPTS",
          fadeIn > 0.01 ? `afade=t=in:st=0:d=${fadeIn.toFixed(3)}` : null,
          fadeOut > 0.01 ? `afade=t=out:st=${Math.max(0, audioEnd - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}` : null,
          `volume=${Math.min(2, Math.max(0, edit.volume ?? 1)).toFixed(3)}`,
          "aresample=44100",
          "apad=whole_dur=" + videoDur.toFixed(3),
        ].filter(Boolean).join(",");
        parts.push(`[1:a]${musicChain}[m];`);
        Object.assign(editApplied, {
          music: true,
          musicAssetId: soundtrack?.musicAssetId,
          volume: edit.volume,
          loop: edit.loop && !fits,
        });
      }

      const overflowScenes: number[] = [];
      let totalVoiceSec = 0;
      const voiceLabels: string[] = [];
      for (let i = 0; i < sceneVoiceFiles.length; i++) {
        const { voice, file } = sceneVoiceFiles[i];
        const probe = await probeMedia(file);
        const spoken = voice.voiceDur ?? probe.durationSec;
        totalVoiceSec += spoken;
        if (voice.voiceDur != null && voice.voiceDur > voice.clipDur + 0.05) overflowScenes.push(voice.order + 1);
        const ms = Math.max(0, Math.round(voice.offsetSec * 1000));
        parts.push(
          `[${inputIdx(i)}:a]aresample=44100,adelay=${ms}:all=1,apad=whole_dur=${videoDur.toFixed(3)}[vs${i}];`
        );
        voiceLabels.push(`[vs${i}]`);
      }

      // mix the (non-overlapping-in-plan) voice clips into one full-length voice track
      let voiceTrackLabel: string;
      if (voiceLabels.length === 1) {
        voiceTrackLabel = voiceLabels[0];
      } else {
        parts.push(`${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:duration=longest:normalize=0[vsum];`);
        voiceTrackLabel = "[vsum]";
      }

      let aoutLabel: string;
      if (musicFile && duckApplied) {
        // vsum feeds the sidechain AND the final mix → asplit (ffmpeg forbids unconnected pads)
        parts.push(`${voiceTrackLabel}asplit=2[vsc][vmix];`);
        parts.push(`[m][vsc]sidechaincompress=threshold=${duckThreshold.toFixed(4)}:ratio=8:attack=25:release=450[md];`);
        parts.push(`[md][vmix]amix=inputs=2:duration=longest:normalize=0[aout]`);
        aoutLabel = "[aout]";
      } else if (musicFile) {
        parts.push(`[m]${voiceTrackLabel}amix=inputs=2:duration=longest:normalize=0[aout]`);
        aoutLabel = "[aout]";
      } else {
        aoutLabel = voiceTrackLabel;
      }

      finalFile = path.join(tmp, "final.mp4");
      const args = ["-y", "-i", concatFile];
      if (musicFile) args.push("-i", musicFile);
      for (const { file } of sceneVoiceFiles) args.push("-i", file);
      args.push("-filter_complex", parts.join(""), "-map", "0:v:0", "-map", aoutLabel);
      args.push("-t", videoDur.toFixed(3), "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", finalFile);
      await run("ffmpeg", args, "per-scene voice mixdown");
      Object.assign(editApplied, {
        voice: {
          applied: true,
          mode: "perScene",
          voicedScenes: sceneVoiceFiles.map((v) => v.voice.order + 1),
          missingVoiceAssets: sceneVoicesMissing,
          totalVoiceSec: Number(totalVoiceSec.toFixed(2)),
          overflowIntoNext: overflowScenes.length ? overflowScenes : null,
          duck: duckApplied ? { engine: "sidechaincompress", threshold: Number(duckThreshold.toFixed(4)), ratio: 8, derivedFromDuckDb: duckDb } : false,
        },
        duck: duckApplied ? "applied — music ducked under per-scene voices (sidechaincompress)" : false,
        note: perSceneFallbackNote ?? (sceneVoicesMissing ? `${sceneVoicesMissing} scene voice asset(s) missing on disk — skipped honestly` : null),
      });
    } else if (musicFile && voiceFile) {
      // music + voice: filter_complex — music chain → sidechaincompress(voice) → amix
      await probeMedia(voiceFile);
      const musicProbe = await probeMedia(musicFile);
      const tStart = Math.min(edit.trimStartSec ?? 0, Math.max(0, musicProbe.durationSec - 0.5));
      const tEnd = edit.trimEndSec != null ? Math.min(edit.trimEndSec, musicProbe.durationSec) : musicProbe.durationSec;
      const trimmedDur = Math.max(0.2, tEnd - tStart);
      const fits = trimmedDur >= videoDur - 0.05;
      const audioEnd = edit.loop ? videoDur : Math.min(trimmedDur, videoDur);
      const fadeIn = Math.min(edit.fadeInSec ?? 0, audioEnd);
      const fadeOut = Math.min(edit.fadeOutSec ?? 0, Math.max(0, audioEnd - fadeIn));
      const musicChain = [
        "atrim=start=" + tStart.toFixed(3) + ":end=" + tEnd.toFixed(3),
        "asetpts=PTS-STARTPTS",
        fadeIn > 0.01 ? `afade=t=in:st=0:d=${fadeIn.toFixed(3)}` : null,
        fadeOut > 0.01 ? `afade=t=out:st=${Math.max(0, audioEnd - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}` : null,
        `volume=${Math.min(2, Math.max(0, edit.volume ?? 1)).toFixed(3)}`,
        "aresample=44100",
        "apad=whole_dur=" + videoDur.toFixed(3),
      ].filter(Boolean).join(",");

      const duckChain = duckApplied
        ? `[m][vs]sidechaincompress=threshold=${duckThreshold.toFixed(4)}:ratio=8:attack=25:release=450[md];`
        : "";
      // asplit only when the voice also feeds the sidechain — ffmpeg fails on unconnected pads
      const voiceChain = duckApplied
        ? `[2:a]aresample=44100,asplit=2[vs][vp];`
        : `[2:a]aresample=44100[vp];`;
      const fc = [
        `[1:a]${musicChain}[m];`,
        voiceChain,
        duckChain,
        `[vp]apad=whole_dur=${videoDur.toFixed(3)}[vpd];`,
        `[md][vpd]amix=inputs=2:duration=longest:normalize=0[aout]`,
      ].filter(Boolean).join("");

      finalFile = path.join(tmp, "final.mp4");
      const args = ["-y", "-i", concatFile];
      if (edit.loop && !fits) args.push("-stream_loop", "-1");
      args.push("-i", musicFile, "-i", voiceFile);
      args.push("-filter_complex", fc, "-map", "0:v:0", "-map", "[aout]");
      args.push("-t", videoDur.toFixed(3), "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", finalFile);
      await run("ffmpeg", args, "music+voice mixdown");
      Object.assign(editApplied, {
        music: true,
        musicAssetId: soundtrack?.musicAssetId,
        volume: edit.volume,
        trimSec: tEnd < musicProbe.durationSec || tStart > 0 ? [tStart, tEnd] : null,
        fadeInSec: fadeIn,
        fadeOutSec: fadeOut,
        loop: edit.loop && !fits,
        loopReason: edit.loop && !fits ? "music shorter than video — looped to fit" : null,
        audioEndsAtSec: edit.loop ? null : Number(Math.min(trimmedDur, videoDur).toFixed(2)),
        voice: { applied: true, assetId: voiceover?.assetId, duck: duckApplied ? { engine: "sidechaincompress", threshold: Number(duckThreshold.toFixed(4)), ratio: 8, derivedFromDuckDb: duckDb } : false },
        duck: duckApplied ? "applied — music ducked under voice (sidechaincompress)" : (edit.duckEnabled ? "voiceover ducking disabled for this project" : false),
      });
    } else if (voiceFile) {
      // voice only — narration is the sole audio track
      await probeMedia(voiceFile);
      finalFile = path.join(tmp, "final.mp4");
      await run("ffmpeg", [
        "-y", "-i", concatFile, "-i", voiceFile,
        "-map", "0:v:0", "-map", "1:a:0",
        "-af", "aresample=44100",
        "-t", videoDur.toFixed(3),
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
        finalFile,
      ], "voice-only mixdown");
      Object.assign(editApplied, {
        voice: { applied: true, assetId: voiceover?.assetId, duck: false },
        duck: false,
        note: "voiceover only — no soundtrack selected",
      });
    } else if (musicFile) {
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
        audioEndsAtSec: edit.loop ? null : Number(Math.min(trimmedDur, videoDur).toFixed(2)),
        duck: edit.duckEnabled ? (voiceMissing ? "voiceover asset missing — duck not applicable" : "duck intent set, but no voiceover in this assembly") : false,
      });
    } else {
      Object.assign(editApplied, { music: false, note: "no soundtrack selected — final video is silent" });
    }

    // ---- 4b: subtitle burn-in (§23) — extra video re-encode pass, only when enabled ----
    // Honest degradation: if the burn-in pass fails, the assembly still ships WITHOUT
    // subtitles and the failure reason is recorded in editApplied.subtitles.error.
    const subsConfig = (projMeta.subtitles ?? null) as { trackId?: string; enabled?: boolean; burnIn?: boolean } | null;
    if (subsConfig?.trackId && subsConfig.enabled !== false && subsConfig.burnIn) {
      const track = await db.subtitleTrack.findFirst({ where: { id: subsConfig.trackId, userId: job.userId } });
      if (!track) {
        Object.assign(editApplied, { subtitles: { applied: false, error: "subtitle track no longer exists" } });
      } else {
        try {
          const srtFile = path.join(tmp, "subs.srt");
          await writeFile(srtFile, track.content, "utf8");
          const esc = srtFile.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
          const burned = path.join(tmp, "burned.mp4");
          await run("ffmpeg", [
            "-y", "-i", finalFile,
            "-vf",
            `subtitles=${esc}:force_style='FontName=Noto Sans Armenian,FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0,MarginV=36,WrapStyle=0'`,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-c:a", "copy", "-movflags", "+faststart",
            burned,
          ], "subtitle burn-in");
          finalFile = burned;
          Object.assign(editApplied, {
            subtitles: { applied: true, trackId: track.id, language: track.language, cueSource: "SRT" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message.slice(-300) : "burn-in failed";
          Object.assign(editApplied, { subtitles: { applied: false, error: message } });
        }
      }
    } else if (subsConfig?.trackId) {
      Object.assign(editApplied, { subtitles: { applied: false, reason: "burn-in disabled — track available as sidecar export" } });
    }

    const finalProbe = await probeMedia(finalFile);
    const buf = await readFile(finalFile);
    const hasAudio = Boolean(musicFile || voiceFile || perSceneActive);
    const subsApplied = (editApplied.subtitles as { applied?: boolean } | undefined)?.applied === true;

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

    const nextMeta = { ...projMeta, soundtrack, subtitles: subsConfig ?? null, assembly: { assembledAt: new Date().toISOString(), assetId: asset.id, scenesIncluded: ready.length, scenesSkipped: skipped, durationSec: Number(finalProbe.durationSec.toFixed(2)), hasAudio, hasVoice: Boolean(voiceFile) || perSceneActive, voiceMode: perSceneActive ? "perScene" : voiceFile ? "single" : null, subtitlesBurnedIn: subsApplied, editApplied } };
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
      { assetId: asset.id, url: `/api/assets/${asset.id}/raw`, durationSec: Number(finalProbe.durationSec.toFixed(2)), scenesIncluded: ready.length, scenesSkipped: skipped, hasAudio, hasVoice: Boolean(voiceFile) || perSceneActive, voiceMode: perSceneActive ? "perScene" : voiceFile ? "single" : null, ducked: duckApplied, subtitlesBurnedIn: subsApplied },
      asset.id,
      0,
    );
    const audioDesc = !hasAudio
      ? "silent"
      : perSceneActive
        ? `per-scene voices ×${sceneVoiceFiles.length}${musicFile ? "+music" : ""}`
        : musicFile && voiceFile
          ? "music+voice mixed"
          : voiceFile
            ? "voice only"
            : "soundtrack mixed";
    await audit.log({
      userId: job.userId,
      actorType: "SYSTEM",
      action: "video.assembled",
      objectType: "VideoProject",
      objectId: project.id,
      summary: `${ready.length}/${project.scenes.length} scenes, ${finalProbe.durationSec.toFixed(1)}s, ${audioDesc}${duckApplied ? ", ducked" : ""}${subsApplied ? ", subtitles burned" : ""}, ${(buf.length / 1024 / 1024).toFixed(1)}MB`,
    });

    return await db.generationJob.findUnique({ where: { id: jobId } });
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => { /* temp best-effort */ });
  }
}
