// Camera moves: a popover of preset moves (pan, orbit, dolly zoom ...) next to the Key button.
// Applying one sends a cam.move op: a key at the playhead carrying the move's path and ease, and a key where
// the move ends. Both stay ordinary keys, so the move can be dragged, re-keyed and eased like any other.

import { h, button, number, select, affix, panel, toast } from './ui/kit.js';
import { EASES } from '/core/curves.js';
import { store } from './store.js';

// Glyphs on a 64 px grid: faint = context (ghost frame, ground), cam = the camera, main = the motion.
const cam = (x, y) => `M${x - 4} ${y - 3}h8v6h-8z`;
const G = {
  pan: { cam: cam(32, 48), faint: 'M32 45 L12 24 L24 16 Z', main: 'M32 45 L40 16 L52 24 Z M18 11 Q32 3 46 11 M46 11 l-5 -1 M46 11 l-1 -5' },
  tilt: { cam: cam(12, 44), faint: 'M14 44 L52 36 L52 52 Z M4 58 H60', main: 'M14 44 L42 12 L54 22 M56 42 Q62 28 54 16 M54 16 l0 5 M54 16 l5 2' },
  orbit: { cam: cam(32, 46), sub: [32, 28], faint: 'M14 28 a18 18 0 1 0 36 0 a18 18 0 1 0 -36 0', main: 'M36 46 A18 18 0 0 0 50 32 M50 32 l-5 2 M50 32 l1 -5', dash: true },
  push: { cam: cam(32, 52), sub: [32, 13], faint: 'M32 49 L22 26 L42 26 Z', main: 'M32 42 V22 M32 22 l-4 5 M32 22 l4 5' },
  truck: { cam: cam(18, 46), sub: [32, 12], faint: 'M18 43 L10 22 L26 22 Z M46 43 L38 22 L54 22 Z', main: 'M12 56 H52 M52 56 l-5 -4 M52 56 l-5 4' },
  crane: { cam: cam(20, 16), sub: [50, 50], faint: 'M16 50 h8 v6 h-8 z M22 18 L56 38 L46 54 Z M4 60 H60', main: 'M8 48 V20 M8 20 l-4 5 M8 20 l4 5' },
  pedestal: { cam: cam(20, 16), faint: 'M16 50 h8 v6 h-8 z M22 16 L56 8 L56 24 Z M4 60 H60', main: 'M8 48 V20 M8 20 l-4 5 M8 20 l4 5' },
  zoom: { cam: cam(32, 54), sub: [32, 22], faint: 'M32 51 L8 12 L56 12 Z', main: 'M32 51 L26 12 L38 12 Z' },
  dollyZoom: { cam: cam(32, 34), sub: [32, 12], faint: 'M32 58 L25 12 L39 12 Z', main: 'M32 31 L20 12 L44 12 Z M52 56 V34 M52 34 l-4 5 M52 34 l4 5' },
  roll: { faint: 'M12 18 H52 V46 H12 Z', main: 'M16.3 13.3 L54.9 23.7 L47.7 50.7 L9.1 40.3 Z' },
};
export function moveSvg(name, size = 28) {
  const g = G[name] || {};
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
    + (g.faint ? `<path d="${g.faint}" stroke="currentColor" stroke-opacity=".35" stroke-width="2.5"${g.dash ? ' stroke-dasharray="4 4"' : ''}/>` : '')
    + (g.sub ? `<circle cx="${g.sub[0]}" cy="${g.sub[1]}" r="5" fill="currentColor" fill-opacity=".45"/>` : '')
    + (g.cam ? `<path d="${g.cam}" fill="currentColor"/>` : '')
    + (g.main ? `<path d="${g.main}" stroke="currentColor" stroke-width="3.5"/>` : '')
    + '</svg>';
}

// What each move asks for. amount: the main number (its op field, unit, default, step, range, sign hint).
const MOVES = [
  { id: 'pan', label: 'Pan', help: 'Turn left or right on the spot.', amount: { field: 'angle', unit: '°', value: 45, step: 5, min: -360, max: 360, title: 'Degrees; positive pans right' } },
  { id: 'tilt', label: 'Tilt', help: 'Turn up or down on the spot.', amount: { field: 'angle', unit: '°', value: 20, step: 5, min: -89, max: 89, title: 'Degrees; positive tilts up' } },
  { id: 'orbit', label: 'Orbit', help: 'Circle round the subject, keeping it in frame.', amount: { field: 'angle', unit: '°', value: 90, step: 15, min: -720, max: 720, title: 'Degrees; positive orbits to the right' }, around: true, rise: true },
  { id: 'push', label: 'Push in', help: 'Dolly toward the subject. Negative pulls out.', amount: { field: 'by', unit: 'm', value: 2, step: 0.5, min: -100, max: 100, title: 'Metres toward the aim; negative pulls out' } },
  { id: 'truck', label: 'Truck', help: 'Slide sideways; camera and aim move together.', amount: { field: 'by', unit: 'm', value: 2, step: 0.5, min: -100, max: 100, title: 'Metres; positive trucks right' } },
  { id: 'crane', label: 'Crane', help: 'Rise or drop, keeping the subject framed.', amount: { field: 'by', unit: 'm', value: 2, step: 0.5, min: -50, max: 50, title: 'Metres; positive rises' } },
  { id: 'pedestal', label: 'Pedestal', help: 'Rise or drop, camera and aim together.', amount: { field: 'by', unit: 'm', value: 1.5, step: 0.5, min: -50, max: 50, title: 'Metres; positive rises' } },
  { id: 'zoom', label: 'Zoom', help: 'Change the lens; the camera stays put.', amount: { field: 'lens', unit: 'mm', value: 85, step: 5, min: 8, max: 300, precision: 0, title: 'The lens to end on (mm)' } },
  { id: 'dollyZoom', label: 'Dolly zoom', help: 'Push in while widening the lens, so the subject keeps its size and the background stretches.', amount: { field: 'by', unit: 'm', value: 3, step: 0.5, min: -100, max: 100, title: 'Metres toward the aim; negative pulls out and tightens' } },
  { id: 'roll', label: 'Dutch', help: 'Tilt the horizon.', amount: { field: 'angle', unit: '°', value: 15, step: 5, min: -180, max: 180, title: 'Degrees; positive rolls clockwise' } },
];

export function mountMoves({ anchor, viewport, onApplied }) {
  let cur = MOVES[2];
  const amounts = Object.fromEntries(MOVES.map((m) => [m.id, m.amount.value]));
  let over = 3, ease = 'easeInOut', rise = 0, around = '';

  const tiles = MOVES.map((m) => {
    const b = h('button.cc-btn.moves-tile', { type: 'button', title: m.help, onClick: () => { cur = m; refresh(); } });
    b.innerHTML = moveSvg(m.id, 26);
    b.append(h('span', {}, m.label));
    b.dataset.move = m.id;
    return b;
  });
  const help = h('div.cc-label.moves-help');
  // one field per move, so each keeps its own range, step and value
  const amountFields = Object.fromEntries(MOVES.map((m) => {
    const a = m.amount;
    const n = number({ value: a.value, step: a.step, min: a.min, max: a.max, precision: a.precision ?? 2, width: 48, title: a.title, onChange: (v) => { amounts[m.id] = v; } });
    return [m.id, affix(n, a.unit)];
  }));
  const amountLabel = h('span.cc-label');
  const aroundSel = select({ options: [], title: 'What to orbit round: an object, or the point the camera is aiming at', onChange: (v) => { around = v; } });
  const riseNum = number({ value: 0, step: 0.25, min: -50, max: 50, precision: 2, width: 48, title: 'Metres to rise (or drop) over the orbit', onChange: (v) => { rise = v; } });
  const overNum = number({ value: over, step: 0.25, min: 0.05, max: 600, precision: 2, width: 48, title: 'How long the move takes, from the playhead', onChange: (v) => { over = v; } });
  const easeSel = select({ options: Object.keys(EASES).filter((n) => n !== 'hold'), value: ease, title: 'How the move speeds up and slows down (change it later in the curve editor)', onChange: (v) => { ease = v; } });
  const from = h('span.cc-mono.moves-from');
  const applyBtn = button({ label: 'Apply', kind: 'primary', title: 'Key the move from the playhead', onClick: () => apply() });

  const rowEl = (label, ...c) => h('div.cc-row', {}, typeof label === 'string' ? h('span.cc-label', {}, label) : label, ...c);
  const aroundRow = rowEl('Around', aroundSel);
  const riseRow = rowEl('Rise', affix(riseNum, 'm'));
  const p = panel({ title: 'Moves', collapsible: false, actions: [button({ icon: 'close', kind: 'ghost', title: 'Close (Esc)', onClick: () => toggle(false) })] });
  p.classList.add('moves-pop');
  p.hidden = true;
  p.body.append(
    h('div.moves-grid', {}, ...tiles),
    help,
    rowEl(amountLabel, ...Object.values(amountFields)),
    aroundRow, riseRow,
    rowEl('Length', affix(overNum, 's')),
    rowEl('Ease', easeSel),
    h('div.cc-divider.cc-divider--h'),
    h('div.cc-row', {}, from, h('span.cc-spacer'), applyBtn),
  );
  document.body.append(p);

  const api = { open: false, toggle, refresh };
  function place() {
    const r = anchor.getBoundingClientRect();
    p.style.left = `${Math.max(12, Math.min(r.left, innerWidth - 300))}px`;
  }
  function toggle(on = p.hidden) {
    api.open = on; p.hidden = !on;
    anchor.classList.toggle('is-open', on);
    if (on) {
      // orbit round the selected object by default
      if (store.state.selection && store.object(store.state.selection)) around = store.state.selection;
      place(); refresh();
    }
  }
  function refresh() {
    if (!api.open || !store.doc) return;
    for (const t of tiles) t.classList.toggle('is-active', t.dataset.move === cur.id);
    help.textContent = cur.help;
    const a = cur.amount;
    amountLabel.textContent = a.field === 'angle' ? 'Angle' : a.field === 'lens' ? 'Lens' : 'Distance';
    for (const [id, f] of Object.entries(amountFields)) f.style.display = id === cur.id ? '' : 'none';
    aroundRow.style.display = cur.around ? '' : 'none';
    riseRow.style.display = cur.rise ? '' : 'none';
    const objs = store.doc.objects.map((o) => o.id);
    if (around && !objs.includes(around)) around = '';
    // rebuild only when the objects change: refresh runs every frame while playing, and rebuilding closes the select
    const key = objs.join('|');
    if (aroundSel._objs !== key) {
      aroundSel._objs = key;
      aroundSel.replaceChildren(h('option', { value: '' }, 'Aim point'), ...objs.map((id) => h('option', { value: id }, id)));
    }
    if (document.activeElement !== aroundSel) aroundSel.value = around;
    riseNum.set(rise);
    overNum.set(over);
    easeSel.value = ease;
    const t = store.state.time;
    from.textContent = `${t.toFixed(2)} → ${(t + over).toFixed(2)} s`;
    from.title = 'From the playhead, starting on the camera\'s framing there';
  }
  async function apply() {
    const t = +store.state.time.toFixed(3);
    const op = { op: 'cam.move', move: cur.id, t, over: +over.toFixed(3), ease, [cur.amount.field]: amounts[cur.id] };
    if (cur.around && around) op.around = around;
    if (cur.rise && rise) op.rise = rise;
    // start from the view when there is nothing keyed yet, or the shot camera was framed by hand
    if (!store.doc.timeline.keys.length || (store.state.view === 'shot' && store.state.camDirty)) {
      const pose = viewport.getPose();
      op.from = { position: pose.position, target: pose.target, fov: pose.fov };
    }
    try {
      const [r] = await store.op(op, `camera move: ${cur.label.toLowerCase()}`);
      store.set({ key: r.keys[0], camDirty: false });
      toast(`${cur.label} from ${r.from.toFixed(2)} to ${r.to.toFixed(2)} s`);
      onApplied?.(r);
    } catch {}
  }
  addEventListener('pointerdown', (e) => { if (api.open && !p.contains(e.target) && !anchor.contains(e.target)) toggle(false); }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && api.open) { e.stopPropagation(); toggle(false); } }, true);
  addEventListener('resize', () => { if (api.open) place(); });
  return api;
}
