// HayDev Synth — built-in algorithmic music composer (MASTER PROMPT §21).
//
// HONESTY: this is REAL audio generation. It renders actual WAV sound locally
// (no external API, no fake success). Scope is intentionally honest:
//   - instrumental only (chords / bass / arpeggio / drums)
//   - NO vocals, NO lyrics rendering — lyrics-capable providers (Suno,
//     ElevenLabs) are BLOCKED_EXTERNAL in this environment and reported as such.
// Deterministic: same (preset, tempo, seed) always renders the same track.

// ---------- Musical primitives ----------

const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

interface PresetDef {
  id: string;
  bpm: number;
  scale: keyof typeof SCALES;
  /** chord progression as scale degrees (0-indexed) */
  progression: number[];
  drums: boolean;
  padGain: number;
  bassGain: number;
  pluckGain: number;
  drumGain: number;
  /** 0 = straight, 0.2 = swung 8ths */
  swing: number;
  padDetune: number;
}

export const SYNTH_PRESETS: PresetDef[] = [
  {
    id: "lofi", bpm: 78, scale: "minor", progression: [0, 5, 3, 4],
    drums: true, padGain: 0.32, bassGain: 0.4, pluckGain: 0.22, drumGain: 0.3, swing: 0.16, padDetune: 6,
  },
  {
    id: "ambient", bpm: 62, scale: "dorian", progression: [0, 3, 4, 2],
    drums: false, padGain: 0.5, bassGain: 0.26, pluckGain: 0.14, drumGain: 0, swing: 0, padDetune: 9,
  },
  {
    id: "corporate", bpm: 108, scale: "major", progression: [0, 4, 5, 3],
    drums: true, padGain: 0.24, bassGain: 0.34, pluckGain: 0.3, drumGain: 0.26, swing: 0, padDetune: 4,
  },
  {
    id: "uplifting", bpm: 124, scale: "major", progression: [0, 3, 4, 4],
    drums: true, padGain: 0.2, bassGain: 0.4, pluckGain: 0.34, drumGain: 0.34, swing: 0, padDetune: 5,
  },
  {
    id: "cinematic", bpm: 68, scale: "minor", progression: [0, 5, 2, 4],
    drums: false, padGain: 0.46, bassGain: 0.42, pluckGain: 0.1, drumGain: 0, swing: 0, padDetune: 7,
  },
];

export function presetById(id: string): PresetDef {
  return SYNTH_PRESETS.find((p) => p.id === id) ?? SYNTH_PRESETS[1];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function scaleChord(scale: number[], degree: number, baseMidi: number): number[] {
  const n = scale.length;
  const root = baseMidi + scale[degree % n] + 12 * Math.floor(degree / n);
  const third = baseMidi + scale[(degree + 2) % n] + 12 * Math.floor((degree + 2) / n) + (degree + 2 >= n ? 12 : 0);
  const fifth = baseMidi + scale[(degree + 4) % n] + 12 * Math.floor((degree + 4) / n) + (degree + 4 >= n ? 12 : 0);
  return [root, third, fifth];
}

// ---------- Envelopes / oscillators ----------

function env(t: number, dur: number, attack: number, release: number): number {
  if (t < 0 || t > dur) return 0;
  if (t < attack) return t / attack;
  const rel = dur - t;
  if (rel < release) return rel / release;
  return 1;
}

function sine(phase: number): number { return Math.sin(2 * Math.PI * phase); }
function triangle(phase: number): number {
  const p = phase - Math.floor(phase);
  return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
}

// ---------- Render engine ----------

export interface RenderOptions {
  preset: string;
  /** requested seconds; quantized to whole bars so LOOP is seamless */
  durationSec: number;
  /** override preset bpm (60–140) */
  tempo?: number;
  /** root note midi (48–60) */
  rootMidi?: number;
  seed?: number;
}

export interface RenderResult {
  wav: Buffer;
  durationSec: number;
  bars: number;
  sampleRate: number;
  preset: string;
  tempo: number;
  seed: number;
}

const SAMPLE_RATE = 44100;

export function renderTrack(opts: RenderOptions): RenderResult {
  const preset = presetById(opts.preset);
  const tempo = Math.min(140, Math.max(60, Math.round(opts.tempo ?? preset.bpm)));
  const rootMidi = Math.min(60, Math.max(48, Math.round(opts.rootMidi ?? 52)));
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rnd = mulberry32(seed);
  const scale = SCALES[preset.scale];

  const beatSec = 60 / tempo;
  const barSec = beatSec * 4;
  const bars = Math.max(2, Math.round(opts.durationSec / barSec));
  const duration = bars * barSec;
  const nSamples = Math.ceil(duration * SAMPLE_RATE);

  const L = new Float32Array(nSamples);
  const R = new Float32Array(nSamples);

  const addStereo = (i: number, v: number, pan: number) => {
    // constant-power pan
    const l = v * Math.cos(((pan + 1) * Math.PI) / 4);
    const r = v * Math.sin(((pan + 1) * Math.PI) / 4);
    L[i] += l; R[i] += r;
  };

  const writeOsc = (
    startSec: number, durSec: number, freq: number, gain: number, pan: number,
    wave: (phase: number) => number, attack: number, release: number, detuneCents = 0,
  ) => {
    const start = Math.floor(startSec * SAMPLE_RATE);
    const len = Math.floor(durSec * SAMPLE_RATE);
    const detune = Math.pow(2, detuneCents / 1200);
    for (let j = 0; j < len; j++) {
      const i = start + j;
      if (i >= nSamples) break;
      const t = j / SAMPLE_RATE;
      const e = env(t, durSec, attack, release);
      if (e <= 0) continue;
      const phase = (freq * (j / SAMPLE_RATE) * detune) % 1;
      addStereo(i, wave(phase) * e * gain, pan);
    }
  };

  const writeNoise = (startSec: number, durSec: number, gain: number, pan: number, bright: number) => {
    const start = Math.floor(startSec * SAMPLE_RATE);
    const len = Math.floor(durSec * SAMPLE_RATE);
    let last = 0;
    for (let j = 0; j < len; j++) {
      const i = start + j;
      if (i >= nSamples) break;
      const t = j / SAMPLE_RATE;
      const e = Math.exp(-t * bright); // brightness = decay speed
      const white = rnd() * 2 - 1;
      // cheap one-pole highpass for hats
      const hp = white - last;
      last = white;
      addStereo(i, hp * e * gain, pan);
    }
  };

  const writeKick = (startSec: number, gain: number) => {
    const start = Math.floor(startSec * SAMPLE_RATE);
    const len = Math.floor(0.28 * SAMPLE_RATE);
    for (let j = 0; j < len; j++) {
      const i = start + j;
      if (i >= nSamples) break;
      const t = j / SAMPLE_RATE;
      const f = 42 + 110 * Math.exp(-t * 30);
      const e = Math.exp(-t * 11);
      addStereo(i, Math.sin(2 * Math.PI * f * t) * e * gain, 0);
    }
  };

  // ---------- layers ----------
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * barSec;
    const degree = preset.progression[bar % preset.progression.length];
    const chord = scaleChord(scale, degree, rootMidi);

    // PAD — chord tones, whole bar, slow attack
    const padDur = barSec + 0.6;
    for (let c = 0; c < chord.length; c++) {
      const f = midiToFreq(chord[c]);
      const pan = c === 0 ? -0.25 : c === 1 ? 0.25 : 0;
      writeOsc(barStart, padDur, f, preset.padGain / 2.4, pan, sine, 0.9, 1.1);
      // shimmer octave, quieter + detuned (width)
      writeOsc(barStart, padDur, midiToFreq(chord[c] + 12), preset.padGain / 5, c % 2 ? 0.5 : -0.5, sine, 1.2, 1.2, preset.padDetune);
      writeOsc(barStart, padDur, midiToFreq(chord[c] + 12), preset.padGain / 5, c % 2 ? -0.5 : 0.5, sine, 1.2, 1.2, -preset.padDetune);
    }

    // BASS — root an octave down, rhythmic pattern
    const bassFreq = midiToFreq(chord[0] - 12);
    const bassPattern = preset.drums ? [0, 1.5, 2, 3] : [0, 2];
    for (const b of bassPattern) {
      writeOsc(barStart + b * beatSec, beatSec * 0.9, bassFreq, preset.bassGain, 0, sine, 0.012, 0.22);
    }

    // PLUCK / ARP — 8th notes with swing
    if (preset.pluckGain > 0) {
      for (let e8 = 0; e8 < 8; e8++) {
        const swingOff = e8 % 2 === 1 ? preset.swing * beatSec * 0.5 : 0;
        const noteIdx = (e8 + bar) % chord.length;
        const oct = e8 % 4 === 2 ? 12 : 0;
        const f = midiToFreq(chord[noteIdx] + 12 + oct);
        const pan = e8 % 2 === 0 ? -0.35 : 0.35;
        writeOsc(barStart + e8 * beatSec * 0.5 + swingOff, 0.34, f, preset.pluckGain, pan, triangle, 0.005, 0.3);
      }
    }

    // DRUMS
    if (preset.drums) {
      // kick: 1 and 3 (uplifting adds syncopation on 3.5)
      writeKick(barStart, preset.drumGain);
      writeKick(barStart + 2 * beatSec, preset.drumGain * 0.92);
      if (preset.id === "uplifting") writeKick(barStart + 3.5 * beatSec, preset.drumGain * 0.7);
      // snare/clap: 2 and 4
      writeNoise(barStart + 1 * beatSec, 0.16, preset.drumGain * 0.7, 0, 22);
      writeNoise(barStart + 3 * beatSec, 0.16, preset.drumGain * 0.7, 0, 22);
      // hats: 8ths, slightly right
      for (let e8 = 0; e8 < 8; e8++) {
        const swingOff = e8 % 2 === 1 ? preset.swing * beatSec * 0.5 : 0;
        const g = e8 % 2 === 0 ? 0.5 : 0.3;
        writeNoise(barStart + e8 * beatSec * 0.5 + swingOff, 0.05, preset.drumGain * g * 0.7, 0.4, 90);
      }
    }
  }

  // ---------- master pass: soft clip + normalize + fades ----------
  let peak = 0;
  for (let i = 0; i < nSamples; i++) {
    L[i] = Math.tanh(L[i] * 1.1);
    R[i] = Math.tanh(R[i] * 1.1);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const norm = peak > 0 ? 0.82 / peak : 1;
  const fadeIn = Math.min(1.2, duration * 0.08);
  const fadeOut = Math.min(2.2, duration * 0.12);
  for (let i = 0; i < nSamples; i++) {
    const t = i / SAMPLE_RATE;
    let g = norm;
    if (t < fadeIn) g *= t / fadeIn;
    const rel = duration - t;
    if (rel < fadeOut) g *= Math.max(0, rel / fadeOut);
    L[i] *= g; R[i] *= g;
  }

  return { wav: encodeWav16Stereo(L, R, SAMPLE_RATE), durationSec: duration, bars, sampleRate: SAMPLE_RATE, preset: preset.id, tempo, seed };
}

// ---------- WAV encoding (16-bit PCM stereo) ----------

export function encodeWav16Stereo(L: Float32Array, R: Float32Array, sampleRate: number): Buffer {
  const n = Math.min(L.length, R.length);
  const dataSize = n * 4; // 2 ch × 2 bytes
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // stereo
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 4, 28); // byte rate
  buf.writeUInt16LE(4, 32); // block align
  buf.writeUInt16LE(16, 34); // bits
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, L[i]));
    const r = Math.max(-1, Math.min(1, R[i]));
    buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(r * 32767), 44 + i * 4 + 2);
  }
  return buf;
}
