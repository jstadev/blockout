// The person primitive: a jointed artist's mannequin, like the wooden drawing figure. An egg head, a chest
// block, a waist ball and a hip block, with lathe-turned limbs hung on ball joints, paddle hands and wedge
// feet. Every piece is a loft (a stack of rings) placed from a short table of proportions per body, so
// there is no model file to load and a body is about 3.4k triangles. The lengths are fractions of standing
// height, after Drillis and Contini's body segment proportions; the widths are tuned by eye so that the
// three bodies read apart at a distance.

import * as THREE from 'three';

/** Joint positions are [x, y, z] in body heights: +x is one side (mirrored to the other), +z is forward. */
export const BODIES = {
  male: {
    head: { chin: 0.863, h: 0.137, a: 0.049, b: 0.058, z: 0.008 },
    neck: { y: 0.824, r: 0.0275 },
    chest: { y0: 0.638, y1: 0.853, a: 0.1, b: 0.064, taper: 0.58, bust: 0, square: 1 },
    waist: { y: 0.616, a: 0.06, h: 0.04, b: 0.047 },
    pelvis: { y0: 0.45, y1: 0.594, a: 0.09, b: 0.06, top: 0.78 },
    shoulder: [0.11, 0.812, -0.002], shoulderR: 0.034,
    elbow: [0.129, 0.63, -0.006], wrist: [0.139, 0.486, 0.014],
    arm: [0.03, 0.0255, 0.0245, 0.018],
    hand: { len: 0.104, a: 0.0225, b: 0.0105 },
    hip: [0.048, 0.498, 0], knee: [0.047, 0.285, 0.004], ankle: [0.045, 0.05, -0.006],
    leg: [0.046, 0.035, 0.037, 0.0225],
    foot: { len: 0.152, a: 0.03, out: 7 },
  },
  female: {
    head: { chin: 0.864, h: 0.136, a: 0.046, b: 0.056, z: 0.008 },
    neck: { y: 0.822, r: 0.0205 },
    chest: { y0: 0.64, y1: 0.848, a: 0.082, b: 0.054, taper: 0.58, bust: 0.024, square: 0.2 },
    waist: { y: 0.618, a: 0.05, h: 0.038, b: 0.039 },
    pelvis: { y0: 0.447, y1: 0.598, a: 0.091, b: 0.061, top: 0.7 },
    shoulder: [0.096, 0.81, -0.002], shoulderR: 0.0275,
    elbow: [0.113, 0.63, -0.006], wrist: [0.128, 0.488, 0.014],
    arm: [0.025, 0.0215, 0.0205, 0.0145],
    hand: { len: 0.098, a: 0.019, b: 0.009 },
    hip: [0.0505, 0.498, 0], knee: [0.043, 0.283, 0.004], ankle: [0.038, 0.048, -0.006],
    leg: [0.043, 0.0315, 0.033, 0.0195],
    foot: { len: 0.146, a: 0.0255, out: 6 },
  },
  child: {
    head: { chin: 0.834, h: 0.166, a: 0.061, b: 0.07, z: 0.008 },
    neck: { y: 0.794, r: 0.0225 },
    chest: { y0: 0.622, y1: 0.818, a: 0.08, b: 0.061, taper: 0.78, bust: 0, square: 0.3 },
    waist: { y: 0.602, a: 0.063, h: 0.038, b: 0.05 },
    pelvis: { y0: 0.45, y1: 0.582, a: 0.086, b: 0.062, top: 0.86 },
    shoulder: [0.09, 0.782, -0.002], shoulderR: 0.03,
    elbow: [0.107, 0.616, -0.006], wrist: [0.118, 0.482, 0.014],
    arm: [0.0285, 0.025, 0.024, 0.0185],
    hand: { len: 0.094, a: 0.0215, b: 0.0105 },
    hip: [0.046, 0.494, 0], knee: [0.045, 0.272, 0.004], ankle: [0.044, 0.05, -0.006],
    leg: [0.045, 0.035, 0.036, 0.024],
    foot: { len: 0.15, a: 0.031, out: 7 },
  },
};

const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => add(a, b, -1);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;

/** A local frame at o: w is the loft's axis, u its width direction (the hint, squared up), v = u x w its depth. */
function frame(o, axis, hint = X) {
  const w = unit(axis);
  const u = unit(add(hint, w, -dot(hint, w)));
  return { o, u, w, v: cross(u, w) };
}

/**
 * Stack rings into a closed surface. A ring is [s, a, b, off, n, nLow]: s along the axis, half-width a,
 * half-depth b, depth offset off, and a superellipse exponent n (2 is an ellipse, more is boxier; nLow is
 * for the -depth half alone). A ring with a = 0 is a single point, which closes an end.
 */
function loft(out, f, rings, seg) {
  const first = [];
  for (const [s, a, b = a, off = 0, n = 2, nLow = n] of rings) {
    first.push(out.pos.length / 3);
    for (let j = 0; j < (a ? seg : 1); j++) {
      const t = (j / seg) * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
      const x = a * Math.sign(c) * Math.abs(c) ** (2 / n);
      const z = off + (a ? b * Math.sign(sn) * Math.abs(sn) ** (2 / (sn < 0 ? nLow : n)) : 0);
      out.pos.push(...add(add(add(f.o, f.u, x), f.w, s), f.v, z));
    }
  }
  for (let i = 0; i + 1 < rings.length; i++) {
    const lo = first[i], hi = first[i + 1], loPoint = !rings[i][1], hiPoint = !rings[i + 1][1];
    for (let j = 0; j < seg; j++) {
      const k = (j + 1) % seg;
      if (loPoint && !hiPoint) out.idx.push(lo, hi + j, hi + k);
      else if (!loPoint && hiPoint) out.idx.push(hi, lo + k, lo + j);
      else if (!loPoint && Math.sin(((j + 0.5) / seg) * Math.PI * 4) > 0) out.idx.push(lo + j, hi + j, lo + k, lo + k, hi + j, hi + k);
      else if (!loPoint) out.idx.push(lo + j, hi + j, hi + k, lo + j, hi + k, lo + k); // the other diagonal, so both sides match
    }
  }
}

/** A ball joint (or any ellipsoid) at c. */
function ball(out, c, r, seg = 10, rows = 5) {
  const [rx, ry, rz] = Array.isArray(r) ? r : [r, r, r], rings = [];
  for (let i = 0; i <= rows + 1; i++) {
    const p = (Math.PI * i) / (rows + 1), k = i % (rows + 1) ? Math.sin(p) : 0;
    rings.push([-ry * Math.cos(p), rx * k, rz * k]);
  }
  loft(out, frame(c, Y), rings, seg);
}

/** A lathe-turned piece from a to b. prof is [[t, r], ...]: the radius r at fraction t of the way. */
function turned(out, a, b, prof, seg = 10) {
  const d = sub(b, a), L = Math.hypot(...d), [t0, r0] = prof[0], [t1, r1] = prof.at(-1);
  loft(out, frame(a, d, Math.abs(unit(d)[0]) > 0.9 ? Z : X), [
    [t0 * L - r0 * 0.45, 0], ...prof.map(([t, r]) => [t * L, r]), [t1 * L + r1 * 0.45, 0],
  ], seg);
}

/** Build the pieces standing, each in the bucket of the bone that carries it (one side's limbs only). */
function buildParts(B) {
  const G = Object.fromEntries(BONES.map((b) => [b.id, { pos: [], idx: [] }]));


  // Head: an egg, wider at the crown, tipped so the chin leads.
  {
    const { chin, h, a, b, z } = B.head, rows = 8, e = 0.17, rings = [];
    let top = 0;
    for (let i = 1; i <= rows; i++) { const p = (Math.PI * i) / (rows + 1); top = Math.max(top, Math.sin(p) * (1 - e * Math.cos(p))); }
    for (let i = 0; i <= rows + 1; i++) {
      const p = (Math.PI * i) / (rows + 1), k = i % (rows + 1) ? (Math.sin(p) * (1 - e * Math.cos(p))) / top : 0;
      rings.push([(h * (1 - Math.cos(p))) / 2, a * k, b * k]);
    }
    const f = frame([0, chin, z + h * 0.1], [0, 1, -0.2]);
    loft(G.neck, f, rings, 16);
    // a plain wedge of a nose, so the facing reads from any distance
    const bridge = add(add(f.o, f.w, h * 0.57), f.v, b * 0.965), tip = add(add(f.o, f.w, h * 0.34), f.v, b * 0.9);
    const L = Math.hypot(...sub(tip, bridge));
    loft(G.neck, frame(bridge, sub(tip, bridge), [-1, 0, 0]), [
      [0, 0, 0, 0], [L * 0.45, h * 0.034, h * 0.034, 0], [L * 0.85, h * 0.064, h * 0.064, h * 0.024], [L, h * 0.05, h * 0.044, h * 0.014], [L * 1.05, 0, 0, 0],
    ], 6);
    turned(G.neck, [0, B.neck.y, -0.004], [0, chin + h * 0.16, z - 0.002], [[0, B.neck.r * 1.08], [1, B.neck.r]], 10);
  }

  // Chest: broad at the shoulders, narrowing to the waist, with rounded-square sections.
  {
    const { y0, y1, a, b, taper, bust, square } = B.chest, H = y1 - y0;
    const rows = [
      [0.03, 0, 0.6, 0.86], [0.14, 0.16, 0.75, 1], [0.27, 0.38, 0.86, 1], [0.4, 0.6, 0.94, 1], [0.52, 0.79, 0.99, 1], [0.63, 0.93, 1, 1],
      [0.74, 1, 0.98, 1], [0.86, 1, 0.88, lerp(0.9, 0.96, square)], [0.95, 1, 0.64, lerp(0.6, 0.74, square)],
    ];
    const rings = [[0, 0, 0, -0.002]];
    for (const [t, k, depth, round] of rows) {
      // a bust is one broad swell of the front, as on a dress form
      const swell = (bust * Math.cos((Math.PI / 2) * Math.max(-1, Math.min(1, (t - 0.5) / 0.34))) ** 2) / 2;
      rings.push([t * H, a * lerp(taper, 1, k) * round, b * depth + swell, swell - 0.002 - 0.004 * t, 2.5]);
    }
    rings.push([H * 1.07, 0, 0, -0.006]); // the top rises a little to the neck
    loft(G.spine, frame([0, y0, 0], Y), rings, 16);
  }

  ball(G.spine, [0, B.waist.y, 0], [B.waist.a, B.waist.h, B.waist.b], 14, 5);

  // Hips: a block that is widest low down and tucks in to the crotch between the leg joints.
  {
    const { y0, y1, a, b, top } = B.pelvis, H = y1 - y0;
    const rows = [[0.05, 0.2, 0.42], [0.2, 0.42, 0.7], [0.38, 0.7, 0.92], [0.54, 0.95, 1], [0.68, 1, 1], [0.84, lerp(top, 1, 0.6), 0.93], [0.96, top * 0.94, 0.78]];
    const rings = [[0, 0, 0, 0]];
    for (const [t, w, depth] of rows) rings.push([t * H, a * w, b * depth, -0.004 * Math.sin(Math.PI * t), 2.5]);
    rings.push([H, 0, 0, 0]);
    loft(G.body, frame([0, y0, 0], Y), rings, 20);
  }

  // Arm: shoulder ball, upper arm, elbow ball, forearm, wrist ball, hand.
  {
    const [u0, u1, f0, f1] = B.arm, { shoulder: S, elbow: E, wrist: W, hand } = B;
    ball(G.shoulder, S, B.shoulderR);
    turned(G.shoulder, S, E, [[0.12, u0 * 0.96], [0.3, u0], [0.9, u1]]);
    ball(G.elbow, E, u1 * 1.12, 10, 5);
    turned(G.elbow, E, W, [[0.11, f0 * 0.94], [0.28, f0], [0.9, f1]]);
    ball(G.elbow, W, f1 * 1.1, 8, 4);
    // the hand hangs palm in, thumb forward: a flat paddle, broad front to back
    const down = unit(add(sub(W, E), [0, -1, 0.1], 0.12)), f = frame(W, down, Z), L = hand.len, { a, b } = hand;
    loft(G.wrist, f, [
      [L * 0.06, 0, 0, 0], [L * 0.1, a * 0.58, b * 0.9, 0, 2.6], [L * 0.3, a * 0.96, b, 0, 2.6], [L * 0.52, a, b * 0.96, 0, 2.6],
      [L * 0.76, a * 0.86, b * 0.8, 0, 2.6], [L * 0.94, a * 0.56, b * 0.6, 0, 2.6], [L, 0, 0, 0],
    ], 8);
    const root = add(add(W, f.w, L * 0.2), f.u, a * 0.7);
    turned(G.wrist, root, add(add(root, f.w, L * 0.3), f.u, a * 0.62), [[0, a * 0.36], [0.6, a * 0.34], [1, a * 0.26]], 6);
  }

  // Leg: hip ball, thigh, knee ball, shin, ankle ball, foot.
  {
    const [t0, t1, calf, ank] = B.leg, { hip: P, knee: K, ankle: A, foot } = B;
    ball(G.hip, P, t0 * 1.03, 14, 6);
    turned(G.hip, P, K, [[0.1, t0 * 0.97], [0.3, t0], [0.9, t1]], 12);
    ball(G.knee, K, t1 * 1.12, 12, 5);
    turned(G.knee, K, A, [[0.09, t1 * 0.93], [0.3, calf], [0.6, lerp(calf, ank, 0.55)], [0.92, ank]], 12);
    ball(G.knee, A, ank * 1.1, 8, 4);
    // the foot: flat on the ground, high under the ankle, low and broad at the toes, turned out a little
    const o = (foot.out * Math.PI) / 180, toe = [Math.sin(o), 0, Math.cos(o)], L = foot.len, w = foot.a, hgt = A[1];
    const heel = add([A[0], 0, A[2]], toe, -L * 0.27);
    const rows = [[0.035, 0.56, 0.72], [0.16, 0.8, 0.98], [0.32, 0.9, 1.04], [0.5, 0.97, 0.84], [0.7, 1, 0.56], [0.88, 0.92, 0.4], [0.97, 0.62, 0.3]];
    const rings = [[0, 0, 0, hgt * 0.3]];
    for (const [t, width, high] of rows) rings.push([t * L, w * width, (hgt * high) / 2, (hgt * high) / 2, 2.6, 7]);
    rings.push([L, 0, 0, hgt * 0.12]);
    loft(G.ankle, frame(heel, toe, cross(toe, Y)), rings, 12);
  }

  return G;
}

// The skeleton. Each bone turns about its joint (pivot) and carries its children. Limb bones exist once per
// side: L is the figure's own left (+x), R its right.
const BONES = [
  { id: 'body', pivot: (B) => [0, B.hip[1], 0] },
  { id: 'spine', parent: 'body', pivot: (B) => [0, B.waist.y, 0] },
  { id: 'neck', parent: 'spine', pivot: (B) => [0, B.neck.y, -0.004] },
  { id: 'shoulder', parent: 'spine', side: true, pivot: (B) => B.shoulder },
  { id: 'elbow', parent: 'shoulder', side: true, hinge: -1, pivot: (B) => B.elbow },
  { id: 'wrist', parent: 'elbow', side: true, pivot: (B) => B.wrist },
  { id: 'hip', parent: 'body', side: true, pivot: (B) => B.hip },
  { id: 'knee', parent: 'hip', side: true, hinge: 1, pivot: (B) => B.knee },
  { id: 'ankle', parent: 'knee', side: true, hinge: -1, pivot: (B) => B.ankle },
];

/** Every joint a pose can set, e.g. kneeL. */
export const JOINTS = BONES.flatMap((b) => (b.side ? [`${b.id}L`, `${b.id}R`] : [b.id]));

/**
 * The named poses, as joint angles in degrees (unset joints stay as they stand). The angles mean:
 *   body, spine, neck   [bend forward, lean to its left, turn to its left]  (body turns the whole figure at the hips)
 *   shoulder, hip, wrist [raise forward, raise out to the side, twist about its length (+ turns its front out)]
 *   elbow, knee         bend (0 is straight)
 *   ankle               toes up (+) or pointed (−)
 */
export const POSES = {
  stand: {},
  walk: { hipL: 22, kneeL: 8, ankleL: 10, hipR: -16, kneeR: 22, ankleR: -10, shoulderL: -16, elbowL: 12, shoulderR: 18, elbowR: 20 },
  run: {
    spine: 12, neck: -8, hipL: 55, kneeL: 75, ankleL: 10, hipR: -22, kneeR: 95, ankleR: -30,
    shoulderL: [-38, 8], elbowL: 95, shoulderR: [48, 8], elbowR: 100,
  },
  sit: { spine: -4, hipL: [90, 6], kneeL: 90, hipR: [90, 6], kneeR: 90, shoulderL: [4, 4], elbowL: 55, wristL: -15, shoulderR: [4, 4], elbowR: 55, wristR: -15 },
  'sit-floor': {
    spine: 8, hipL: [82, 50, 125], kneeL: 140, ankleL: -40, hipR: [76, 48, 115], kneeR: 142, ankleR: -40,
    shoulderL: [12, 14], elbowL: 40, shoulderR: [12, 14], elbowR: 40,
  },
  crouch: {
    body: 16, spine: 22, neck: -26, hipL: [112, 14, 10], kneeL: 140, ankleL: 28, hipR: [112, 14, 10], kneeR: 140, ankleR: 28,
    shoulderL: [40, 12], elbowL: 50, shoulderR: [40, 12], elbowR: 50,
  },
  kneel: {
    hipL: [90, 4], kneeL: 90, hipR: [-2, 4], kneeR: 90, ankleR: -40,
    spine: 6, shoulderL: [30, 6], elbowL: 30, shoulderR: [4, 6], elbowR: 10,
  },
  lie: { body: -90, neck: 6, shoulderL: [0, 12], shoulderR: [0, 12] },
  lean: { body: -9, neck: 8, hipL: [10, 0, 12], kneeL: 16, ankleL: -30, hipR: [-4, -12], shoulderL: [-12, 8], shoulderR: [-12, 8], elbowL: 15, elbowR: 15 },
  point: { shoulderR: [88, 4], elbowR: 4, wristR: 4, neck: [0, 0, -8], spine: [0, 0, -6] },
  wave: { shoulderR: [0, 95, 90], elbowR: 100, neck: [0, 0, -6] },
  'arms-crossed': { shoulderL: [25, 12, -70], elbowL: 110, shoulderR: [28, 12, -76], elbowR: 106 },
  'hands-on-hips': { shoulderL: [-10, 45, -90], elbowL: 110, wristL: [0, -15], shoulderR: [-10, 45, -90], elbowR: 110, wristR: [0, -15] },
  'reach-up': { neck: -24, shoulderL: [168, 6], shoulderR: [168, 6], elbowL: 6, elbowR: 6 },
  phone: { neck: [6, -8], shoulderR: [60, 20, -20], elbowR: 155, wristR: [0, -10] },
};

const DEG = Math.PI / 180;
const triple = (v) => (Array.isArray(v) ? [v[0] || 0, v[1] || 0, v[2] || 0] : [v || 0, 0, 0]);

const DOWN = new THREE.Vector3(0, -1, 0), AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const about = (axis, deg) => new THREE.Quaternion().setFromAxisAngle(AX[axis], deg * DEG);

/** A bone's turn as a quaternion, from its angles; s is the side (+1 left, −1 right), mirroring the turns. */
function turnOf(bone, v, s) {
  const [a, b, c] = triple(v);
  if (bone.hinge) return about('x', bone.hinge * a);
  if (bone.side) {
    // a limb: aim it (out to the side in the frontal plane, then forward), swinging it there the shortest way,
    // after twisting it about its own length (+ turns its front outward)
    const aim = DOWN.clone().applyQuaternion(about('z', s * b)).applyQuaternion(about('x', -a));
    return new THREE.Quaternion().setFromUnitVectors(DOWN, aim).multiply(about('y', s * c));
  }
  // the trunk: bend forward, then lean, then turn
  return about('y', c).multiply(about('z', -b)).multiply(about('x', a));
}

/** The joints of a pose with any overrides, as { joint: [a, b, c] }. Unknown poses stand. */
export function poseJoints(pose, joints) {
  return { ...(POSES[pose] || {}), ...(joints || {}) };
}

function assemble(B, parts, angles) {
  // each bone's placement: parent · move to the joint · turn · move back
  const world = {}, M = new THREE.Matrix4(), T = new THREE.Matrix4(), R = new THREE.Matrix4();
  const posed = [];
  for (const s of [1, -1]) {
    for (const bone of BONES) {
      if (!bone.side && s < 0) continue;
      const key = bone.side ? `${bone.id}${s > 0 ? 'L' : 'R'}` : bone.id;
      const p = bone.pivot(B), pv = [p[0] * (bone.side ? s : 1), p[1], p[2]];
      const parentKey = bone.parent && (BONES.find((x) => x.id === bone.parent).side ? `${bone.parent}${s > 0 ? 'L' : 'R'}` : bone.parent);
      M.copy(parentKey ? world[parentKey] : new THREE.Matrix4());
      M.multiply(T.makeTranslation(pv[0], pv[1], pv[2]));
      M.multiply(R.makeRotationFromQuaternion(turnOf(bone, angles[key], s)));
      M.multiply(T.makeTranslation(-pv[0], -pv[1], -pv[2]));
      world[key] = M.clone();
      posed.push({ part: parts[bone.id], m: world[key], s: bone.side ? s : 1 });
    }
  }
  const pos = [], idx = [], v = new THREE.Vector3();
  for (const { part, m, s } of posed) {
    const base = pos.length / 3;
    for (let i = 0; i < part.pos.length; i += 3) {
      v.set(part.pos[i] * s, part.pos[i + 1], part.pos[i + 2]).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
    }
    // the mirrored side's triangles are turned to face out again
    for (let i = 0; i < part.idx.length; i += 3) {
      const [a, b, c] = part.idx.slice(i, i + 3);
      if (s > 0) idx.push(base + a, base + b, base + c); else idx.push(base + a, base + c, base + b);
    }
  }
  return { pos, idx };
}

const PARTS = {}, CACHE = {};
const yRange = (pos) => { let lo = Infinity, hi = -Infinity; for (let i = 1; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); } return [lo, hi]; };

/**
 * The mannequin for a body (male, female or child) in a pose (a name from POSES, default stand) with any
 * joint overrides ({ kneeL: 90, shoulderR: [80, 0, 10] }). It is scaled so that standing it is one unit tall,
 * so the object's h is always the standing height; posed, its lowest point is on y = 0 and the hips stay over
 * the origin. Facing +z. Built once per body, pose and joints.
 */
export function mannequin(body, pose = 'stand', joints = null) {
  const b = BODIES[body] ? body : 'male', p = POSES[pose] ? pose : 'stand';
  const key = `${b}|${p}|${joints ? JSON.stringify(joints) : ''}`;
  if (CACHE[key]) return CACHE[key];
  const B = BODIES[b], parts = (PARTS[b] ??= buildParts(B));
  const rest = (PARTS[`${b}:range`] ??= yRange(assemble(B, parts, {}).pos));
  const { pos, idx } = assemble(B, parts, poseJoints(p, joints));
  const [lo] = yRange(pos), scale = rest[1] - rest[0];
  const arr = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i++) arr[i] = (pos[i] - (i % 3 === 1 ? lo : 0)) / scale;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.setIndex(idx);
  return (CACHE[key] = g);
}
