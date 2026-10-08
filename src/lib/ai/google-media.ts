import 'server-only';
export const GOOGLE_IMAGE_MODEL = 'gemini-3.1-flash-lite-image';
export const GOOGLE_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
export const GOOGLE_VIDEO_MODEL = 'veo-3.1-lite-generate-preview';
export const GOOGLE_VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda', 'Orus', 'Zephyr'];
const BASE = 'https://generativelanguage.googleapis.com/v1beta/';
function key() { const k = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY; if (!k) throw new Error('Google API key is not configured'); return k; }
export async function googleRequest(endpoint: string, body?: unknown) {
  let res: Response;
  try { res = await fetch(BASE + endpoint, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000), cache: 'no-store' }); }
  catch { throw new Error('Google connection timed out; billing status is unknown. No automatic retry was sent.'); }
  if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(`Google HTTP ${res.status}: ${String(data.error?.message || 'Provider rejected request').slice(0, 400)}`); }
  return res.json();
}
export async function googleImage(opts: { prompt: string; aspectRatio?: string; referenceImageBase64?: string; referenceMimeType?: string }) {
  const parts: unknown[] = [{ text: opts.prompt }];
  if (opts.referenceImageBase64) parts.push({ inlineData: { mimeType: opts.referenceMimeType || 'image/png', data: opts.referenceImageBase64 } });
  const d = await googleRequest(`models/${GOOGLE_IMAGE_MODEL}:generateContent`, { contents: [{ parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: opts.aspectRatio || '1:1', imageSize: '1K' } } });
  const p = d.candidates?.[0]?.content?.parts?.find((x: { inlineData?: { mimeType?: string } }) => x.inlineData?.mimeType?.startsWith('image/'));
  if (!p?.inlineData?.data) throw new Error('Google returned no image; check safety filters.');
  return { base64: p.inlineData.data as string, mimeType: p.inlineData.mimeType as string };
}
function wav(pcm: Buffer, rate: number) {
  const h = Buffer.alloc(44); h.write('RIFF'); h.writeUInt32LE(pcm.length + 36, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]);
}
export async function googleTts(opts: { text: string; voice?: string; speed?: number }) {
  const voice = GOOGLE_VOICES.includes(opts.voice || '') ? opts.voice! : 'Kore';
  const text = `Read naturally at ${Math.max(0.5, Math.min(2, opts.speed || 1))}x pace:\n${opts.text}`;
  const d = await googleRequest(`models/${GOOGLE_TTS_MODEL}:generateContent`, { contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } });
  const p = d.candidates?.[0]?.content?.parts?.find((x: { inlineData?: { mimeType?: string } }) => x.inlineData?.mimeType?.startsWith('audio/'));
  if (!p?.inlineData?.data) throw new Error('Google returned no audio.');
  let buf = Buffer.from(p.inlineData.data, 'base64'); const mime = p.inlineData.mimeType || '';
  if (mime.includes('L16') || mime.includes('pcm')) buf = wav(buf, Number(mime.match(/rate=(\d+)/)?.[1] || 24000));
  return { base64: buf.toString('base64'), mimeType: mime.includes('L16') || mime.includes('pcm') ? 'audio/wav' : mime };
}
export async function googleVideoSubmit(opts: { prompt: string; aspectRatio?: string; durationSec?: number }) {
  if (!['16:9', '9:16'].includes(opts.aspectRatio || '9:16')) throw new Error('Veo Lite supports only 16:9 and 9:16.');
  if (![4, 6, 8].includes(opts.durationSec || 4)) throw new Error('Veo Lite accepts clips of 4, 6 or 8 seconds.');
  const d = await googleRequest(`models/${GOOGLE_VIDEO_MODEL}:predictLongRunning`, { instances: [{ prompt: opts.prompt }], parameters: { aspectRatio: opts.aspectRatio || '9:16', durationSeconds: opts.durationSec || 4, resolution: '720p', sampleCount: 1 } });
  if (!/^models\/[\w.-]+\/operations\/[\w.-]+$/.test(d.name || '')) throw new Error('Google returned an invalid operation name.');
  return { providerJobId: `google:${d.name}` };
}
export async function googleVideoPoll(id: string): Promise<{ status: 'PROCESSING' | 'SUCCESS' | 'FAIL'; outputUrl?: string; error?: string }> {
  const op = id.replace(/^google:/, ''); if (!/^models\/[\w.-]+\/operations\/[\w.-]+$/.test(op)) throw new Error('Invalid Google operation');
  const d = await googleRequest(op); if (!d.done) return { status: 'PROCESSING' };
  if (d.error) return { status: 'FAIL', error: String(d.error.message || 'Video generation failed') };
  const uri = d.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) return { status: 'FAIL', error: 'Google returned no video; check safety filters.' };
  return { status: 'SUCCESS', outputUrl: uri };
}
export async function googleVideoDownload(url: string) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'generativelanguage.googleapis.com') throw new Error('Unexpected Google video download host');
  let res = await fetch(u, { headers: { 'x-goog-api-key': key() }, redirect: 'manual', signal: AbortSignal.timeout(60000) });
  for (let i = 0; i < 3 && res.status >= 300 && res.status < 400; i++) {
    const target = new URL(res.headers.get('location') || '', res.url || u.href);
    if (target.protocol !== 'https:' || !(target.hostname === 'generativelanguage.googleapis.com' || target.hostname === 'storage.googleapis.com' || target.hostname.endsWith('.googleusercontent.com'))) throw new Error('Unexpected Google redirect host');
    // Credentials are only sent to the Gemini API, never to signed asset hosts.
    res = await fetch(target, { headers: target.hostname === u.hostname ? { 'x-goog-api-key': key() } : {}, redirect: 'manual', signal: AbortSignal.timeout(60000) });
  }
  if (!res.ok) throw new Error(`Google video download HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
