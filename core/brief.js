// A shot's camera work in words and numbers: what the camera does between each pair of keys, how each
// framing reads (size, height, side, lens), which objects move and which part of the audio plays.
// Read-only: built from the scene doc for agents that have to describe a shot, e.g. in a prompt for a
// video model that follows the blockout export. `canvas brief` prints it.

import { sampleObject, remapTime, isCut, easeName, fovToLens } from './curves.js';
import { findShot, shotList, PERSON_HEIGHT } from './doc.js';

const DEG = 180 / Math.PI;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;
const wrap = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180; // to -180..180
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21', '3:2', '2:3'];
/** A frame size as a ratio: exact ("683:384") and the nearest common one ("16:9"). */
export function ratioOf(width, height) {
  const g = gcd(Math.round(width), Math.round(height)) || 1;
  const want = width / height;
  const near = RATIOS.map((r) => { const [a, b] = r.split(':').map(Number); return { r, d: Math.abs(Math.log(a / b / want)) }; }).sort((x, y) => x.d - y.d)[0].r;
  return { exact: `${Math.round(width) / g}:${Math.round(height) / g}`, nearest: near };
}

/** Shot time (seconds of the video) at which the camera reaches key time k, undoing the shot's speed curve. */
function unmapTime(timeline, k) {
  const dur = timeline.duration;
  if ((timeline.speed ?? 'linear') === 'linear') return Math.min(Math.max(k, 0), dur);
  if (k <= 0) return 0;
  if (k >= dur) return dur;
  let lo = 0, hi = dur;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (remapTime(timeline, mid) < k) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

function objectAt(o, timeline, t) {
  const at = sampleObject(o, timeline, t);
  const p = o.params || {};
  const h = (p.h ?? (o.type === 'person' ? PERSON_HEIGHT[p.body || 'male'] : null) ?? (p.r != null ? p.r * 2 : 1)) * (at.scale?.[1] ?? 1);
  return { position: at.position, rotation: at.rotation, height: h, centre: [at.position[0], at.position[1] + h * (o.type === 'person' ? 0.75 : 0.5), at.position[2]] };
}

// What the camera is aimed at: the object whose middle is closest to the aim point (people win ties).
function subjectAt(doc, timeline, pose, t) {
  let best = null;
  for (const o of doc.objects || []) {
    const at = objectAt(o, timeline, t);
    const mid = [at.position[0], at.position[1] + at.height / 2, at.position[2]];
    const d = len(sub(pose.target, mid));
    const reach = Math.max(1, at.height * 0.75);
    if (d > reach) continue;
    const score = d / reach - (o.type === 'person' ? 0.5 : 0);
    if (!best || score < best.score) best = { score, o, at };
  }
  return best && { id: best.o.id, type: best.o.type, note: best.o.note || undefined, ...best.at };
}

const SIZES = [[0.35, 'extreme close-up'], [0.6, 'close-up'], [0.9, 'medium close-up'], [1.35, 'medium'], [1.9, 'medium-wide'], [3, 'full shot'], [6, 'wide'], [Infinity, 'extreme wide']];
const SIDES = [[22.5, 'front'], [67.5, 'three-quarter front'], [112.5, 'side'], [157.5, 'three-quarter rear'], [181, 'behind']];

/** How one camera pose reads: shot size, camera height and angle, which side of the subject, lens. */
export function describeFraming(doc, timeline, pose, t) {
  const d = sub(pose.target, pose.position);
  const pitch = Math.atan2(d[1], Math.hypot(d[0], d[2])) * DEG;
  const subject = subjectAt(doc, timeline, pose, t);
  const dist = len(subject ? sub(subject.centre, pose.position) : d);
  const frame = 2 * dist * Math.tan((pose.fov / 2) / DEG); // metres of height the frame shows at the subject
  const y = pose.position[1];
  const out = {
    lens: Math.round(fovToLens(pose.fov)),
    distance: r2(dist),
    frameHeight: r2(frame),
    cameraHeight: r2(y),
    height: pitch < -65 ? 'top-down' : y < 0.5 ? 'ground level' : y < 1.2 ? 'low' : y < 1.95 ? 'eye level' : y < 3.5 ? 'high' : 'very high',
    angle: pitch < -12 ? `looking down ${Math.round(-pitch)}°` : pitch > 12 ? `looking up ${Math.round(pitch)}°` : 'level',
    pitch: r1(pitch),
  };
  if (pose.roll) out.roll = r1(pose.roll);
  if (subject) {
    out.subject = subject.id;
    if (subject.type === 'person') {
      out.size = SIZES.find(([max]) => frame / subject.height < max)[1];
      const facing = subject.rotation[1]; // people face +z, turned round Y
      const bearing = Math.atan2(pose.position[0] - subject.position[0], pose.position[2] - subject.position[2]) * DEG;
      const rel = wrap(bearing - facing);
      const side = SIDES.find(([max]) => Math.abs(rel) < max)[1];
      out.side = side === 'front' || side === 'behind' ? side : `${side}, their ${rel > 0 ? 'left' : 'right'}`;
    }
  }
  const bits = [out.size || `frame ${out.frameHeight} m tall${subject ? ` at ${subject.id}` : ' at the aim'}`];
  if (out.size) bits[0] += ` of ${subject.id}`;
  if (out.side) bits.push(out.side);
  bits.push(`${out.height} (${out.cameraHeight} m)${out.angle === 'level' ? '' : `, ${out.angle}`}`, `${out.distance} m away`, `${out.lens}mm`);
  if (out.roll) bits.push(`rolled ${Math.abs(out.roll)}° ${out.roll > 0 ? 'clockwise' : 'anticlockwise'}`);
  out.text = bits.join(' · ');
  return out;
}

const poseOf = (k) => ({ position: k.position, target: k.target, fov: k.fov ?? 40, roll: k.roll ?? 0 });
const aimOf = (p) => { const d = sub(p.target, p.position); return { yaw: Math.atan2(d[0], d[2]) * DEG, pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])) * DEG, dist: len(d) }; };
const MOVE_LABEL = { push: 'push in', dollyZoom: 'dolly zoom' };

/** What the camera does going from key a to key b: the parts of the move, in numbers and in words. */
export function describeMove(a, b, seconds) {
  const A = poseOf(a), B = poseOf(b), aa = aimOf(A), ab = aimOf(B);
  const d = sub(B.position, A.position), travel = len(d);
  const f = sub(A.target, A.position), fl = len(f) || 1, fwd = f.map((x) => x / fl);
  const rl = Math.hypot(f[0], f[2]) || 1, right = [-f[2] / rl, 0, f[0] / rl];
  const aimMoved = len(sub(B.target, A.target));
  const m = {
    travel: r2(travel),
    dolly: r2(dot(d, fwd)), // + toward the aim
    truck: r2(dot(d, right)), // + to the camera's right
    rise: r2(d[1]), // + up
    pan: r1(-wrap(ab.yaw - aa.yaw)), // + right
    tilt: r1(ab.pitch - aa.pitch), // + up
    lens: [Math.round(fovToLens(A.fov)), Math.round(fovToLens(B.fov))],
    roll: r1(B.roll - A.roll),
    distance: [r2(aa.dist), r2(ab.dist)],
  };
  const p = a.path;
  if (p?.move) { m.preset = p.move; if (p.params && Object.keys(p.params).length) m.params = p.params; }
  if (p?.type) m.path = p.type;
  // An orbit: the camera swings round a point it keeps looking at.
  const c = p?.type === 'orbit' ? p.center ?? A.target : aimMoved < Math.max(0.15, travel * 0.2) ? A.target : null;
  if (c) {
    const b0 = Math.atan2(A.position[0] - c[0], A.position[2] - c[2]) * DEG, b1 = Math.atan2(B.position[0] - c[0], B.position[2] - c[2]) * DEG;
    const swing = p?.type === 'orbit' && p.angle != null ? p.angle : wrap(b1 - b0);
    if (p?.type === 'orbit' || (Math.abs(swing) >= 10 && travel > 0.3)) m.orbit = r1(swing); // + to the camera's right
  }
  const lensChange = m.lens[0] !== m.lens[1];
  const still = travel < 0.03 && Math.abs(m.pan) < 0.5 && Math.abs(m.tilt) < 0.5 && !lensChange && Math.abs(m.roll) < 0.5;
  const turnRate = Math.max(Math.abs(m.pan), Math.abs(m.tilt), Math.abs(m.orbit || 0), Math.abs(m.roll)) / Math.max(seconds, 1e-3);
  m.speed = r2(travel / Math.max(seconds, 1e-3)); // metres per second, on average
  m.pace = still ? 'still' : seconds <= 0.35 ? 'snap' : m.speed > 4 || turnRate > 90 ? 'fast' : m.speed < 0.4 && turnRate < 8 ? 'slow' : 'steady';

  const words = [];
  const side = (v, pos, neg) => (v > 0 ? pos : neg);
  if (still) words.push('hold');
  else if (m.orbit != null) {
    words.push(`orbit ${Math.abs(m.orbit)}° to the ${side(m.orbit, 'right', 'left')}${p?.around ? ` around ${p.around}` : ''}`);
    const dd = m.distance[1] - m.distance[0];
    if (Math.abs(dd) > 0.15) words.push(dd < 0 ? `closing in ${r2(-dd)} m` : `backing off ${r2(dd)} m`);
    if (Math.abs(m.rise) > 0.15) words.push(`${side(m.rise, 'rising', 'dropping')} ${Math.abs(m.rise)} m`);
  } else {
    const dolly = m.preset === 'dollyZoom' ? `dolly zoom ${side(m.dolly, 'in', 'out')} ${Math.abs(m.dolly)} m` : `${side(m.dolly, 'push in', 'pull out')} ${Math.abs(m.dolly)} m`;
    if (Math.abs(m.dolly) > 0.1) words.push(dolly);
    if (Math.abs(m.truck) > 0.1) words.push(`truck ${side(m.truck, 'right', 'left')} ${Math.abs(m.truck)} m`);
    if (Math.abs(m.rise) > 0.1) words.push(`${side(m.rise, 'rise', 'drop')} ${Math.abs(m.rise)} m`);
    if (Math.abs(m.pan) >= 2) words.push(`pan ${side(m.pan, 'right', 'left')} ${Math.abs(m.pan)}°`);
    if (Math.abs(m.tilt) >= 2) words.push(`tilt ${side(m.tilt, 'up', 'down')} ${Math.abs(m.tilt)}°`);
    if (!words.length && travel >= 0.03) words.push(`drift ${m.travel} m`);
  }
  if (!still && lensChange && m.preset !== 'dollyZoom') words.push(`zoom ${m.lens[1] > m.lens[0] ? 'in' : 'out'} ${m.lens[0]}→${m.lens[1]}mm`);
  if (!still && Math.abs(m.roll) >= 0.5) words.push(`roll ${Math.abs(m.roll)}° ${m.roll > 0 ? 'clockwise' : 'anticlockwise'}`);
  if (!words.length) words.push('hold');
  m.text = words.join(', ');
  const label = MOVE_LABEL[m.preset] || m.preset;
  if (m.preset && !m.text.startsWith(label)) m.text += ` (${label} move)`;
  return m;
}

/**
 * The brief for one shot: { shot, start, segments, objects, audio }.
 * Segment times are seconds of the shot's video (the speed curve is already applied).
 */
export function shotBrief(doc, ref) {
  const s = findShot(doc, ref ?? doc.shot);
  const list = shotList(doc);
  const index = list.findIndex((x) => x.id === s.id);
  const tl = list[index].timeline;
  const dur = tl.duration, fps = tl.fps || 24, start = tl.start || 0;
  const at = list.slice(0, index).reduce((sum, x) => sum + x.timeline.duration, 0);
  const meta = doc.meta || {};
  const shot = {
    id: s.id, name: s.name, index: index + 1, of: list.length, active: s.id === doc.shot,
    duration: dur, fps, frames: Math.round(dur * fps), start,
    sequence: [r2(at), r2(at + dur)], // where it sits in `export --sequence`
    width: meta.width, height: meta.height, ratio: ratioOf(meta.width || 16, meta.height || 9),
    interp: tl.interp ?? 'smooth', speed: easeName(tl.speed ?? 'linear'),
  };
  const keys = [...(tl.keys || [])].sort((a, b) => a.t - b.t);
  const frame = (k, t) => describeFraming(doc, tl, poseOf(k), t);
  const segments = [];
  const push = (seg) => { if (seg.to - seg.from > 1e-3) segments.push({ ...seg, from: r2(seg.from), to: r2(seg.to), seconds: r2(seg.to - seg.from) }); };
  if (keys.length) {
    const t0 = unmapTime(tl, keys[0].t);
    if (t0 > 0) push({ from: 0, to: t0, kind: 'hold', text: 'hold', pace: 'still' });
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (a.t >= dur) break;
      const from = unmapTime(tl, a.t), to = unmapTime(tl, b.t);
      const end = frame(b, to);
      if (isCut(a)) { push({ from, to, kind: 'cut', text: `hold, then cut at ${r2(to)}s`, pace: 'still', keys: [a.id, b.id], end }); continue; }
      const move = describeMove(a, b, to - from);
      const seg = { from, to, kind: move.pace === 'still' ? 'hold' : 'move', text: move.text, pace: move.pace, ease: easeName(a.ease), keys: [a.id, b.id], move, end };
      if (b.t > dur + 1e-3) seg.clipped = true; // the shot ends before this move does
      if (a.shudder && seg.kind === 'move') seg.shudder = a.shudder;
      push(seg);
    }
    const last = keys[keys.length - 1], tEnd = unmapTime(tl, last.t);
    if (tEnd < dur) push({ from: tEnd, to: dur, kind: 'hold', text: 'hold', pace: 'still' });
  }
  // Objects that move while the shot runs (their keys are in action time, shared by all shots).
  const objects = [];
  for (const o of doc.objects || []) {
    const ks = o.anim || [];
    if (ks.length < 2) continue;
    const from = Math.max(ks[0].t, start), to = Math.min(ks[ks.length - 1].t, start + dur);
    if (to - from <= 1e-3) continue;
    const p0 = sampleObject(o, { ...tl, speed: 'linear' }, from - start), p1 = sampleObject(o, { ...tl, speed: 'linear' }, to - start);
    const moved = r2(len(sub(p1.position, p0.position))), turned = r1(wrap(p1.rotation[1] - p0.rotation[1]));
    if (!moved && !turned) continue;
    objects.push({ id: o.id, type: o.type, note: o.note || undefined, from: r2(unmapTime(tl, from - start)), to: r2(unmapTime(tl, to - start)), moved, turned });
  }
  // The part of the scene's audio track this shot plays, in shot time and in seconds of the file.
  let audio = null;
  if (doc.audio?.file) {
    const a = doc.audio, off = a.offset || 0;
    const lo = Math.max(start, off + (a.in || 0)), hi = Math.min(start + dur, a.out != null ? off + a.out : a.length ? off + a.length : Infinity);
    audio = { file: a.file, name: a.name, muted: !!a.muted, volume: a.volume ?? 1 };
    if (hi > lo) Object.assign(audio, { from: r2(lo - start), to: r2(hi - start), fileFrom: r2(lo - off), fileTo: r2(hi - off) });
    else audio.silent = true; // none of the track falls inside this shot
  }
  return { shot, start: keys.length ? frame(keys[0], 0) : null, segments, objects, audio };
}

const secs = (v) => v.toFixed(2);
/** The brief as lines of text. beats: { tempo, beat, beats, onsets } from the tab, in shot time (optional). */
export function briefText(b, beats = null, at = 0) {
  const s = b.shot;
  const secs = (v) => (v + at).toFixed(2); // `at`: where the shot starts in the whole timeline's video
  const lines = [
    `shot ${s.index}/${s.of} ${s.id}${s.name !== s.id ? ` "${s.name}"` : ''}: ${s.duration}s @ ${s.fps}fps (${s.frames} frames), ${s.width}x${s.height} (${s.ratio.nearest}${s.ratio.exact !== s.ratio.nearest ? `, exactly ${s.ratio.exact}` : ''})`
      + `${s.start ? `, action from ${s.start}s` : ''}${s.of > 1 ? `, ${s.sequence[0]}–${s.sequence[1]}s of the sequence` : ''}${s.speed !== 'linear' ? `, speed curve ${s.speed} (times below include it)` : ''}`,
  ];
  if (!b.start) lines.push('no camera keys');
  else lines.push(`opens on: ${b.start.text}`);
  for (const g of b.segments) {
    const extra = [];
    if (g.kind === 'move') extra.push(g.pace, `ease ${g.ease}`);
    if (g.shudder) extra.push(`shudder ${g.shudder.jerks} ${g.shudder.shape}s ${g.shudder.amount}%`);
    if (g.clipped) extra.push('the shot ends mid-move');
    lines.push(`${secs(g.from)}–${secs(g.to)}s  ${g.text}${extra.length ? ` [${extra.join(', ')}]` : ''}${g.end && g.kind !== 'hold' ? `  → ${g.end.text}` : ''}`);
  }
  if (b.objects.length) lines.push('objects moving:', ...b.objects.map((o) => `  ${o.id}${o.note ? ` (${o.note})` : ''} ${secs(o.from)}–${secs(o.to)}s: ${[o.moved ? `moves ${o.moved} m` : '', o.turned ? `turns ${Math.abs(o.turned)}°` : ''].filter(Boolean).join(', ')}`));
  if (b.audio) {
    const a = b.audio;
    lines.push(a.silent ? `audio: ${a.name || a.file} does not play during this shot`
      : `audio: ${a.name || a.file} plays ${secs(a.from)}–${secs(a.to)}s of the ${at ? 'video' : 'shot'} = ${a.fileFrom.toFixed(2)}–${a.fileTo.toFixed(2)}s of the file${a.muted ? ' (muted)' : ''}`);
  }
  if (beats) {
    const shift = (list) => list.map((t) => (at ? +(t + at).toFixed(2) : t)).join(' ');
    lines.push(`tempo: ${beats.tempo ? `${beats.tempo} bpm (a beat every ${beats.beat}s)` : 'not found'}`);
    if (beats.beats?.length) lines.push(`beats: ${shift(beats.beats)}`);
    if (beats.onsets?.length) lines.push(`strong onsets: ${shift(beats.onsets)}`);
  }
  return lines.join('\n');
}

/**
 * The whole timeline as one video (what `canvas export` renders): every shot in order, cut together.
 * Returns { timeline: { shots, duration, fps, width, height, ratio, cuts }, shots: [shotBrief + at] }.
 * `at` is where each shot starts in that video; add it to the shot's own times.
 */
export function timelineBrief(doc) {
  const shots = doc.shots.map((s) => shotBrief(doc, s.id)).map((b) => ({ ...b, at: b.shot.sequence[0] }));
  const first = shots[0].shot, last = shots.at(-1).shot;
  return {
    timeline: { shots: shots.length, duration: last.sequence[1], fps: first.fps, width: first.width, height: first.height, ratio: first.ratio, cuts: shots.slice(1).map((b) => b.at) },
    shots,
  };
}

/** The timeline brief as text: one block per shot, every time in seconds of the exported video. */
export function timelineText(t) {
  const { timeline: tl } = t;
  const head = [
    `timeline: ${tl.shots} shot${tl.shots === 1 ? '' : 's'}, ${tl.duration.toFixed(2)}s @ ${tl.fps}fps, ${tl.width}x${tl.height} (${tl.ratio.nearest})`
      + (tl.cuts.length ? `, hard cut${tl.cuts.length === 1 ? '' : 's'} at ${tl.cuts.map((c) => `${c.toFixed(2)}s`).join(' ')}` : ', one continuous shot'),
    'every time below is in seconds of the exported video (canvas export), not of the shot',
  ];
  const blocks = t.shots.map((b, i) => {
    const text = briefText(b, b.beats, b.at).split('\n');
    text[0] = `${i ? `CUT at ${b.at.toFixed(2)}s to ` : ''}shot ${b.shot.index}/${b.shot.of} ${b.shot.id}${b.shot.name !== b.shot.id ? ` "${b.shot.name}"` : ''}: ${b.shot.sequence[0].toFixed(2)}–${b.shot.sequence[1].toFixed(2)}s (${b.shot.duration}s)`;
    return text.join('\n');
  });
  return [head.join('\n'), ...blocks].join('\n\n');
}
