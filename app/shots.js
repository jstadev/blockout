// Shots: one set, several cameras. A "Shots" button in the timeline bar names the active shot and opens
// a list of the scene's shots in sequence order: click one to switch, + adds a shot that starts as a copy
// of this one's camera, and the active shot can be renamed, moved, deleted or told where it picks up the
// shared action. "Export all" renders every shot in order into one video. Everything goes through the
// shot.* ops (and timeline start), so the agent can do the same from the CLI.

import { h, button, number, affix, text, panel, icon, toast } from './ui/kit.js';
import { store } from './store.js';
import { shotList } from '/core/doc.js';

export function mountShots({ exporter }) {
  const label = h('span');
  const btn = h('button.cc-btn.tl-shots', { type: 'button', onClick: () => toggle() }, icon('camera'), label, icon('chevronDown'));

  const op = (ops, lbl) => store.op(ops, lbl).catch(() => null);
  const use = async (id) => {
    if (id === store.doc.shot) return;
    store.set({ playing: false, key: null });
    // not an undo step of its own: undo goes back to the last change (and the shot it was made on)
    if (await store.op({ op: 'shot.use', id }, 'switch shot', { amend: true }).catch(() => null)) store.set({ camDirty: false });
  };
  const add = async () => {
    store.set({ playing: false, key: null });
    const r = await op({ op: 'shot.add' }, 'new shot');
    if (r) { store.set({ camDirty: false }); toast(`${r[0].name}: a copy of the last camera. Frame it and press K`); }
  };

  const list = h('div.shots-list');
  const nameField = text({ placeholder: 'Shot name', onChange: (v) => v.trim() && op({ op: 'shot.update', name: v.trim() }, 'rename shot') });
  const startNum = number({ step: 0.1, min: 0, max: 3600, precision: 2, width: 44, title: 'Where this shot picks up the action: how many seconds into the object moves its first frame is. Use it to cut from a wide to a close-up without replaying the action.', onChange: (v) => op({ op: 'timeline', start: +v.toFixed(3) }, 'shot action start') });
  const upBtn = button({ icon: 'chevronUp', kind: 'ghost', title: 'Earlier in the sequence', onClick: () => move(-1) });
  const downBtn = button({ icon: 'chevronDown', kind: 'ghost', title: 'Later in the sequence', onClick: () => move(1) });
  const delBtn = button({ icon: 'trash', kind: 'ghost', title: 'Delete this shot (the set stays)', onClick: () => op({ op: 'shot.remove' }, 'delete shot') });
  const allBtn = button({ icon: 'film', label: 'Export all', title: 'Render every shot in order, cut together into one video', onClick: () => { toggle(false); exporter.exportVideo({ sequence: true }).catch((e) => toast(e.message, { kind: 'error' })); } });
  const foot = h('div.cc-label.cc-mono.shot-foot');

  const p = panel({ title: 'Shots', collapsible: false, actions: [
    button({ icon: 'plus', kind: 'ghost', title: 'New shot: same set, a copy of this camera (Shift+N)', onClick: () => add() }),
    button({ icon: 'close', kind: 'ghost', title: 'Close (Esc)', onClick: () => toggle(false) }),
  ] });
  p.classList.add('shots-pop');
  p.hidden = true;
  const rowEl = (lbl, ...c) => h('div.cc-row', {}, h('span.cc-label', {}, lbl), ...c);
  p.body.append(
    list,
    h('div.cc-divider.cc-divider--h'),
    rowEl('Name', nameField),
    rowEl('Action from', affix(startNum, 's')),
    h('div.cc-row.shots-actions', {}, upBtn, downBtn, delBtn, h('span.cc-spacer'), allBtn),
    foot,
  );
  document.body.append(p);

  function move(d) {
    const i = store.doc.shots.findIndex((s) => s.id === store.doc.shot);
    const to = i + 1 + d;
    if (to >= 1 && to <= store.doc.shots.length) op({ op: 'shot.move', to }, 'reorder shots');
  }

  const api = { open: false, toggle, refresh, btn, add, next: (d) => {
    const s = store.doc.shots, i = s.findIndex((x) => x.id === store.doc.shot);
    const j = Math.max(0, Math.min(s.length - 1, i + d));
    if (j !== i) use(s[j].id);
  } };
  function place() { const r = btn.getBoundingClientRect(); p.style.right = `${Math.max(12, innerWidth - r.right)}px`; }
  function toggle(on = p.hidden) {
    api.open = on; p.hidden = !on;
    btn.classList.toggle('is-open', on);
    btn.replaceChild(icon(on ? 'chevronUp' : 'chevronDown'), btn.lastElementChild);
    if (on) { place(); refresh(); }
  }

  let sig = '';
  function refresh() {
    const doc = store.doc;
    if (!doc) return;
    const shots = shotList(doc);
    const i = shots.findIndex((s) => s.active), cur = shots[i];
    label.textContent = shots.length > 1 ? `${i + 1}/${shots.length} ${cur.name}` : cur.name;
    btn.title = `Shots: ${shots.length > 1 ? `${shots.length} cameras on this set, on ${cur.name}. [ and ] switch` : 'add more cameras on the same set'}`;
    if (!api.open) return;
    const s = JSON.stringify(shots.map((x) => [x.id, x.name, x.active, x.timeline.duration, x.timeline.keys.length]));
    if (s !== sig) {
      sig = s;
      list.replaceChildren(...shots.map((x, n) => h(`button.shots-item${x.active ? '.is-active' : ''}`, { type: 'button', title: x.active ? 'The shot on the timeline' : `Switch to ${x.name}`, onClick: () => use(x.id) },
        h('span.cc-mono.shots-n', {}, String(n + 1)),
        h('span.shots-name', {}, x.name),
        h('span.cc-mono.shots-dur', {}, `${x.timeline.duration.toFixed(1)} s`))));
    }
    if (document.activeElement !== nameField) nameField.value = cur.name;
    startNum.set(doc.timeline.start || 0);
    upBtn.disabled = i === 0;
    downBtn.disabled = i === shots.length - 1;
    delBtn.disabled = shots.length < 2;
    allBtn.disabled = store.state.exporting;
    const total = shots.reduce((t, x) => t + x.timeline.duration, 0);
    foot.textContent = shots.length > 1 ? `sequence: ${shots.length} shots · ${total.toFixed(2)} s` : 'one shot · + adds another camera on this set';
  }
  addEventListener('pointerdown', (e) => { if (api.open && !p.contains(e.target) && !btn.contains(e.target)) toggle(false); }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && api.open) { e.stopPropagation(); toggle(false); } }, true);
  addEventListener('resize', () => { if (api.open) place(); });
  return api;
}
