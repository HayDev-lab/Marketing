import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handle, ApiError, requireUser, fail } from "@/lib/api";
import { getCurrentUser, getUserFromToken } from "@/lib/auth";
import { audit } from "@/lib/ledger";

// §23 Subtitles manager — deterministic cue generation from scene narrations,
// structured editing, SRT/VTT sidecar export, burn-in hand-off to the assembler.
//
// Timing basis (honest): only READY scenes enter the track — the final assembly
// concat consists of exactly those clips, so cue offsets == real video offsets.
// Per-cue timing is "measured" when the scene carries TTS audio (voiceDurationSec
// from ffprobe) and "estimated" otherwise (chars/15 per second, clamped).

const MAX_CUES = 30;
const CUE_MAX_CHARS = 84;
const CHARS_PER_SECOND = 15;

interface Cue {
  index: number;
  start: number;
  end: number;
  text: string;
  timing: "measured" | "estimated" | "edited";
}

/** Split narration into subtitle-sized chunks: sentences first, then hard wraps. */
function splitCueText(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?…։,;:])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= CUE_MAX_CHARS) {
      chunks.push(sentence);
      continue;
    }
    // long sentence — wrap on word boundaries
    let current = "";
    for (const word of sentence.split(/\s+/)) {
      if (current && (current + " " + word).length > CUE_MAX_CHARS) {
        chunks.push(current);
        current = word;
      } else {
        current = current ? current + " " + word : word;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks.slice(0, MAX_CUES);
}

function clamp01(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function buildCues(
  ready: { narration: string | null; durationSec: number; voiceDurationSec: number | null }[]
): { cues: Cue[]; estimatedCount: number; measuredCount: number; skippedScenes: number } {
  const cues: Cue[] = [];
  let offset = 0;
  let estimatedCount = 0;
  let measuredCount = 0;
  let skippedScenes = 0;
  let index = 1;
  for (const scene of ready) {
    const text = (scene.narration ?? "").trim();
    if (!text) {
      skippedScenes += 1;
      offset += scene.durationSec;
      continue;
    }
    const dur = Math.max(1, scene.durationSec);
    // measured spoken length (capped at clip + 1.5s honest overflow) vs estimate
    const estimated = clamp01(text.length / CHARS_PER_SECOND, 1.2, dur);
    const measured = scene.voiceDurationSec != null ? clamp01(scene.voiceDurationSec, 0.8, dur + 1.5) : null;
    const speakDur = measured ?? estimated;
    const lines = splitCueText(text);
    const totalChars = lines.reduce((s, l) => s + l.length, 0) || 1;
    let inner = 0;
    for (const line of lines) {
      const share = line.length / totalChars;
      const cueDur = share * speakDur;
      const start = Number((offset + inner).toFixed(2));
      const end = Number(Math.min(offset + inner + cueDur, offset + dur + (measured && measured > dur ? 1.5 : 0)).toFixed(2));
      cues.push({ index: index++, start, end, text: line, timing: measured ? "measured" : "estimated" });
      if (measured) measuredCount += 1;
      else estimatedCount += 1;
      inner += cueDur;
    }
    offset += dur;
  }
  return { cues, estimatedCount, measuredCount, skippedScenes };
}

function pad(n: number, size = 2): string {
  return String(Math.floor(n)).padStart(size, "0");
}

function fmtSrtTime(sec: number): string {
  const s = Math.max(0, sec);
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)},${pad((s % 1) * 1000, 3)}`;
}

function fmtVttTime(sec: number): string {
  const s = Math.max(0, sec);
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}.${pad((s % 1) * 1000, 3)}`;
}

function cuesToSrt(cues: Cue[]): string {
  return (
    cues
      .map((c, i) => `${i + 1}\n${fmtSrtTime(c.start)} --> ${fmtSrtTime(c.end)}\n${c.text}`)
      .join("\n\n") + "\n"
  );
}

function cuesToVtt(cues: Cue[]): string {
  return (
    "WEBVTT\n\n" +
    cues.map((c, i) => `${i + 1}\n${fmtVttTime(c.start)} --> ${fmtVttTime(c.end)}\n${c.text}`).join("\n\n") +
    "\n"
  );
}

function parseCues(raw: string | null | undefined): Cue[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as Cue[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// GET /api/video-projects/subtitles?projectId=...  → track list for the project
// GET /api/video-projects/subtitles?id=...&format=srt|vtt → sidecar download (auth: cookie → header → ?token=)
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    // raw file download — <a href> cannot send headers, so allow the ?token= fallback
    const user = (await getCurrentUser()) ?? (await getUserFromToken(url.searchParams.get("token")));
    if (!user) return fail(401, "UNAUTHORIZED", "Authentication required");
    const track = await db.subtitleTrack.findFirst({ where: { id, userId: user.id } });
    if (!track) return fail(404, "NOT_FOUND", "Subtitle track not found");
    const format = (url.searchParams.get("format") ?? track.format ?? "SRT").toUpperCase();
    const cues = parseCues(track.cuesJson);
    const body = format === "VTT" ? cuesToVtt(cues) : cuesToSrt(cues);
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="subtitles_${track.language}.${format.toLowerCase()}"`,
      },
    });
  }
  return handle(async () => {
    const user = await requireUser();
    const projectId = url.searchParams.get("projectId") ?? "";
    if (!projectId) throw new ApiError(400, "VALIDATION", "projectId or id is required");
    const project = await db.videoProject.findFirst({ where: { id: projectId, userId: user.id } });
    if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");
    const tracks = await db.subtitleTrack.findMany({
      where: { projectId, userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return ok(
      tracks.map((t) => {
        const cues = parseCues(t.cuesJson);
        return {
          id: t.id,
          language: t.language,
          format: t.format,
          cueCount: cues.length,
          measured: cues.filter((c) => c.timing === "measured").length,
          estimated: cues.filter((c) => c.timing === "estimated").length,
          createdAt: t.createdAt,
        };
      })
    );
  });
}

// POST /api/video-projects/subtitles — generate a track from READY scenes (deterministic, no LLM)
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const projectId = String(body.projectId ?? "");
    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: { scenes: { orderBy: { order: "asc" } } },
    });
    if (!project || project.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Project not found");
    const ready = project.scenes.filter((s) => s.status === "COMPLETED" && s.assetId);
    if (ready.length === 0) {
      throw new ApiError(409, "NO_SCENES", "No generated scenes — generate at least one scene before making subtitles");
    }
    const speakable = ready.filter((s) => (s.narration ?? "").trim());
    if (speakable.length === 0) {
      throw new ApiError(409, "NO_SUBTITLE_TEXT", "Ready scenes have no narration text — write narration lines first");
    }
    const { cues, estimatedCount, measuredCount, skippedScenes } = buildCues(
      ready.map((s) => ({ narration: s.narration, durationSec: s.durationSec, voiceDurationSec: s.voiceDurationSec }))
    );
    const language = ["hy", "ru", "en"].includes(body.language) ? String(body.language) : project.language;
    // keep the track list tidy: cap at 8 tracks per project (oldest auto-pruned)
    const existing = await db.subtitleTrack.findMany({
      where: { projectId, userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    if (existing.length >= 8) {
      await db.subtitleTrack.deleteMany({
        where: { id: { in: existing.slice(0, existing.length - 7).map((t) => t.id) } },
      });
    }
    const track = await db.subtitleTrack.create({
      data: {
        userId: user.id,
        projectId,
        language,
        format: "SRT",
        content: cuesToSrt(cues),
        cuesJson: JSON.stringify(cues),
        styleJson: JSON.stringify({ font: "Noto Sans Armenian", fontSize: 15, marginV: 36, outline: 1 }),
      },
    });
    await audit.log({
      userId: user.id,
      action: "subtitles.generated",
      objectType: "SubtitleTrack",
      objectId: track.id,
      summary: `${cues.length} cues (${measuredCount} measured / ${estimatedCount} estimated) for ${ready.length} scenes${skippedScenes ? `, ${skippedScenes} silent scenes skipped` : ""}`,
    });
    return ok({ id: track.id, language: track.language, cueCount: cues.length, measured: measuredCount, estimated: estimatedCount, skippedScenes, cues }, 201);
  });
}

// PATCH /api/video-projects/subtitles — edit cues (text/timing) or style; content is rebuilt from cues
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json();
    const trackId = String(body.trackId ?? "");
    const track = await db.subtitleTrack.findFirst({ where: { id: trackId, userId: user.id } });
    if (!track) throw new ApiError(404, "NOT_FOUND", "Subtitle track not found");
    const current = parseCues(track.cuesJson);

    if (Array.isArray(body.cues)) {
      const incoming = body.cues as { start?: unknown; end?: unknown; text?: unknown }[];
      if (incoming.length === 0 || incoming.length > MAX_CUES) {
        throw new ApiError(400, "VALIDATION", `cues must contain 1..${MAX_CUES} entries`);
      }
      const next: Cue[] = [];
      for (const c of incoming) {
        const text = String(c.text ?? "").trim().slice(0, 300);
        if (!text) throw new ApiError(400, "VALIDATION", "Cue text cannot be empty");
        const start = Math.max(0, Number(c.start));
        const end = Math.max(start + 0.3, Number(c.end));
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          throw new ApiError(400, "VALIDATION", "Cue start/end must be numbers");
        }
        const edited = current[next.length];
        next.push({
          index: next.length + 1,
          start: Number(start.toFixed(2)),
          end: Number(end.toFixed(2)),
          text,
          timing: edited?.timing === "measured" || edited?.timing === "estimated" ? "edited" : (edited?.timing ?? "edited"),
        });
      }
      await db.subtitleTrack.update({
        where: { id: track.id },
        data: { cuesJson: JSON.stringify(next), content: cuesToSrt(next) },
      });
      await audit.log({
        userId: user.id,
        action: "subtitles.edited",
        objectType: "SubtitleTrack",
        objectId: track.id,
        summary: `${next.length} cues edited`,
      });
      return ok({ id: track.id, cues: next });
    }

    if (body.style && typeof body.style === "object") {
      const prev = (() => {
        try { return track.styleJson ? (JSON.parse(track.styleJson) as Record<string, unknown>) : {}; } catch { return {}; }
      })();
      const style = { ...prev, ...body.style };
      await db.subtitleTrack.update({ where: { id: track.id }, data: { styleJson: JSON.stringify(style) } });
      await audit.log({ userId: user.id, action: "subtitles.style", objectType: "SubtitleTrack", objectId: track.id });
      return ok({ id: track.id, style });
    }

    throw new ApiError(400, "BAD_ACTION", "Nothing to update — pass cues or style");
  });
}

// DELETE /api/video-projects/subtitles?id=...
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const track = await db.subtitleTrack.findFirst({ where: { id, userId: user.id } });
    if (!track) throw new ApiError(404, "NOT_FOUND", "Subtitle track not found");
    await db.subtitleTrack.delete({ where: { id: track.id } });
    await audit.log({ userId: user.id, action: "subtitles.deleted", objectType: "SubtitleTrack", objectId: track.id });
    return ok({ deleted: true });
  });
}
