// The scene's audio track in the browser: decoding, waveform peaks, playback in step with the playhead,
// the mixdown that goes into the exported video, and a rough beat finder the agent can ask for.
// The track itself lives in the doc (doc.audio: file, offset, in, out, volume, muted, length), shared by
// every shot on the action-time axis: shot time t plays the audio at action time timeline.start + t.
// The file is served from the scene folder's audio/.

import { store } from './store.js';
import { shotList } from '/core/doc.js';

const RATE = 48000;      // decode and mix at this sample rate
const PEAK_RATE = 200;   // waveform buckets per second of audio

let ctx = null;          // realtime AudioContext, made on first play (browsers want a user gesture)
let cur = { file: null, buffer: null, peaks: null, loading: null, error: null, grid: null };
let voice = null;        // what is playing: { srcs, gain, at (ctx time), t (active shot's time at `at`), shot }
const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());

const track = () => store.doc?.audio || null;
const playable = (a) => a && !a.muted && cur.buffer && cur.file === a.file;
const shotStart = () => store.doc?.timeline.start || 0;

/** The part of the file that is heard: [inT, outT] seconds into it (the trim), given its length. */
export function trimOf(a, len = a?.length) {
  const inT = Math.max(0, a?.in || 0);
  const outT = Math.max(inT, Math.min(len ?? Infinity, a?.out ?? Infinity));
  return { inT, outT };
}

/** Max |sample| per 1/PEAK_RATE s, all channels mixed. */
function computePeaks(buf) {
  const n = Math.ceil(buf.duration * PEAK_RATE), step = buf.sampleRate / PEAK_RATE;
  const peaks = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      let m = peaks[i];
      for (let j = Math.floor(i * step), e = Math.min(d.length, Math.floor((i + 1) * step)); j < e; j++) { const v = Math.abs(d[j]); if (v > m) m = v; }
      peaks[i] = m;
    }
  }
  let max = 0; for (const v of peaks) if (v > max) max = v;
  if (max > 0) for (let i = 0; i < n; i++) peaks[i] /= max; // normalise so quiet tracks still read
  return peaks;
}

/** Onset envelope: positive change in log energy per hop of 512 samples, all channels mixed. */
function onsetEnvelope(buf) {
  const hop = 512, fr = buf.sampleRate / hop, n = Math.floor(buf.length / hop);
  const env = new Float32Array(n);
  const chans = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c));
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (const d of chans) for (let j = i * hop, k = j + hop; j < k; j++) e += d[j] * d[j];
    const l = Math.log1p(1000 * e / hop);
    env[i] = Math.max(0, l - prev); prev = l;
  }
  let mean = 0; for (const v of env) mean += v; mean /= n || 1;
  let sd = 0; for (const v of env) sd += (v - mean) ** 2; sd = Math.sqrt(sd / (n || 1));
  return { env, fr, n, mean, sd };
}

/**
 * The file's beat grid, in seconds of the file: tempo from the envelope's autocorrelation (70–180 bpm,
 * leaning toward ~120), the period refined to a fraction of a frame so long tracks don't drift, the phase
 * that lands on the most onset energy, and which beat in four starts a bar. One steady tempo per file.
 */
function beatGrid(buf, E = onsetEnvelope(buf)) {
  const { env, fr, n } = E;
  let best = 0, bestLag = 0;
  for (let lag = Math.round(fr * 60 / 180); lag <= Math.round(fr * 60 / 70); lag++) {
    let s = 0; for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
    const bpm = 60 * fr / lag, w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    if (s * w > best) { best = s * w; bestLag = lag; }
  }
  if (!bestLag || !(best > 0)) return null;
  // a little slack either side of each onset, so the refined grid isn't thrown by a frame of jitter
  const sm = new Float32Array(n);
  for (let i = 0; i < n; i++) sm[i] = Math.max(env[i], 0.5 * (env[i - 1] || 0), 0.5 * (env[i + 1] || 0));
  const fit = (P) => { // best phase for period P (frames): [score, phase]
    let bs = -1, bp = 0;
    for (let p = 0; p < P; p += 0.5) { let s = 0; for (let x = p; x < n; x += P) s += sm[Math.round(x)] || 0; if (s > bs) { bs = s; bp = p; } }
    return [bs, bp];
  };
  let period = bestLag, [score, phase] = fit(bestLag);
  for (let P = bestLag - 1; P <= bestLag + 1 + 1e-9; P += 0.02) { const [s, p] = fit(P); if (s > score) { score = s; period = P; phase = p; } }
  const times = [];
  for (let x = phase; x < n; x += period) times.push(x / fr);
  let bar = 0, bs = -1; // which beat (mod 4) starts a bar: the one with the most energy on it
  for (let b = 0; b < 4; b++) { let s = 0; for (let k = b; k < times.length; k += 4) s += sm[Math.round(times[k] * fr)] || 0; if (s > bs) { bs = s; bar = b; } }
  return { tempo: Math.round(600 * fr / period) / 10, beat: period / fr, times, bar };
}

async function load(a) {
  if (!a) {
    if (cur.file) { cur = { file: null, buffer: null, peaks: null, loading: null, error: null, grid: null }; stopVoice(); changed(); }
    return null;
  }
  if (cur.file === a.file) return cur.loading;
  stopVoice();
  const file = a.file;
  cur = { file, buffer: null, peaks: null, loading: null, error: null, grid: null };
  cur.loading = (async () => {
    try {
      const res = await fetch(`/audio/${encodeURIComponent(file)}`);
      if (!res.ok) throw new Error(`audio file ${file} not found in the scene's audio/ folder`);
      const buf = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await res.arrayBuffer());
      if (cur.file !== file) return null; // replaced while decoding
      cur.buffer = buf; cur.peaks = computePeaks(buf);
      const len = Math.round(buf.duration * 1000) / 1000;
      const t = track();
      // record the length in the doc (not an undo step) so the agent and "fit" can use it
      if (t?.file === file && Math.abs((t.length || 0) - len) > 0.002) store.op({ op: 'audio', length: len }, 'read audio length', { amend: true }).catch(() => {});
      if (store.state.playing) play(store.state.time);
      return buf;
    } catch (e) {
      if (cur.file === file) cur.error = e.message || String(e);
      store.emit('error', `Could not read the audio: ${cur.error}`);
      return null;
    } finally { changed(); }
  })();
  changed();
  return cur.loading;
}

function stopVoice() {
  for (const src of voice?.srcs || []) { try { src.stop(); } catch {} src.disconnect(); }
  voice?.gain?.disconnect();
  voice = null;
}

/**
 * What plays from shot time t of the active shot, as spans of the action back to back: the rest of this shot,
 * then (Play all) the shots after it, wrapping round with loop, or this shot again with loop alone. Scheduled
 * up front so the sound runs straight through the cuts instead of restarting at each one.
 */
function plan(t) {
  const list = shotList(store.doc), i = Math.max(0, list.findIndex((s) => s.active));
  const all = !!store.state.playAll && list.length > 1, loop = !!store.state.loop;
  const out = [];
  for (let k = i, total = 0; out.length < 200 && total < 1800;) {
    const tl = list[k].timeline, D = tl.duration, from = out.length ? 0 : Math.min(Math.max(0, t), D);
    if (D - from > 1e-6) out.push({ a0: (tl.start || 0) + from, len: D - from });
    total += D - from;
    if (all) { if (++k >= list.length) { if (!loop) break; k = 0; } } else if (!loop) break;
    if (!(D > 0)) break;
  }
  return out;
}

/** Start the track so that shot time t plays now, on through the cuts that follow. */
function play(t) {
  stopVoice();
  const a = track();
  if (!playable(a)) return;
  ctx ??= new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const at = ctx.currentTime + 0.02;
  const gain = ctx.createGain();
  gain.gain.value = a.volume ?? 1;
  gain.connect(ctx.destination);
  voice = { srcs: [], gain, at, t, shot: store.doc.shot };
  const { inT, outT } = trimOf(a, cur.buffer.duration);
  // each span's audible part of the file, and when it starts; spans that carry straight on in the file merge
  const runs = [];
  let when = at;
  for (const p of plan(t)) {
    const pos = p.a0 - a.offset, from = Math.max(pos, inT), to = Math.min(pos + p.len, outT);
    if (to - from > 1e-4) {
      const w = when + (from - pos), last = runs[runs.length - 1];
      if (last && Math.abs(last.from + (w - last.when) - from) < 1e-4 && Math.abs(last.to - from) < 1e-4) last.to = to;
      else runs.push({ when: w, from, to });
    }
    when += p.len;
  }
  for (const r of runs) {
    const src = ctx.createBufferSource();
    src.buffer = cur.buffer;
    src.connect(gain);
    src.start(r.when, r.from, r.to - r.from);
    voice.srcs.push(src);
  }
}

/** Playback crossed a cut into `shot` (or looped): the sound carries on, its clock now counts from that shot's start. */
function cut(D, shot = store.doc?.shot) {
  if (!voice) return;
  voice.t -= D;
  voice.shot = shot;
}

export const audio = {
  get file() { return cur.file; },
  get buffer() { return cur.buffer; },
  get peaks() { return cur.peaks; },
  get loading() { return !!cur.file && !cur.buffer && !cur.error; },
  get error() { return cur.error; },
  /** True once the beat grid is found, false if the file has no steady beat, null before it is worked out. */
  get gridFound() { return cur.grid === false ? false : cur.grid ? true : null; },
  PEAK_RATE, RATE,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  load: () => load(track()),

  /**
   * The file's beat grid ({ tempo, beat, times: seconds into the file, bar: which beat in 4 starts a bar }),
   * or null while it is decoding or if no steady beat was found. Worked out once per file, after a frame,
   * so turning beats on doesn't stall the draw that asked; listeners hear when it is ready.
   */
  grid() {
    if (!cur.buffer) return null;
    if (cur.grid === null && !cur.gridPending) {
      const file = cur.file;
      cur.gridPending = setTimeout(() => {
        if (cur.file !== file) return;
        cur.grid = beatGrid(cur.buffer) || false; cur.gridPending = null; changed();
      }, 0);
    }
    return cur.grid || null;
  },
  play, stop: stopVoice, cut,

  /** Timeline time from the audio clock while it plays (so picture and sound stay locked), else null. */
  now() {
    if (!voice || !ctx || ctx.state !== 'running') return null;
    return voice.t + Math.max(0, ctx.currentTime - voice.at);
  },

  /** Keep playback in step with the store: call once at startup. */
  attach() {
    let sig = '';
    store.on('state', (c) => {
      if (!c.playing && !c.playAll && !c.loop) return; // Play all and loop change what comes after the cut
      if (store.state.playing) play(store.state.time); else if (c.playing) stopVoice();
    });
    store.on('doc', () => {
      const a = track();
      load(a);
      const shots = shotList(store.doc).map((s) => [s.id, s.timeline.start || 0, s.timeline.duration]);
      const s = a ? JSON.stringify([a.file, a.offset, a.in, a.out, a.volume, a.muted, shots]) : '';
      // a switch the playing sound already crossed into (Play all) keeps going; any other switch restarts it
      const moved = voice && voice.shot !== store.doc.shot;
      if (s !== sig || moved) { sig = s; if (store.state.playing) play(store.state.time); changed(); }
    });
  },

  /**
   * The track as it sounds over [start, start + duration] of the action, at RATE, for the export (a shot's
   * part is its timeline.start and duration). Null if there is no track or it is muted.
   */
  async mixdown(start, duration, { channels } = {}) {
    const a = track();
    if (!a || a.muted) return null;
    await load(a);
    const buf = cur.buffer;
    if (!buf) return null;
    const ch = channels || Math.min(2, buf.numberOfChannels) || 1;
    const off = new OfflineAudioContext(ch, Math.max(1, Math.ceil(duration * RATE)), RATE);
    const p0 = start - a.offset; // where in the file the part starts
    const { inT, outT } = trimOf(a, buf.duration);
    const from = Math.max(p0, inT);
    if (from < outT - 1e-4 && from - p0 < duration) {
      const src = off.createBufferSource(), gain = off.createGain();
      src.buffer = buf; gain.gain.value = a.volume ?? 1;
      src.connect(gain).connect(off.destination);
      src.start(from - p0, from, outT - from);
    }
    return off.startRendering();
  },

  /**
   * A rough beat finder: an energy-flux onset envelope, tempo from its autocorrelation (70–180 bpm),
   * and the beat grid with the best phase. Times are in the active shot's time (offset and its start
   * applied), inside the shot and the trimmed part of the file.
   */
  async analyze() {
    const a = track();
    if (!a) throw new Error('no audio on the timeline');
    await load(a);
    if (!cur.buffer) throw new Error(cur.error || 'the audio could not be decoded');
    const buf = cur.buffer, E = onsetEnvelope(buf), { env, fr, n, mean, sd } = E;
    if (cur.grid == null) cur.grid = beatGrid(buf, E) || false;
    const g = cur.grid || null;
    const st = shotStart(), { inT, outT } = trimOf(a, buf.duration);
    const toT = (i) => Math.round((i / fr + a.offset - st) * 1000) / 1000;
    const D = store.doc.timeline.duration;
    const inShot = (t) => t >= 0 && t <= D + 1e-6 && t + st - a.offset >= inT - 1e-6 && t + st - a.offset <= outT + 1e-6;
    const beats = g ? g.times.map((t) => toT(t * fr)).filter(inShot) : [];
    const tempo = g?.tempo ?? null, beat = g ? Math.round(1000 * g.beat) / 1000 : null;
    // strong onsets: local maxima well above the mean, at least 0.12 s apart, strongest 48 in the shot
    const gap = Math.round(0.12 * fr), thr = mean + 1.5 * sd, picks = [];
    for (let i = 1; i < n - 1; i++) {
      if (env[i] < thr || env[i] < env[i - 1] || env[i] < env[i + 1]) continue;
      if (picks.length && i - picks[picks.length - 1].i < gap) { if (env[i] > picks[picks.length - 1].v) picks[picks.length - 1] = { i, v: env[i] }; continue; }
      picks.push({ i, v: env[i] });
    }
    const onsets = picks.filter((p) => inShot(toT(p.i))).sort((x, y) => y.v - x.v).slice(0, 48).map((p) => toT(p.i)).sort((x, y) => x - y);
    return { file: a.file, length: Math.round(buf.duration * 1000) / 1000, offset: a.offset, in: a.in || 0, out: a.out ?? null, shotStart: st, tempo, beat, beats, onsets };
  },
};
