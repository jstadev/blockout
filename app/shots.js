// Shots: one set, several cameras. A thin sequence strip sits above the key track: one block per shot,
// end to end, as wide as the shot is long, like the clips of an edit. Click a block to put that shot on
// the key track below, drag it to reorder, double-click to rename, + adds a shot that starts as a copy of
// this camera. Clicking the active block opens its settings (name, where it picks up the shared action,
// delete, export the whole sequence). "Play all" plays through the cuts. Everything goes through the
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

  // ---------- strip ----------
  const playAllBtn = button({ icon: 'layers', kind: 'ghost', title: 'Play all: playback runs on through the cuts into the next shot', onClick: () => store.set({ playAll: !store.state.playAll }) });
  const clips = h('div.tl-clips');
  const addBtn = button({ icon: 'plus', kind: 'ghost', title: 'New shot: same set, a copy of this camera (Shift+N)', onClick: () => add() });
  const strip = h('div.tl-strip', {}, playAllBtn, clips, addBtn);

  let drag = null; // { id, x0, moved, to }
  let renaming = null;
  function clipEl(s, n) {
    const head = h('span.tl-clip-head');
    const name = h('span.tl-clip-name', {}, s.name);
    const el = h(`div.tl-clip${s.active ? '.is-active' : ''}`, { role: 'button', tabIndex: 0, 'data-id': s.id, title: s.active ? `${s.name}: on the key track. Click for its settings, drag to reorder, double-click to rename` : `${s.name} (${s.timeline.duration.toFixed(2)} s): click to edit it` },
      h('span.cc-mono.tl-clip-n', {}, String(n + 1)), name, h('span.cc-mono.tl-clip-dur', {}, `${s.timeline.duration.toFixed(1)}s`), head);
    el.style.flexGrow = String(Math.max(0.05, s.timeline.duration));
    el.head = head;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || renaming) return;
      drag = { id: s.id, x0: e.clientX, moved: false, to: null };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== s.id) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x0) < 5) return;
      drag.moved = true;
      el.classList.add('is-dragging');
      // drop position: the gap nearest the pointer
      const els = [...clips.children];
      let to = els.length;
      for (const [i, c] of els.entries()) { const r = c.getBoundingClientRect(); if (e.clientX < r.left + r.width / 2) { to = i; break; } }
      drag.to = to;
      els.forEach((c, i) => { c.classList.toggle('drop-before', i === to); c.classList.toggle('drop-after', to === els.length && i === els.length - 1); });
    });
    el.addEventListener('pointerup', () => {
      const d = drag; drag = null;
      [...clips.children].forEach((c) => c.classList.remove('drop-before', 'drop-after', 'is-dragging'));
      if (!d || d.id !== s.id) return;
      if (d.moved) {
        const from = store.doc.shots.findIndex((x) => x.id === s.id);
        const to = d.to > from ? d.to : d.to + 1; // position (1-based) once the block is taken out
        if (d.to != null && to !== from + 1) op({ op: 'shot.move', id: s.id, to }, 'reorder shots');
        return;
      }
      if (s.active) toggle(); else use(s.id);
    });
    el.addEventListener('dblclick', () => rename(s, name));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); s.active ? toggle() : use(s.id); } });
    return el;
  }
  function rename(s, nameEl) {
    if (p && !p.hidden) toggle(false);
    const field = h('input.tl-clip-input', { type: 'text', value: s.name, spellcheck: false });
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
    field.addEventListener('pointerdown', (e) => e.stopPropagation());
    nameEl.replaceWith(field);
    field.focus(); field.select();
  }

  // ---------- settings of the active shot (from clicking its block) ----------
  const nameField = text({ placeholder: 'Shot name', onChange: (v) => v.trim() && op({ op: 'shot.update', name: v.trim() }, 'rename shot') });
  const startNum = number({ step: 0.1, min: 0, max: 3600, precision: 2, width: 44, title: 'Where this shot picks up the action: how many seconds into the object moves its first frame is. Use it to cut from a wide to a close-up without replaying the action.', onChange: (v) => op({ op: 'timeline', start: +v.toFixed(3) }, 'shot action start') });
  const prevBtn = button({ icon: 'chevronUp', kind: 'ghost', title: 'Earlier in the sequence (or drag the block)', onClick: () => move(-1) });
  const nextBtn = button({ icon: 'chevronDown', kind: 'ghost', title: 'Later in the sequence (or drag the block)', onClick: () => move(1) });
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
  const activeClip = () => clips.querySelector('.tl-clip.is-active');
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

  let sig = '';
  function refresh() {
    const doc = store.doc;
    if (!doc) return;
    const shots = shotList(doc);
    const s = JSON.stringify(shots.map((x) => [x.id, x.name, x.active, x.timeline.duration]));
    if (s !== sig && !renaming && !drag) {
      sig = s;
      clips.replaceChildren(...shots.map(clipEl));
      if (!p.hidden) { activeClip()?.classList.add('is-open'); place(); }
    }
    const a = activeClip();
    if (a) a.head.style.left = `${Math.min(100, (store.state.time / Math.max(1e-6, doc.timeline.duration)) * 100)}%`;
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
