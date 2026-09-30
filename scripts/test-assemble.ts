// QA script: runs the REAL ffmpeg assembly pipeline against an existing project
// (server-side identity, no provider spend). Verifies probe → normalize → concat →
// mixdown → asset → project.finalAssetId honestly.
//
//   bun run scripts/test-assemble.ts [projectId] [musicAssetId]
import { db } from "@/lib/db";
import { jobs } from "@/lib/jobs";
import { runAssemblyJob } from "@/lib/video/assemble";
import { UPLOADS_DIR, saveAssetBuffer } from "@/lib/ai/zai";
import { getMusicAdapter } from "@/lib/music/adapter";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

async function main() {
  const projectId = process.argv[2] ?? "cmumzumgf0087kfwz8tow97so"; // Coffee promo reel (pilot)
  const musicAssetId = process.argv[3]; // optional; if absent + user has no track, synth one

  const project = await db.videoProject.findUnique({ where: { id: projectId }, include: { scenes: true } });
  if (!project) throw new Error(`project ${projectId} not found`);
  console.log(`project: ${project.title} | ${project.aspectRatio} | scenes=${project.scenes.length}`);

  let trackId = musicAssetId ?? null;
  if (!trackId) {
    const existing = await db.musicAsset.findFirst({ where: { userId: project.userId, assetId: { not: null } } });
    if (existing) {
      trackId = existing.id;
      console.log(`using existing track: ${existing.title}`);
    } else {
      // REAL local synthesis (haydev-synth) — no external provider, no fake data
      const adapter = getMusicAdapter("haydev-synth");
      if (!adapter) throw new Error("synth adapter unavailable");
      const render = await adapter.generate({ preset: "lofi", tempo: 80, durationSec: 20, seed: 20260214 });
      const asset = await saveAssetBuffer(project.userId, render.wav, "MUSIC", "audio/wav", `qa_track_${Date.now()}.wav`, { qa: true, preset: render.preset });
      const entry = await db.musicAsset.create({
        data: {
          userId: project.userId,
          title: "QA lofi · 80bpm",
          source: "GENERATED",
          provider: "haydev-synth",
          assetId: asset.id,
          durationSec: render.durationSec,
          cost: 0,
          metaJson: JSON.stringify({ preset: render.preset, tempo: render.tempo, seed: render.seed, bars: render.bars, edit: { volume: 1, trimStartSec: 1, trimEndSec: null, fadeInSec: 1, fadeOutSec: 2, loop: true, duckEnabled: false, duckDb: null } }),
        },
      });
      trackId = entry.id;
      console.log(`synthesized real QA track: ${entry.id} (${render.durationSec}s)`);
    }
  }

  const meta = project.metaJson ? JSON.parse(project.metaJson) : {};
  meta.soundtrack = { musicAssetId: trackId, loopOverride: false };
  await db.videoProject.update({ where: { id: project.id }, data: { metaJson: JSON.stringify(meta) } });
  console.log(`soundtrack set: ${trackId}`);

  const { job } = await jobs.create({
    userId: project.userId,
    kind: "ASSEMBLE",
    provider: "ffmpeg-local",
    model: "h264-aac",
    input: { projectId: project.id },
    maxAttempts: 1,
  });
  console.log(`job ${job.id} created (${job.status})`);

  const done = await runAssemblyJob(job.id);
  console.log(`job final status: ${done?.status}`);
  if (done?.error) console.log(`job error: ${done.error}`);
  if (done?.outputJson) console.log(`output: ${JSON.stringify(JSON.parse(done.outputJson), null, 1)}`);

  if (done?.resultAssetId) {
    const asset = await db.mediaAsset.findUnique({ where: { id: done.resultAssetId } });
    if (asset) {
      const file = path.join(UPLOADS_DIR, asset.storageKey);
      const probe = await execFileAsync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file]);
      const info = JSON.parse(probe.stdout);
      console.log(`final file: ${file}`);
      console.log(`container: ${info.format.format_name}, duration=${info.format.duration}s, size=${info.format.size}`);
      for (const s of info.streams) console.log(`stream: ${s.codec_type} ${s.codec_name} ${s.width ?? ""}${s.height ? "x" + s.height : ""}${s.sample_rate ? " " + s.sample_rate + "Hz" : ""}`);
    }
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
