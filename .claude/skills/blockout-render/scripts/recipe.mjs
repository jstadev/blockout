#!/usr/bin/env node
// recipe: find and fill the slots of a ComfyUI workflow (API format) for a Blockout render.
// A "recipe" is a saved reference-to-video workflow. This script never talks to ComfyUI: it only reads a
// workflow JSON, says where the blockout video, reference images, audio, prompt and settings go, and writes
// a filled copy. No dependencies; needs Node 18+.
//
//   node recipe.mjs list [--root <scene folder>]          built-in recipes and the user's own
//   node recipe.mjs slots <workflow.json> [--json]        the slots found in a workflow
//   node recipe.mjs fill <workflow.json> --out <file> [--video name] [--image name]... [--audio name|none]
//        [--prompt-file file | --prompt text] [--duration s] [--trim s] [--start s] [--ratio 9:16]
//        [--resolution 720p] [--seed n|new] [--prefix path] [--set node.input=value]...
//   node recipe.mjs folder --root <scene folder> --scene <name> --shot <id>    make a render folder, print it

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BUILTIN = path.resolve(HERE, '..', 'recipes');

const title = (n) => n?._meta?.title || '';
const tagOf = (n) => (/@(video|image|audio|prompt|trim|save|model)(?:_?(\d+))?\b/i.exec(title(n)) || []).slice(1);
const isStr = (v) => typeof v === 'string';

/** Throws unless wf is an API-format workflow: { "<id>": { class_type, inputs } }. */
export function assertApiFormat(wf) {
  if (wf && Array.isArray(wf.nodes) && Array.isArray(wf.links)) {
    throw new Error('this is the editor (UI) format. Export the API format instead: in ComfyUI, Workflow > Export (API); with comfy-cli, `comfy run` converts it, but slots can only be filled in the API format');
  }
  const ok = wf && typeof wf === 'object' && Object.values(wf).length && Object.values(wf).every((n) => n && isStr(n.class_type) && n.inputs && typeof n.inputs === 'object');
  if (!ok) throw new Error('not a ComfyUI API-format workflow (expected { "<node id>": { "class_type", "inputs" } })');
}

const linkOf = (wf, v) => (Array.isArray(v) && v.length === 2 && wf[String(v[0])] && Number.isInteger(v[1]) ? String(v[0]) : null);

/** Every node a node draws on, through its links (itself included). */
function ancestors(wf, id, seen = new Set()) {
  if (seen.has(id)) return seen;
  seen.add(id);
  for (const v of Object.values(wf[id].inputs)) { const src = linkOf(wf, v); if (src) ancestors(wf, src, seen); }
  return seen;
}
const firstKey = (n, names, test = isStr) => names.find((k) => test(n.inputs[k])) ?? Object.keys(n.inputs).find((k) => test(n.inputs[k]));
const endsWith = (n, re, test = () => true) => Object.keys(n.inputs).find((k) => re.test(k) && test(n.inputs[k]));
const trailingNumber = (k) => { const m = /(\d+)$/.exec(k); return m ? Number(m[1]) : null; };

/**
 * The slots of a workflow, found by node type (a title tag such as "@video", "@image_2", "@audio",
 * "@prompt", "@trim", "@save" or "@model" on a node overrides the guess).
 * Returns { model, prompt, video, images[], audio, trim, settings{}, save, warnings[] }; each slot is
 * { node, input, value, ... }.
 */
export function findSlots(wf) {
  assertApiFormat(wf);
  const ids = Object.keys(wf);
  const tagged = (name) => ids.filter((id) => (tagOf(wf[id])[0] || '').toLowerCase() === name);
  const byClass = (re) => ids.filter((id) => re.test(wf[id].class_type));
  const warnings = [];

  const videoIds = tagged('video').length ? tagged('video') : byClass(/load.?video/i);
  const imageIds = tagged('image').length ? tagged('image') : byClass(/load.?image/i).filter((id) => !/mask/i.test(wf[id].class_type));
  const audioIds = tagged('audio').length ? tagged('audio') : byClass(/load.?audio/i);
  const loaders = new Set([...videoIds, ...imageIds, ...audioIds]);

  // The model node: the one with a prompt that draws on the most loaders (the longest prompt on a tie).
  const promptKey = (n) => endsWith(n, /(^|[._])(prompt|text|positive)$/i, isStr) && Object.keys(n.inputs).filter((k) => /(^|[._])(prompt|text|positive)$/i.test(k) && !/negative/i.test(k) && isStr(n.inputs[k]))[0];
  let modelId = tagged('model')[0] || tagged('prompt')[0];
  if (!modelId) {
    const cands = ids.filter((id) => promptKey(wf[id])).map((id) => {
      const anc = ancestors(wf, id);
      return { id, n: [...loaders].filter((l) => anc.has(l)).length, len: wf[id].inputs[promptKey(wf[id])].length };
    }).sort((a, b) => b.n - a.n || b.len - a.len);
    modelId = cands[0]?.id;
  }
  const model = modelId ? wf[modelId] : null;
  if (!model) warnings.push('no node with a prompt found: tag the model node by adding "@model" to its title');

  // Which input of the model each loader feeds (straight in, or through a chain such as trim > mute).
  const refOf = (loaderId) => {
    if (!model) return null;
    for (const [k, v] of Object.entries(model.inputs)) { const src = linkOf(wf, v); if (src && ancestors(wf, src).has(loaderId)) return { ref: k, direct: src === loaderId }; }
    return null;
  };
  const slot = (id, names) => { const n = wf[id], input = firstKey(n, names); return { node: id, class: n.class_type, input, value: n.inputs[input], ...refOf(id) }; };

  const images = imageIds.map((id) => ({ ...slot(id, ['image']), tag: tagOf(wf[id])[1] ? Number(tagOf(wf[id])[1]) : null }))
    .map((s, i) => ({ ...s, order: s.tag ?? (s.ref ? trailingNumber(s.ref) : null) ?? 1000 + i }))
    .sort((a, b) => a.order - b.order)
    .map(({ tag, order, ...s }, i) => ({ ...s, n: i + 1 }));
  if (videoIds.length > 1) warnings.push(`${videoIds.length} video loaders: using ${videoIds[0]} (tag the right one "@video")`);
  if (audioIds.length > 1) warnings.push(`${audioIds.length} audio loaders: using ${audioIds[0]} (tag the right one "@audio")`);

  const trimId = tagged('trim')[0] || ids.find((id) => /video.?slice|trim.?video|video.?trim/i.test(wf[id].class_type) && typeof wf[id].inputs.duration === 'number');
  const saveId = tagged('save')[0] || ids.find((id) => /save.?video|videocombine|save.?webm|save.?animated/i.test(wf[id].class_type) && isStr(wf[id].inputs.filename_prefix))
    || ids.find((id) => isStr(wf[id].inputs.filename_prefix));

  const settings = {};
  if (model) {
    const pick = (name, re, test) => { const k = endsWith(model, re, test); if (k) settings[name] = { node: modelId, input: k, value: model.inputs[k] }; };
    pick('duration', /(^|[._])(duration|length|seconds)$/i, (v) => typeof v === 'number');
    pick('ratio', /(^|[._])(aspect_)?ratio$/i, isStr);
    pick('resolution', /(^|[._])resolution$/i, isStr);
    pick('seed', /(^|[._])(noise_)?seed$/i, (v) => typeof v === 'number');
    pick('generateAudio', /(^|[._])generate_audio$/i, (v) => typeof v === 'boolean');
  }
  return {
    model: model ? { node: modelId, class: model.class_type } : null,
    prompt: model && promptKey(model) ? { node: modelId, input: promptKey(model), value: model.inputs[promptKey(model)] } : null,
    video: videoIds[0] ? slot(videoIds[0], ['file', 'video', 'path', 'video_path']) : null,
    images,
    audio: audioIds[0] ? slot(audioIds[0], ['audio', 'file', 'path']) : null,
    trim: trimId ? { node: trimId, class: wf[trimId].class_type, start: wf[trimId].inputs.start_time, duration: wf[trimId].inputs.duration } : null,
    settings,
    save: saveId ? { node: saveId, class: wf[saveId].class_type, input: 'filename_prefix', value: wf[saveId].inputs.filename_prefix } : null,
    warnings,
  };
}

/** The slots as lines of text. */
export function slotsText(s) {
  const q = (v) => JSON.stringify(v);
  const where = (x) => `node ${x.node}${x.class ? ` (${x.class})` : ''}${x.input ? `.${x.input}` : ''}`;
  const ref = (x) => (x.ref ? ` → ${x.ref}${x.direct ? '' : ' (through other nodes)'}` : ' → not wired to the model');
  const lines = [];
  lines.push(s.model ? `model:  node ${s.model.node} (${s.model.class})` : 'model:  not found');
  lines.push(s.video ? `video:  ${where(s.video)} = ${q(s.video.value)}${ref(s.video)}` : 'video:  no slot');
  if (s.trim) lines.push(`trim:   node ${s.trim.node} (${s.trim.class}) start ${s.trim.start ?? 0}s, duration ${s.trim.duration}s`);
  lines.push(s.images.length ? `images: ${s.images.length}` : 'images: no slot');
  for (const im of s.images) lines.push(`  image ${im.n}: ${where(im)} = ${q(im.value)}${ref(im)}`);
  lines.push(s.audio ? `audio:  ${where(s.audio)} = ${q(s.audio.value)}${ref(s.audio)}` : 'audio:  no slot');
  if (s.prompt) lines.push(`prompt: ${where(s.prompt)} (${s.prompt.value.length} characters)`);
  for (const [k, v] of Object.entries(s.settings)) lines.push(`${k}: ${where(v)} = ${q(v.value)}`);
  if (s.save) lines.push(`save:   ${where(s.save)} = ${q(s.save.value)}`);
  for (const w of s.warnings) lines.push(`warning: ${w}`);
  return lines.join('\n');
}

const consumers = (wf, id) => Object.entries(wf).flatMap(([nid, n]) => Object.entries(n.inputs).filter(([, v]) => linkOf(wf, v) === id).map(([k]) => ({ node: nid, input: k })));

/**
 * Fill a recipe. values: { video, images: [names], audio: name | 'none', prompt, duration, trim, start,
 * ratio, resolution, seed: number | 'new', prefix, set: { 'node.input': value } }. Anything left out keeps
 * the recipe's value. Returns { workflow, changes: [lines], warnings: [lines] }; the input is not touched.
 */
export function fillRecipe(recipe, values = {}) {
  const wf = structuredClone(recipe);
  const s = findSlots(wf);
  const changes = [], warnings = [...s.warnings];
  const need = (slot, what) => { if (!slot) throw new Error(`this workflow has no ${what} slot (see: recipe.mjs slots)`); return slot; };
  const put = (node, input, value, label) => { wf[node].inputs[input] = value; changes.push(`${label}: node ${node}.${input} = ${JSON.stringify(value).slice(0, 90)}`); };

  if (values.video != null) { const v = need(s.video, 'video'); put(v.node, v.input, values.video, 'video'); }

  if (values.images) {
    const want = values.images, have = s.images;
    if (want.length && !have.length) throw new Error('this workflow has no image slot to fill or copy');
    for (let i = 0; i < Math.min(want.length, have.length); i++) put(have[i].node, have[i].input, want[i], `image ${i + 1}`);
    for (const spare of have.slice(want.length)) { // fewer images than slots: take the spare ones out
      if (!spare.direct) throw new Error(`image slot ${spare.n} (node ${spare.node}) reaches the model through other nodes: remove it by hand`);
      delete wf[s.model.node].inputs[spare.ref];
      if (!consumers(wf, spare.node).length) delete wf[spare.node];
      changes.push(`image ${spare.n}: removed (node ${spare.node}, ${spare.ref})`);
    }
    const last = have[have.length - 1];
    for (let i = have.length; i < want.length; i++) { // more images than slots: copy the last slot
      if (!last?.direct || trailingNumber(last.ref) == null) throw new Error(`cannot add image ${i + 1}: the last image slot is not a numbered input wired straight into the model. Add a slot in ComfyUI and save the recipe again`);
      const ref = last.ref.replace(/\d+$/, String(trailingNumber(last.ref) + (i - have.length + 1)));
      let id = `image_${i + 1}`; while (wf[id]) id += '_';
      wf[id] = { ...structuredClone(wf[last.node]), inputs: { ...wf[last.node].inputs, [last.input]: want[i] } };
      wf[s.model.node].inputs[ref] = [id, wf[s.model.node].inputs[last.ref][1]];
      changes.push(`image ${i + 1}: added node ${id} → ${ref} = ${JSON.stringify(want[i])}`);
    }
  }

  if (values.audio != null) {
    const a = need(s.audio, 'audio');
    if (values.audio === 'none') {
      if (!a.direct) throw new Error(`the audio (node ${a.node}) reaches the model through other nodes: remove it by hand`);
      delete wf[s.model.node].inputs[a.ref];
      if (!consumers(wf, a.node).length) delete wf[a.node];
      changes.push(`audio: removed (node ${a.node}, ${a.ref})`);
    } else put(a.node, a.input, values.audio, 'audio');
  }

  if (values.prompt != null) { const p = need(s.prompt, 'prompt'); put(p.node, p.input, values.prompt, 'prompt'); }
  const setting = (name, value) => { if (value != null) { const x = need(s.settings[name], name); put(x.node, x.input, value, name); } };
  setting('duration', values.duration);
  setting('ratio', values.ratio);
  setting('resolution', values.resolution);
  setting('seed', values.seed === 'new' ? Math.floor(Math.random() * 2 ** 31) : values.seed);
  const trim = values.trim ?? values.duration;
  if (trim != null && s.trim) put(s.trim.node, 'duration', trim, 'trim');
  if (values.start != null) put(need(s.trim, 'trim').node, 'start_time', values.start, 'trim start');
  if (values.prefix != null) { const x = need(s.save, 'save'); put(x.node, x.input, values.prefix, 'save'); }
  for (const [k, v] of Object.entries(values.set || {})) {
    const dot = k.indexOf('.'), node = k.slice(0, dot), input = k.slice(dot + 1);
    if (dot < 1 || !wf[node]) throw new Error(`--set ${k}: no node "${node}" (use <node id>.<input name>)`);
    put(node, input, v, 'set');
  }

  // Does the prompt name references the graph does not have (or miss ones it has)?
  const after = findSlots(wf);
  const text = after.prompt?.value || '';
  const named = (kind) => new Set([...text.matchAll(new RegExp(`@${kind}_?(\\d+)`, 'gi'))].map((m) => Number(m[1])));
  for (const n of named('image')) if (n > after.images.length) warnings.push(`the prompt mentions @image_${n} but there ${after.images.length === 1 ? 'is 1 image' : `are ${after.images.length} images`}`);
  for (const im of after.images) if (text && !named('image').has(im.n) && /@image/i.test(text)) warnings.push(`image ${im.n} is loaded but the prompt never mentions @image_${im.n}`);
  if (named('audio').size && !after.audio) warnings.push('the prompt mentions @audio_1 but there is no audio');
  if (named('video').size && !after.video) warnings.push('the prompt mentions @video_1 but there is no video');
  const placeholders = [after.video, after.audio, ...after.images].filter((x) => x && /^REPLACE/i.test(String(x.value)));
  for (const x of placeholders) warnings.push(`node ${x.node}.${x.input} still holds the placeholder ${JSON.stringify(x.value)}`);
  if (/\[[A-Z][A-Z _-]+\]/.test(text)) warnings.push('the prompt still has [PLACEHOLDER] text in it');
  return { workflow: wf, changes, warnings, slots: after };
}

/** Recipes in a folder: every <name>.json that is an API-format workflow, with its notes file if any. */
export function listRecipes(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().flatMap((f) => {
    const file = path.join(dir, f);
    try {
      const s = findSlots(JSON.parse(fs.readFileSync(file, 'utf8')));
      const notes = file.replace(/\.json$/, '.md');
      return [{ name: f.replace(/\.json$/, ''), file, notes: fs.existsSync(notes) ? notes : null, model: s.model?.class || null, video: !!s.video, images: s.images.length, audio: !!s.audio }];
    } catch { return []; }
  });
}

/** Make scenes/renders/<scene>-<shot>-<date>-<time>/ and return its path. */
export function renderFolder(root, scene, shot, now = new Date()) {
  const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const dir = path.join(root, 'renders', [slug(scene) || 'scene', slug(shot) || 'shot', stamp].join('-'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------- command line ----------
function parse(argv) {
  const pos = [], flags = {};
  const many = new Set(['image', 'set']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
    const next = argv[i + 1];
    const val = eq > 0 ? a.slice(eq + 1) : next === undefined || next.startsWith('--') ? true : argv[++i];
    if (many.has(key)) (flags[key] ||= []).push(val); else flags[key] = val;
  }
  return { pos, flags };
}
const numArg = (v, name) => { if (v == null) return undefined; const n = Number(v); if (!Number.isFinite(n)) throw new Error(`--${name} needs a number, got "${v}"`); return n; };
const readJson = (file) => { if (!file) throw new Error('which workflow? pass a .json file'); return JSON.parse(fs.readFileSync(file, 'utf8')); };

const commands = {
  list({ flags }) {
    const mine = flags.root && flags.root !== true ? listRecipes(path.join(String(flags.root), 'recipes')) : [];
    const line = (r) => `  ${r.name}  (${r.model || 'no model node found'}; video ${r.video ? 'yes' : 'no'}, images ${r.images}, audio ${r.audio ? 'yes' : 'no'})\n    ${r.file}${r.notes ? `\n    notes: ${r.notes}` : ''}`;
    console.log([`your recipes${flags.root && flags.root !== true ? ` (${path.join(String(flags.root), 'recipes')})` : ' (pass --root <scene folder> to list them)'}:`, ...(mine.length ? mine.map(line) : ['  none yet']),
      'built in:', ...listRecipes(BUILTIN).map(line)].join('\n'));
  },
  slots({ pos, flags }) {
    const s = findSlots(readJson(pos[0]));
    console.log(flags.json ? JSON.stringify(s, null, 2) : slotsText(s));
  },
  fill({ pos, flags }) {
    if (!flags.out || flags.out === true) throw new Error('--out <file> is needed: the recipe itself is never changed');
    if (path.resolve(String(flags.out)) === path.resolve(pos[0] || '')) throw new Error('--out must be a different file: the recipe itself is never changed');
    const set = {};
    for (const kv of flags.set || []) { const eq = String(kv).indexOf('='); if (eq < 1) throw new Error(`--set needs node.input=value, got "${kv}"`); let v = kv.slice(eq + 1); try { v = JSON.parse(v); } catch {} set[kv.slice(0, eq)] = v; }
    const r = fillRecipe(readJson(pos[0]), {
      video: flags.video, images: flags.image, audio: flags.audio,
      prompt: flags['prompt-file'] ? fs.readFileSync(String(flags['prompt-file']), 'utf8').trim() : flags.prompt,
      duration: numArg(flags.duration, 'duration'), trim: numArg(flags.trim, 'trim'), start: numArg(flags.start, 'start'),
      ratio: flags.ratio, resolution: flags.resolution, seed: flags.seed === 'new' ? 'new' : numArg(flags.seed, 'seed'), prefix: flags.prefix, set,
    });
    fs.mkdirSync(path.dirname(path.resolve(String(flags.out))), { recursive: true });
    fs.writeFileSync(String(flags.out), JSON.stringify(r.workflow, null, 2) + '\n');
    console.log([`wrote ${flags.out}`, ...r.changes.map((c) => `  ${c}`), '', slotsText({ ...r.slots, warnings: [] }), ...r.warnings.map((w) => `warning: ${w}`)].join('\n'));
  },
  folder({ flags }) {
    if (!flags.root || flags.root === true) throw new Error('--root <scene folder> is needed (the folder that holds scene.json; see `canvas status`)');
    console.log(renderFolder(String(flags.root), flags.scene, flags.shot));
  },
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name = 'help', ...rest] = process.argv.slice(2);
  try {
    if (!commands[name]) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(name === 'help' ? 0 : 2); }
    commands[name](parse(rest));
  } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}
