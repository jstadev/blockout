// Shots: one set, several cameras. A stack sits above the key track: one lane per shot on the shared
// action-time axis (the object moves show as dots on its ruler), each shot a bar from where it picks up
// the action, as long as the shot. Click a lane to edit that shot at that moment, drag a bar sideways to
// change where it picks up the action, double-click a name to rename it, + adds a shot that starts as a
// copy of this camera. Clicking the active shot's name opens its settings (order, delete, export the whole
// sequence). Lanes run top to bottom in sequence order; "Play all" plays through the cuts. Everything goes through the
// shot.* ops (and timeline start), so the agent can do the same from the CLI.

import { h, button, number, affix, text, panel, icon, toast } from './ui/kit.js';
import { store } from './store.js';
import { shotList } from '/core/doc.js';

export function mountShots({ exporter }) {
  const op = (ops, lbl) => store.op(ops, lbl).catch(() => null);
  // Switching is not an undo step of its own: undo goes back to the last change (and the shot it was made on).
  const switchTo = (id) => store.op({ op: 'shot.use', id }, 'switch shot', { amend: true }).catch(() => null);
  const use = async (id) => {
    if (id === store.doc.shot) return;
    store.set({ playing: false, key: null });
    if (await switchTo(id)) store.set({ camDirty: false, time: 0 });
  };
  const add = async () => {
    store.set({ playing: false, key: null });
    const r = await op({ op: 'shot.add' }, 'new shot');
    if (r) { store.set({ camDirty: false, time: 0 }); toast(`${r[0].name}: a copy of the last camera. Frame it and press K`); }
  };

  // ---------- stack: one lane per shot on the shared action-time axis ----------
  const playAllBtn = button({ icon: 'layers', kind: 'ghost', title: 'Play all: playback runs on through the cuts into the next shot', onClick: () => store.set({ playAll: !store.state.playAll }) });
  const addBtn = button({ icon: 'plus', kind: 'ghost', title: 'New shot: same set, a copy of this camera (Shift+N)', onClick: () => add() });
  const ruler = h('div.st-ruler');
  const head = h('div.st-row.st-head', {}, h('div.st-label', {}, h('span.st-title', {}, 'Shots'), h('span.cc-spacer'), playAllBtn, addBtn), ruler);
  const rows = h('div.st-rows');
  const playhead = h('div.st-playhead');
  const lanesBox = h('div.st-lanes', {}, playhead);
  const strip = h('div.st-stack', {}, head, rows, lanesBox);

  // the axis: action seconds from 0 to the end of the last shot or object move
  let T = 1;
  const axisEnd = (doc, shots) => {
    let end = 1;
    for (const x of shots) end = Math.max(end, (x.timeline.start || 0) + x.timeline.duration);
    for (const o of doc.objects) if (o.anim?.length) end = Math.max(end, o.anim[o.anim.length - 1].t);
    return end * 1.04;
  };
  const pctOf = (t) => `${(t / T) * 100}%`;
  const tOfX = (x, el) => { const r = el.getBoundingClientRect(); return ((x - r.left) / r.width) * T; };

  let drag = null; // { id, x0, start0, moved, lane, fps }
  let renaming = null;
  function laneRow(s, n) {
    const tl = s.timeline, start = tl.start || 0;
    const name = h('span.st-name', {}, s.name);
    const label = h(`div.st-label${s.active ? '.is-active' : ''}`, { title: s.active ? `${s.name}: on the key track below. Click for its settings, double-click to rename` : `Edit ${s.name}` },
      h('span.cc-mono.st-n', {}, String(n + 1)), name, h('span.cc-mono.st-dur', {}, `${tl.duration.toFixed(1)}s`));
    label.addEventListener('click', () => (s.active ? toggle() : use(s.id)));
    label.addEventListener('dblclick', () => rename(s, name));
    const bar = h(`div.st-bar${s.active ? '.is-active' : ''}`, { title: `${s.name}: drag sideways to change where it picks up the action (now ${start.toFixed(2)} s)${s.active ? '' : '; click to edit it'}` });
    bar.style.left = pctOf(start); bar.style.width = pctOf(tl.duration);
    for (const k of tl.keys) {
      if (k.t > tl.duration + 1e-6) continue;
      const d = h('span.st-key'); d.style.left = `${(k.t / tl.duration) * 100}%`; bar.append(d);
    }
    const lane = h(`div.st-lane${s.active ? '.is-active' : ''}`, {}, bar);
    // click a lane: edit that shot at that moment of the action
    lane.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const onBar = e.target.closest('.st-bar');
      drag = { id: s.id, x0: e.clientX, start0: start, moved: false, lane, onBar, fps: tl.fps, dur: tl.duration };
      lane.setPointerCapture(e.pointerId);
    });
    lane.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== s.id || !drag.onBar) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x0) < 4) return;
      drag.moved = true;
      const dt = tOfX(e.clientX, lane) - tOfX(drag.x0, lane);
      let st = Math.max(0, drag.start0 + dt);
      if (!e.shiftKey) st = Math.round(st * drag.fps) / drag.fps;
      drag.start = +st.toFixed(3);
      bar.style.left = pctOf(drag.start);
      bar.classList.add('is-dragging');
      bar.title = `picks up the action at ${drag.start.toFixed(2)} s`;
    });
    lane.addEventListener('pointerup', async (e) => {
      const d = drag; drag = null;
      if (!d || d.id !== s.id) return;
      if (d.moved) {
        bar.classList.remove('is-dragging');
        if (Math.abs((d.start ?? d.start0) - d.start0) > 1e-4) op({ op: 'timeline', start: d.start, shot: s.id }, 'shot action start');
        return;
      }
      const t = Math.max(0, Math.min(d.dur, tOfX(e.clientX, lane) - start));
      if (!s.active) await use(s.id);
      store.set({ time: Math.round(t * d.fps) / d.fps, playing: false, camDirty: false });
    });
    return { label, lane };
  }
  function rename(s, nameEl) {
    if (!p.hidden) toggle(false);
    const field = h('input.st-input', { type: 'text', value: s.name, spellcheck: false });
    renaming = s.id;
    const done = (save) => {
      if (renaming !== s.id) return;
      renaming = null;
      const v = field.value.trim();
      if (save && v && v !== s.name) op({ op: 'shot.update', id: s.id, name: v }, 'rename shot');
      sig = ''; refresh();
    };
    field.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    field.addEventListener('blur', () => done(true));
    field.addEventListener('click', (e) => e.stopPropagation());
    nameEl.replaceWith(field);
    field.focus(); field.select();
  }
  function drawRuler(doc) {
    const step = T > 30 ? 5 : T > 12 ? 2 : T > 5 ? 1 : 0.5;
    const ticks = [];
    for (let t = 0; t <= T + 1e-6; t += step) {
      const m = h('span.st-tick', {}, Number.isInteger(t) ? `${t}s` : '');
      m.style.left = pctOf(t); ticks.push(m);
    }
    // object moves: a dot per animation key (the selected object's in the accent colour)
    const sel = store.state.selection;
    for (const o of doc.objects) for (const k of o.anim || []) {
      const d = h(`span.st-okey${o.id === sel ? '.is-sel' : ''}`, { title: `${o.id} key at ${k.t} s of the action` });
      d.style.left = pctOf(k.t); ticks.push(d);
    }
    ruler.replaceChildren(...ticks);
  }

  // ---------- settings of the active shot (from clicking its block) ----------
  const nameField = text({ placeholder: 'Shot name', onChange: (v) => v.trim() && op({ op: 'shot.update', name: v.trim() }, 'rename shot') });
  const startNum = number({ step: 0.1, min: 0, max: 3600, precision: 2, width: 44, title: 'Where this shot picks up the action: how many seconds into the object moves its first frame is. Use it to cut from a wide to a close-up without replaying the action.', onChange: (v) => op({ op: 'timeline', start: +v.toFixed(3) }, 'shot action start') });
  const prevBtn = button({ icon: 'chevronUp', kind: 'ghost', title: 'Earlier in the sequence (up a lane)', onClick: () => move(-1) });
  const nextBtn = button({ icon: 'chevronDown', kind: 'ghost', title: 'Later in the sequence (down a lane)', onClick: () => move(1) });
  const delBtn = button({ icon: 'trash', kind: 'ghost', title: 'Delete this shot (the set stays)', onClick: () => { toggle(false); op({ op: 'shot.remove' }, 'delete shot'); } });
  const allBtn = button({ icon: 'film', label: 'Export all', title: 'Render every shot in order, cut together into one video', onClick: () => { toggle(false); exporter.exportVideo({ sequence: true }).catch((e) => toast(e.message, { kind: 'error' })); } });
  const foot = h('div.cc-label.cc-mono.shot-foot');
  const p = panel({ title: 'Shot', collapsible: false, actions: [button({ icon: 'close', kind: 'ghost', title: 'Close (Esc)', onClick: () => toggle(false) })] });
  p.classList.add('shots-pop');
  p.hidden = true;
  const rowEl = (lbl, ...c) => h('div.cc-row', {}, h('span.cc-label', {}, lbl), ...c);
  p.body.append(
    rowEl('Name', nameField),
    rowEl('Action from', affix(startNum, 's')),
    h('div.cc-row.shots-actions', {}, prevBtn, nextBtn, delBtn, h('span.cc-spacer'), allBtn),
    h('div.cc-divider.cc-divider--h'),
    foot,
  );
  document.body.append(p);

  function move(d) {
    const i = store.doc.shots.findIndex((s) => s.id === store.doc.shot);
    const to = i + 1 + d;
    if (to >= 1 && to <= store.doc.shots.length) op({ op: 'shot.move', to }, 'reorder shots');
  }
  const activeClip = () => rows.querySelector('.st-label.is-active');
  function place() {
    const r = (activeClip() || strip).getBoundingClientRect();
    p.style.left = `${Math.max(12, Math.min(innerWidth - p.offsetWidth - 12, r.left))}px`;
  }
  function toggle(on = p.hidden) {
    p.hidden = !on;
    activeClip()?.classList.toggle('is-open', on);
    if (on) { refresh(); place(); }
  }

  /** Playback reached the end of the shot with Play all on: go on into the next one. Resolves true if it did. */
  async function playOn() {
    const s = store.doc.shots, i = s.findIndex((x) => x.id === store.doc.shot);
    const next = s[i + 1] ?? (store.state.loop ? s[0] : null);
    if (!next || next.id === store.doc.shot) return false;
    if (!(await switchTo(next.id))) return false;
    store.set({ time: 0, camDirty: false, key: null });
    return true;
  }

  let sig = '', height = 0;
  function refresh() {
    const doc = store.doc;
    if (!doc) return;
    const shots = shotList(doc);
    const s = JSON.stringify([shots.map((x) => [x.id, x.name, x.active, x.timeline.duration, x.timeline.start, x.timeline.keys.map((k) => k.t)]), doc.objects.map((o) => o.anim?.map((k) => k.t)), store.state.selection]);
    if (s !== sig && !renaming && !drag) {
      sig = s;
      T = axisEnd(doc, shots);
      const built = shots.map(laneRow);
      rows.replaceChildren(...built.map((b) => b.label));
      lanesBox.replaceChildren(...built.map((b) => b.lane), playhead);
      drawRuler(doc);
      if (!p.hidden) { activeClip()?.classList.add('is-open'); place(); }
      // the timeline grows by the stack's height
      const hgt = strip.offsetHeight;
      if (hgt && hgt !== height) { height = hgt; document.documentElement.style.setProperty('--stack-h', `${hgt + 4}px`); }
    }
    playhead.style.left = pctOf((doc.timeline.start || 0) + Math.min(store.state.time, doc.timeline.duration));
    playAllBtn.setActive(!!store.state.playAll);
    playAllBtn.disabled = shots.length < 2;
    if (p.hidden) return;
    const i = shots.findIndex((x) => x.active), cur = shots[i];
    if (document.activeElement !== nameField) nameField.value = cur.name;
    startNum.set(doc.timeline.start || 0);
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === shots.length - 1;
    delBtn.disabled = shots.length < 2;
    allBtn.disabled = store.state.exporting;
    const total = shots.reduce((t, x) => t + x.timeline.duration, 0);
    foot.textContent = `shot ${i + 1} of ${shots.length} · sequence ${total.toFixed(2)} s`;
  }
  addEventListener('pointerdown', (e) => { if (!p.hidden && !p.contains(e.target) && !activeClip()?.contains(e.target)) toggle(false); }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !p.hidden) { e.stopPropagation(); toggle(false); } }, true);
  addEventListener('resize', () => { if (!p.hidden) place(); });

  return {
    strip, refresh, add, playOn, toggle,
    next: (d) => {
      const s = store.doc.shots, i = s.findIndex((x) => x.id === store.doc.shot);
      const j = Math.max(0, Math.min(s.length - 1, i + d));
      if (j !== i) use(s[j].id);
    },
  };
}
