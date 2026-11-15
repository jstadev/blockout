// Shots: one set, several cameras. The timeline bar's "+ Shot" adds a shot that starts as a copy of this
// camera; with two or more, the key track stacks them (one row per shot on the shared action-time axis,
// drawn by timeline.js). Clicking the active shot's name there opens its settings here: name, where it
// picks up the shared action, order, delete, and Export all for the whole sequence. "Play all" plays
// through the cuts. Everything goes through the shot.* ops (and timeline start), so the agent can do the
// same from the CLI.

import { h, button, number, affix, text, panel, icon, toast } from './ui/kit.js';
import { store } from './store.js';
import { shotList } from '/core/doc.js';

export function mountShots({ exporter, anchor }) {
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

  // ---------- bar buttons ----------
  const addBtn = button({ icon: 'plus', label: 'Shot', kind: 'ghost', title: 'New shot: another camera on the same set, starting as a copy of this one (Shift+N)', onClick: () => add() });
  const playAllBtn = button({ icon: 'layers', kind: 'ghost', title: 'Play all: playback runs on through the cuts into the next shot', onClick: () => store.set({ playAll: !store.state.playAll }) });

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
  let at = null; // where the shot's name was clicked
  function place() {
    const r = anchor().getBoundingClientRect();
    p.style.left = `${Math.max(12, Math.min(innerWidth - p.offsetWidth - 12, (at ?? r.left) - 20))}px`;
  }
  function toggle(on = p.hidden, x = null) {
    p.hidden = !on;
    if (x != null) at = x;
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

  function refresh() {
    const doc = store.doc;
    if (!doc) return;
    const shots = shotList(doc);
    playAllBtn.setActive(!!store.state.playAll);
    playAllBtn.style.display = shots.length < 2 ? 'none' : ''; // .cc-btn sets display, so hidden would not hide it
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
  addEventListener('pointerdown', (e) => { if (!p.hidden && !p.contains(e.target) && e.target !== anchor()) toggle(false); }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !p.hidden) { e.stopPropagation(); toggle(false); } }, true);
  addEventListener('resize', () => { if (!p.hidden) place(); });

  return {
    addBtn, playAllBtn, refresh, add, use, playOn, toggle,
    next: (d) => {
      const s = store.doc.shots, i = s.findIndex((x) => x.id === store.doc.shot);
      const j = Math.max(0, Math.min(s.length - 1, i + d));
      if (j !== i) use(s[j].id);
    },
  };
}
