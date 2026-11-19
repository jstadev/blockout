// Easing, speed curves and camera path sampling.
// Pure ES module, no three.js: shared by the browser, the server and the CLI.

/** Named easing presets as cubic-bezier control points [x1, y1, x2, y2]. */
export const EASES = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  slowIn: [0.7, 0, 0.84, 0],      // strong acceleration
  slowOut: [0.16, 1, 0.3, 1],     // strong deceleration (expo-ish)
  snap: [0.85, 0, 0.15, 1],       // fast through the middle
  anticipate: [0.36, -0.3, 0.6, 1],
  overshoot: [0.34, 1.4, 0.64, 1],
  hold: 'hold',                   // stay on this key until the next one, then cut
};

/**
 * Normalise an ease spec (preset name, bezier array, or undefined) to a bezier array or 'hold'.
 *
 * A bezier array is CSS cubic-bezier [x1, y1, x2, y2] from (0,0) to (1,1), optionally followed by more
 * points, each with its handles: [x1, y1, x2, y2, px, py, x3, y3, x4, y4, ...]. Every 6 extra numbers add a
 * point (px, py) that the curve passes through; the 2 numbers before a point are its incoming handle and
 * the 2 after it its outgoing handle. So the length is 4 + 6 × (number of points). Point x grows from 0 to 1
 * and every x stays within 0–1; keep each handle's x within its own segment and the curve is a function of time.
 */
export function resolveEase(spec) {
  if (spec == null) return EASES.easeInOut;
  if (typeof spec === 'string') {
    if (!(spec in EASES)) throw new Error(`unknown ease "${spec}" (known: ${Object.keys(EASES).join(', ')})`);
    return EASES[spec];
  }
  if (Array.isArray(spec) && spec.length >= 4 && (spec.length - 4) % 6 === 0 && spec.every(Number.isFinite)) {
    if (spec.length === 4) return [clamp(spec[0], 0, 1), spec[1], clamp(spec[2], 0, 1), spec[3]];
    // x must keep moving forward for the curve to be a function of time.
    const segs = easeSegments(spec, false);
    let x0 = 0;
    for (const g of segs) {
      g[6] = clamp(g[6], x0, 1); // end point
      g[0] = x0; x0 = g[6];
    }
    for (const g of segs) { g[2] = clamp(g[2], 0, 1); g[4] = clamp(g[4], 0, 1); }
    return easeFromSegments(segs);
  }
  throw new Error(`bad ease ${JSON.stringify(spec)}: use a preset name, [x1,y1,x2,y2], or that plus [px,py,x3,y3,x4,y4] per extra point`);
}

/**
 * Split a bezier ease into its cubic segments, each [p0x, p0y, c1x, c1y, c2x, c2y, p3x, p3y].
 * A plain [x1, y1, x2, y2] is one segment from (0,0) to (1,1).
 */
export function easeSegments(b, check = true) {
  if (check) b = resolveEase(b);
  const segs = [];
  let p = [0, 0];
  for (let i = 0; i < b.length; i += 6) {
    const end = i + 4 < b.length ? [b[i + 4], b[i + 5]] : [1, 1];
    segs.push([p[0], p[1], b[i], b[i + 1], b[i + 2], b[i + 3], end[0], end[1]]);
    p = end;
  }
  return segs;
}

/** The flat bezier array for a list of segments (the inverse of easeSegments). */
export function easeFromSegments(segs) {
  const out = [];
  segs.forEach((g, i) => { out.push(g[2], g[3], g[4], g[5]); if (i < segs.length - 1) out.push(g[6], g[7]); });
  return out;
}

/** The preset name for a bezier, if it matches one. */
export function easeName(spec) {
  if (typeof spec === 'string') return spec;
  const b = resolveEase(spec);
  for (const [k, v] of Object.entries(EASES)) {
    if (Array.isArray(v) && v.length === b.length && v.every((n, i) => Math.abs(n - b[i]) < 1e-4)) return k;
  }
  return 'custom';
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Evaluate a bezier ease y(x) for x in [0,1]: one cubic-bezier, or several joined at points. */
export function bezier(b, x) {
  if (b === 'hold') return x >= 1 ? 1 : 0;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (b.length === 4) {
    const [x1, y1, x2, y2] = b;
    if (x1 === y1 && x2 === y2) return x; // linear
    return cubicAt(0, 0, x1, y1, x2, y2, 1, 1, x);
  }
  const segs = easeSegments(b, false);
  const g = segs.find((s) => x <= s[6]) ?? segs[segs.length - 1];
  return cubicAt(...g, x);
}

// y at x on the cubic bezier (p0, c1, c2, p3), with x growing from p0 to p3.
function cubicAt(x0, y0, x1, y1, x2, y2, x3, y3, x) {
  if (x3 - x0 < 1e-9) return y3;
  const cx = 3 * (x1 - x0), bx = 3 * (x2 - x1) - cx, ax = x3 - x0 - cx - bx;
  const cy = 3 * (y1 - y0), by = 3 * (y2 - y1) - cy, ay = y3 - y0 - cy - by;
  const sx = (t) => x0 + ((ax * t + bx) * t + cx) * t;
  const dsx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  // Newton, then bisection fallback.
  let t = (x - x0) / (x3 - x0);
  for (let i = 0; i < 8; i++) {
    const e = sx(t) - x;
    if (Math.abs(e) < 1e-7) break;
    const d = dsx(t);
    if (Math.abs(d) < 1e-6) break;
    t -= e / d;
  }
  if (!(t >= 0 && t <= 1) || Math.abs(sx(t) - x) > 1e-5) {
    let lo = 0, hi = 1;
    t = (x - x0) / (x3 - x0);
    for (let i = 0; i < 50; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
  }
  return y0 + ((ay * t + by) * t + cy) * t;
}

/**
 * Add a point to a bezier ease at x without changing its shape (the segment there is split in two).
 * Returns the new flat array and the index of the new point (1 = the first point after the start).
 */
export function splitEase(b, x) {
  const segs = easeSegments(b);
  const j = Math.max(0, segs.findIndex((s) => x <= s[6]));
  const [x0, y0, x1, y1, x2, y2, x3, y3] = segs[j];
  // the curve parameter at x, by bisection on the (monotonic) x polynomial
  const bx = (t) => { const u = 1 - t; return u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3; };
  let lo = 0, hi = 1, t = 0.5;
  for (let i = 0; i < 50; i++) { t = (lo + hi) / 2; if (bx(t) < x) lo = t; else hi = t; }
  const L = (a, c) => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
  const P0 = [x0, y0], P1 = [x1, y1], P2 = [x2, y2], P3 = [x3, y3];
  const A = L(P0, P1), B = L(P1, P2), C = L(P2, P3), D = L(A, B), E = L(B, C), F = L(D, E);
  segs.splice(j, 1, [...P0, ...A, ...D, ...F], [...F, ...E, ...C, ...P3]);
  return { ease: easeFromSegments(segs).map((n) => +n.toFixed(4)), point: j + 1 };
}

/** Remove point i (1-based, as splitEase returns) from a bezier ease: its neighbours join with their outer handles. */
export function removeEasePoint(b, i) {
  const segs = easeSegments(b);
  if (i < 1 || i >= segs.length) return resolveEase(b);
  const a = segs[i - 1], c = segs[i];
  // Stretch the outer handles back by where the point sat along the joined curve. For a point that was only
  // added, its handle lengths split as t : (1 - t), so this gives back the curve it came from.
  const din = Math.hypot(a[6] - a[4], a[7] - a[5]), dout = Math.hypot(c[2] - c[0], c[3] - c[1]);
  const f = clamp(din + dout > 1e-6 ? din / (din + dout) : (a[6] - a[0]) / Math.max(1e-6, c[6] - a[0]), 0.05, 0.95);
  const c1 = [clamp(a[0] + (a[2] - a[0]) / f, 0, 1), a[1] + (a[3] - a[1]) / f];
  const c2 = [clamp(c[6] + (c[4] - c[6]) / (1 - f), 0, 1), c[7] + (c[5] - c[7]) / (1 - f)];
  segs.splice(i - 1, 2, [a[0], a[1], ...c1, ...c2, c[6], c[7]].map((n) => +n.toFixed(3)));
  return resolveEase(easeFromSegments(segs));
}

/** Relative speed (dy/dx) of an easing curve at x, 1 = constant speed. */
export function bezierSpeed(b, x, h = 1e-3) {
  if (b === 'hold') return 0;
  const a = clamp(x - h, 0, 1), c = clamp(x + h, 0, 1);
  return (bezier(b, c) - bezier(b, a)) / (c - a || 1);
}

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Centripetal Catmull-Rom (no cusps, no self-intersection) through p1..p2.
function catmull(p0, p1, p2, p3, t) {
  const d = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const u = lerp(t1, t2, t);
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const A1 = ((t1 - u) * p0[i] + (u - t0) * p1[i]) / (t1 - t0);
    const A2 = ((t2 - u) * p1[i] + (u - t1) * p2[i]) / (t2 - t1);
    const A3 = ((t3 - u) * p2[i] + (u - t2) * p3[i]) / (t3 - t2);
    const B1 = ((t2 - u) * A1 + (u - t0) * A2) / (t2 - t0);
    const B2 = ((t3 - u) * A2 + (u - t1) * A3) / (t3 - t1);
    out[i] = ((t2 - u) * B1 + (u - t1) * B2) / (t2 - t1);
  }
  return out;
}

/** True when the camera cuts away from this key (its ease is hold): the next key starts a new shot. */
export const isCut = (key) => resolveEase(key?.ease) === 'hold';

// Mirror an end point so the spline starts/ends without a kink.
const extrap = (a, b) => [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];

/** Map shot time t (seconds) through the timeline-wide speed curve. */
export function remapTime(timeline, t) {
  const dur = Math.max(1e-6, timeline.duration);
  const speed = resolveEase(timeline.speed ?? 'linear');
  return bezier(speed, clamp(t / dur, 0, 1)) * dur;
}

/**
 * Sample the shot camera at time t.
 * Returns { position, target, fov, roll, segment, local } or null when there are no keys.
 */
export function sampleCamera(timeline, t) {
  const keys = [...(timeline.keys || [])].sort((a, b) => a.t - b.t);
  if (!keys.length) return null;
  const tt = remapTime(timeline, t);
  const pose = (k) => ({ position: [...k.position], target: [...k.target], fov: k.fov ?? 40, roll: k.roll ?? 0 });
  if (keys.length === 1 || tt <= keys[0].t) return { ...pose(keys[0]), segment: 0, local: 0 };
  const last = keys[keys.length - 1];
  if (tt >= last.t) return { ...pose(last), segment: keys.length - 1, local: 0 };
  let i = 0;
  while (i < keys.length - 2 && tt >= keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const span = Math.max(1e-6, b.t - a.t);
  const s = bezier(resolveEase(a.ease), clamp((tt - a.t) / span, 0, 1));
  const smooth = (timeline.interp ?? 'smooth') === 'smooth';
  // A hold key ends a shot: the camera stays there, then cuts to the next key. The smooth path must not
  // look across a cut, or each shot's move bends toward the other shot.
  const prev = i > 0 && !isCut(keys[i - 1]) ? keys[i - 1] : null;
  const next = !isCut(b) ? keys[i + 2] : null;
  const out = { fov: lerp(a.fov ?? 40, b.fov ?? 40, s), roll: lerp(a.roll ?? 0, b.roll ?? 0, s), segment: i, local: s };
  // A key's path says how the camera travels to the next key (a move); without one it is the smooth spline.
  if (a.path && !isCut(a)) return { ...travel(a, b, s), ...out, ...(a.path.type === 'dollyZoom' ? { fov: dollyZoomFov(a, b, s) } : {}) };
  const pick = (field) => {
    if (!smooth) return lerp3(a[field], b[field], s);
    const p0 = prev?.[field] ?? extrap(a[field], b[field]);
    const p3 = next?.[field] ?? extrap(b[field], a[field]);
    return catmull(p0, a[field], b[field], p3, s);
  };
  return { position: pick('position'), target: pick('target'), ...out };
}

// ----- segment paths: how a move travels from key a to key b -----
/** The path types a key can give the segment after it ("smooth", the spline, is no path at all). */
export const PATHS = ['straight', 'orbit', 'turn', 'dollyZoom'];

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const len3 = (v) => Math.hypot(v[0], v[1], v[2]);
const DEG = Math.PI / 180;

/**
 * The angle (radians) to sweep from `from` to `to`: the shortest way round, unless `hint` (degrees) says
 * which way and how far, e.g. 270 for three quarters of a turn the long way.
 */
export function sweep(from, to, hint) {
  let d = to - from;
  d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
  if (Number.isFinite(hint) && hint !== 0) d += 2 * Math.PI * Math.round((hint * DEG - d) / (2 * Math.PI));
  return d;
}

// A point turning round the vertical axis through c, from p to q: angle, radius and height blend separately.
function arc(c, p, q, s, hint) {
  const u = sub3(p, c), v = sub3(q, c);
  const ru = Math.hypot(u[0], u[2]), rv = Math.hypot(v[0], v[2]);
  if (ru < 1e-4 || rv < 1e-4) return lerp3(p, q, s); // on the axis: nothing to turn
  const a0 = Math.atan2(u[0], u[2]);
  const th = a0 + sweep(a0, Math.atan2(v[0], v[2]), hint) * s;
  const r = lerp(ru, rv, s);
  return [c[0] + r * Math.sin(th), lerp(p[1], q[1], s), c[2] + r * Math.cos(th)];
}

// Direction of view as yaw (round Y, 0 = looking +z), pitch and distance.
function aim(k) {
  const d = sub3(k.target, k.position);
  return { yaw: Math.atan2(d[0], d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])), dist: Math.max(1e-4, len3(d)) };
}

function travel(a, b, s) {
  const p = a.path;
  if (p.type === 'orbit') {
    const c = p.center ?? a.target;
    // positive angles orbit to the camera's right, which is a growing atan2(x, z)
    return { position: arc(c, a.position, b.position, s, p.angle), target: arc(c, a.target, b.target, s, p.angle) };
  }
  if (p.type === 'turn') {
    // pan and tilt on the spot: the view direction turns, the camera barely moves (positive pans right)
    const position = lerp3(a.position, b.position, s);
    const A = aim(a), B = aim(b);
    const yaw = A.yaw + sweep(A.yaw, B.yaw, p.angle != null ? -p.angle : undefined) * s;
    const pitch = lerp(A.pitch, B.pitch, s), dist = lerp(A.dist, B.dist, s);
    const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    return { position, target: add3(position, dir.map((x) => x * dist)) };
  }
  return { position: lerp3(a.position, b.position, s), target: lerp3(a.target, b.target, s) };
}

// Dolly zoom: the lens follows the distance so the frame stays the same width at the subject (the target).
function dollyZoomFov(a, b, s) {
  const pos = lerp3(a.position, b.position, s), tgt = lerp3(a.target, b.target, s);
  const half = (k) => Math.tan(((k.fov ?? 40) * DEG) / 2) * Math.max(1e-4, len3(sub3(k.target, k.position)));
  const w = lerp(half(a), half(b), s);
  return (2 * Math.atan(w / Math.max(1e-4, len3(sub3(tgt, pos))))) / DEG;
}

/** Convert a vertical FOV (deg) to a full-frame-equivalent focal length (mm), and back. */
export const fovToLens = (fov) => 12 / Math.tan((fov * Math.PI) / 360);
export const lensToFov = (mm) => (360 / Math.PI) * Math.atan(12 / mm);

/**
 * Transform of an object at shot time t. Objects without animation keys stay where they are.
 * Animation keys ({ t, position, rotation, scale, ease }) interpolate in straight lines with the
 * segment's ease; before the first key and after the last the object holds still.
 * The shot speed curve remaps object time too, so the whole shot stays in sync. Keys are in action time,
 * shared by every shot of the scene; a shot shows the action from its timeline.start (default 0).
 */
export function sampleObject(obj, timeline, t) {
  const keys = obj.anim;
  if (!keys?.length) return { position: obj.position, rotation: obj.rotation, scale: obj.scale };
  const tt = remapTime(timeline, t) + (timeline.start || 0);
  const pose = (k) => ({ position: [...k.position], rotation: [...k.rotation], scale: [...k.scale] });
  if (keys.length === 1 || tt <= keys[0].t) return pose(keys[0]);
  const last = keys[keys.length - 1];
  if (tt >= last.t) return pose(last);
  let i = 0;
  while (i < keys.length - 2 && tt >= keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const s = bezier(resolveEase(a.ease), clamp((tt - a.t) / Math.max(1e-6, b.t - a.t), 0, 1));
  return { position: lerp3(a.position, b.position, s), rotation: lerp3(a.rotation, b.rotation, s), scale: lerp3(a.scale, b.scale, s) };
}
