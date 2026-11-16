// Shots: one set, several cameras. The timeline bar's "+ Shot" adds a shot that picks up the action where
// the current one ends, with a copy of its camera; with two or more, the key track stacks them (one row per
// shot on the shared action-time axis, drawn and edited by timeline.js: drag a bar sideways to change where
// it picks up the action, up or down to reorder, click it and press Delete to remove it). [ and ] switch,
// Shift+[ and Shift+] move the active shot, "Play all" plays through the cuts, Shift-click Export renders
// the whole sequence. Everything goes through the shot.* ops, so the agent can do the same from the CLI.

import { button, toast } from './ui/kit.js';
import { store } from './store.js';

export function mountShots() {
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
    if (r) { store.set({ camDirty: false, time: 0 }); toast(`${r[0].name} picks up the action where the last shot ended, with a copy of its camera. Frame it and press K`); }
  };
  /** Move the active shot earlier (-1) or later (+1) in the sequence. */
  const move = (d) => {
    const i = store.doc.shots.findIndex((s) => s.id === store.doc.shot);
    const to = i + 1 + d;
    if (to >= 1 && to <= store.doc.shots.length) op({ op: 'shot.move', to }, 'reorder shots');
  };

  const addBtn = button({ icon: 'plus', label: 'Shot', kind: 'ghost', title: 'New shot: another camera on the same set, picking up the action where this one ends (Shift+N)', onClick: () => add() });
  const playAllBtn = button({ icon: 'layers', kind: 'ghost', title: 'Play all: playback runs on through the cuts into the next shot', onClick: () => store.set({ playAll: !store.state.playAll }) });

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
    if (!store.doc) return;
    playAllBtn.setActive(!!store.state.playAll);
    playAllBtn.style.display = store.doc.shots.length < 2 ? 'none' : ''; // .cc-btn sets display, so hidden would not hide it
  }

  return {
    addBtn, playAllBtn, refresh, add, use, playOn, move,
    next: (d) => {
      const s = store.doc.shots, i = s.findIndex((x) => x.id === store.doc.shot);
      const j = Math.max(0, Math.min(s.length - 1, i + d));
      if (j !== i) use(s[j].id);
    },
  };
}
