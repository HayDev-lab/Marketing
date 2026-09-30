// POST /api/generate/music — Music Studio generation (MASTER PROMPT §20-21).
//
// Honest capability mapping for the four spec modes:
//   A. music from description → LLM parses description into musical parameters
//      (preset / tempo / key) → haydev-synth renders REAL audio.
//   B. song from user lyrics  → REFUSED honestly: no lyrics-capable provider is
//      active in this environment (ElevenLabs/Suno BLOCKED_EXTERNAL). Lyrics can
//      be written by the LLM lyricist, but singing requires an external provider.
//   C. instrumental           → haydev-synth direct render.
//   D. background soundtrack  → haydev-synth with loop-friendly presets.
//
// Every render goes through the durable GenerationJob queue (kind=MUSIC).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser } from "@/lib/api";
import { audit, ledger } from "@/lib/ledger";
import { assertQuota } from "@/lib/subscription";
import { jobs } from "@/lib/jobs";
import { saveAssetBuffer, llmCompleteJson, llmComplete } from "@/lib/ai/zai";
import { getMusicAdapter, resolveMusicRoute, SYNTH_CAPS } from "@/lib/music/adapter";
import { SYNTH_PRESETS, presetById } from "@/lib/music/synth";

const ALLOWED_PRESETS = SYNTH_PRESETS.map((p) => p.id);

interface MusicParams {
  preset: string;
  tempo: number;
  durationSec: number;
  seed?: number;
}

function clampParams(raw: Partial<MusicParams>): MusicParams {
  const preset = ALLOWED_PRESETS.includes(String(raw.preset)) ? String(raw.preset) : "ambient";
  const tempo = Math.min(140, Math.max(60, Math.round(Number(raw.tempo) || presetById(preset).bpm)));
  const durationSec = Math.min(60, Math.max(10, Math.round(Number(raw.durationSec) || 20)));
  const seed = raw.seed !== undefined ? Math.abs(Math.floor(Number(raw.seed))) % 2 ** 31 : undefined;
  return { preset, tempo, durationSec, seed };
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();

    // ---------- capabilities (honest introspection for the UI) ----------
    if (body.action === "capabilities") {
      const route = resolveMusicRoute("instrumental");
      return ok({
        providerId: route.route?.providerId ?? null,
        modelId: route.route?.modelId ?? null,
        capabilities: route.route?.capabilities ?? SYNTH_CAPS,
        presets: SYNTH_PRESETS.map((p) => ({ id: p.id, bpm: p.bpm, drums: p.drums })),
        lyricsCapableProviders: resolveMusicRoute("song").blockedBy ?? [],
      });
    }

    // ---------- LLM lyricist (honest: text only, no singing) ----------
    if (body.action === "lyrics") {
      const theme = String(body.theme ?? "").trim();
      if (!theme) throw new ApiError(400, "VALIDATION", "Theme is required");
      if (theme.length > 1000) throw new ApiError(400, "VALIDATION", "Theme too long (max 1000 chars)");
      const language = String(body.language ?? "hy").slice(0, 8);
      const genre = String(body.genre ?? "").slice(0, 60);

      const lyrics = await llmComplete({
        system:
          "You are a professional songwriter. Write original song lyrics. " +
          "Structure: [Verse 1], [Chorus], [Verse 2], [Chorus], [Bridge], [Chorus]. " +
          "Keep the language natural for the requested locale. No explanations, no preamble — lyrics only.",
        prompt: `Theme: ${theme}\nLanguage: ${language}\nStyle/genre: ${genre || "any fitting genre"}\nWrite complete song lyrics.`,
        maxTokens: 1200,
      });

      // Persist as a lyrics-only library entry (honest: source=LYRICS, no audio)
      const entry = await db.musicAsset.create({
        data: {
          userId: user.id,
          brandId: typeof body.brandId === "string" && body.brandId ? body.brandId : null,
          title: theme.slice(0, 80),
          lyrics: lyrics.slice(0, 8000),
          stylePrompt: genre ? genre.slice(0, 200) : null,
          source: "LYRICS",
          provider: "zai-core",
          metaJson: JSON.stringify({ language, mode: "song" }),
        },
      });
      await audit.log({ userId: user.id, action: "music.lyrics", objectType: "MusicAsset", objectId: entry.id, summary: `Lyrics ${lyrics.length} chars (${language})` });
      return ok({ id: entry.id, lyrics }, 201);
    }

    // ---------- generation (A/C/D) ----------
    const mode = ["instrumental", "soundtrack", "description"].includes(String(body.mode))
      ? String(body.mode)
      : "instrumental";

    // Mode B (song) is refused honestly — no lyrics-capable provider active.
    if (String(body.mode) === "song") {
      const blocked = resolveMusicRoute("song").blockedBy ?? [];
      throw new ApiError(
        503,
        "NO_LYRICS_PROVIDER",
        "Singing/lyrics rendering requires an external music provider (e.g. Suno, ElevenLabs). " +
          "All lyrics-capable providers are BLOCKED_EXTERNAL in this environment. " +
          "Use the built-in lyricist to write lyrics, and an instrumental soundtrack instead.",
        { blocked, canRetry: false },
      );
    }

    let params: MusicParams;
    let descriptionUsed: string | null = null;

    if (mode === "description") {
      const description = String(body.description ?? "").trim();
      if (!description) throw new ApiError(400, "VALIDATION", "Description is required");
      if (description.length > 1000) throw new ApiError(400, "VALIDATION", "Description too long (max 1000 chars)");
      descriptionUsed = description;
      // LLM = creative director: translates words into musical parameters.
      const parsed = await llmCompleteJson<Partial<MusicParams>>({
        system:
          "You translate short music descriptions into structured parameters for an algorithmic composer. " +
          `Allowed presets: ${ALLOWED_PRESETS.join(", ")}. ` +
          'Respond with JSON only: {"preset": string, "tempo": number (60-140), "durationSec": number (10-60)}.',
        prompt: `Music description: ${description}\nRequested duration (sec): ${body.durationSec ?? "not specified"}`,
      });
      params = clampParams({ ...parsed, durationSec: body.durationSec ?? parsed.durationSec, seed: body.seed });
    } else {
      params = clampParams({
        preset: body.preset,
        tempo: body.tempo,
        durationSec: body.durationSec ?? (mode === "soundtrack" ? 30 : 20),
        seed: body.seed,
      });
    }

    const adapter = getMusicAdapter("haydev-synth");
    const route = resolveMusicRoute(mode === "description" ? "description" : mode === "soundtrack" ? "soundtrack" : "instrumental");
    if (!adapter || !route.route) throw new ApiError(503, "NO_PROVIDER", "No music provider available");

    // Synth is local & free, but counts against the plan's monthly music cap.
    const estimatedCost = 0;
    await assertQuota(user.id, "MUSIC_GENERATION", estimatedCost);
    await ledger.assertBudget(user.id, estimatedCost);

    const { job } = await jobs.create({
      userId: user.id,
      kind: "MUSIC",
      provider: route.route.providerId,
      model: route.route.modelId,
      input: { mode, ...params, description: descriptionUsed, brandId: body.brandId ?? null },
      idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : undefined,
      brandId: body.brandId ?? undefined,
      estimatedCost,
    });
    if (job.status === "COMPLETED" && job.resultAssetId) {
      return ok({ jobId: job.id, musicId: job.outputJson ? (JSON.parse(job.outputJson).musicId as string) : null, deduplicated: true });
    }

    await jobs.markProcessing(job.id);
    try {
      const result = await adapter.generate(params);
      const asset = await saveAssetBuffer(user.id, result.wav, "MUSIC", "audio/wav", `music_${params.preset}_${Date.now()}.wav`, {
        provider: route.route.providerId,
        model: route.route.modelId,
        preset: result.preset,
        tempo: result.tempo,
        seed: result.seed,
        bars: result.bars,
        durationSec: result.durationSec,
        mode,
      });
      const music = await db.musicAsset.create({
        data: {
          userId: user.id,
          brandId: typeof body.brandId === "string" && body.brandId ? body.brandId : null,
          title: String(body.title ?? "").trim().slice(0, 80) || `${result.preset} · ${result.tempo}bpm`,
          stylePrompt: descriptionUsed,
          source: "GENERATED",
          provider: route.route.providerId,
          assetId: asset.id,
          durationSec: result.durationSec,
          cost: 0,
          metaJson: JSON.stringify({ preset: result.preset, tempo: result.tempo, seed: result.seed, bars: result.bars, mode }),
        },
      });
      await jobs.markCompleted(job.id, { musicId: music.id, assetId: asset.id, url: `/api/assets/${asset.id}/raw` }, asset.id, 0);
      await audit.log({ userId: user.id, action: "music.generate", objectType: "MusicAsset", objectId: music.id, summary: `${mode} ${result.preset} ${result.tempo}bpm ${result.durationSec}s` });
      return ok(
        {
          jobId: job.id,
          musicId: music.id,
          assetId: asset.id,
          url: `/api/assets/${asset.id}/raw`,
          durationSec: result.durationSec,
          bars: result.bars,
          preset: result.preset,
          tempo: result.tempo,
          seed: result.seed,
          provider: route.route.providerId,
        },
        201,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Music generation failed";
      await jobs.markFailed(job.id, message);
      throw new ApiError(502, "GENERATION_FAILED", message, { jobId: job.id, canRetry: true });
    }
  });
}
