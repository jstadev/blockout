// The timeline's audio lane: one track for the whole sequence, as a waveform under the shots so camera
// moves and cuts can be paced to music or dialogue, an "Audio" button in the bar (load a file, or open the
// track's settings) and dropping an audio file anywhere on the timeline. Drag the clip sideways to slide it,
// drag either end to trim it, Alt/Option-drag to slip the audio inside the clip (Shift: off the frame grid);
// click to move the playhead. Everything changes the doc through the audio op.

import { h, button, number, affix, slider, toggle as onOff, panel, toast, icon } from './ui/kit.js';
import { store } from './store.js';
import { audio, trimOf } from './audio.js';

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm)$/i;
const fmtLen = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)} s`);

export function mountAudioTrack(root, { xA, aAt, axisEnd, scrubTo, marks, spans, playheadA, cutXs, keyXs }) {
  const track = () => store.doc?.audio || null;
  const op = (patch, label) => store.op({ op: 'audio', ...patch }, label).catch(() => {});

  // ---------- loading a file ----------
  const input = h('input', { type: 'file', accept: 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac', hidden: true });
  input.addEventListener('change', () => { const f = input.files?.[0]; input.value = ''; if (f) loadFile(f); });
  root.append(input);
  async function loadFile(f) {
    if (!AUDIO_EXT.test(f.name) && !f.type.startsWith('audio/')) return toast(`${f.name} is not an audio file (mp3, wav, m4a, aac, ogg, opus, flac)`, { kind: 'error' });
    const note = toast(`Loading ${f.name}…`, { ms: 60000 });
    try {
      const res = await fetch(`/api/audio?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
      const up = await res.json();
      if (!up.ok) throw new Error(up.error);
      await store.op({ op: 'audio', file: up.file, name: up.name }, track() ? 'replace audio' : 'load audio');
      const buf = await audio.load();
      note.remove();
      const n = store.doc.shots.length;
      toast(buf ? `Loaded ${f.name} (${fmtLen(buf.duration)}). It plays under ${n > 1 ? `all ${n} shots` : 'the shot'}: drag its ends to trim it, the middle to slide it.` : `Loaded ${f.name}`, { ms: 6000 });
    } catch (e) { note.remove(); toast(`Could not load ${f.name}: ${e.message}`, { kind: 'error' }); }
  }
  root.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) { e.preventDefault(); root.classList.add('is-drop'); } });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('is-drop'); });
  root.addEventListener('drop', (e) => {
    root.classList.remove('is-drop');
    const f = [...(e.dataTransfer?.files || [])][0];
    if (!f) return;
    e.preventDefault();
    loadFile(f);
  });

  // ---------- bar button ----------
  const btnLabel = h('span.tl-audio-name');
  const btn = h('button.cc-btn.tl-audiobtn', { type: 'button', onClick: () => (track() ? pop.toggle() : input.click()) }, icon('music'), btnLabel);

  // ---------- lane ----------
  // The lane runs on the action-time axis the shots share (xA: action time → px, aAt: px → action time).
  // The clip is the trimmed part of the file; what is trimmed away shows faintly either side of it.
  const lane = h('canvas.tl-audio', { hidden: true });
  const ctx = lane.getContext('2d');
  let drag = null; // { mode: 'slide'|'slip'|'in'|'out'|'scrub', x, a0: {offset, in, out}, live, moved }
  let hover = null;
  const fileLen = (a) => audio.buffer?.duration ?? a?.length ?? null;
  /** The track as it is drawn: the live values while dragging, else the doc's. */
  const live = () => {
    const a = track();
    if (!a) return null;
    const v = drag?.moved && drag.live ? drag.live : a;
    const len = fileLen(a), { inT, outT } = trimOf(v, len ?? undefined);
    return { a, offset: v.offset, inT, outT, len };
  };
  const F = () => store.doc.timeline.fps;
  /** Snap action time `t` to 0, the playhead or a shot's start or end within 7 px, else to a frame (Shift: free). */
  function snapA(t, e) {
    if (e?.shiftKey) return +t.toFixed(3);
    for (const m of marks()) if (Math.abs(xA(m) - xA(t)) < 7) return +m.toFixed(3);
    return +(Math.round(t * F()) / F()).toFixed(3);
  }
  /** What the pointer is over: a clip end (to trim), the clip (to slide), or neither (to scrub). */
  function hitAt(x) {
    const v = live();
    if (!v || !audio.peaks) return null;
    const left = xA(0), right = xA(axisEnd());
    const x0 = Math.max(left, xA(v.offset + v.inT)), x1 = v.outT === Infinity ? Infinity : Math.min(right, xA(v.offset + v.outT));
    if (Math.abs(x - x0) <= 5 && xA(v.offset + v.inT) >= left - 1) return 'in';
    if (x1 !== Infinity && Math.abs(x - x1) <= 5) return 'out';
    if (x > x0 && x < x1) return 'clip';
    return null;
  }

  lane.addEventListener('pointerdown', (e) => {
    const a = track();
    if (e.button !== 0 || !a) return;
    lane.setPointerCapture(e.pointerId);
    const hit = hitAt(e.offsetX);
    const v = live();
    const a0 = { offset: a.offset, in: v?.inT ?? 0, out: v && v.outT !== Infinity ? v.outT : null };
    const mode = hit === 'in' || hit === 'out' ? hit : hit === 'clip' ? (e.altKey && v?.len ? 'slip' : 'slide') : 'scrub';
    drag = { mode, x: e.offsetX, a0, live: null, moved: false };
    store.set({ playing: false });
    if (mode === 'scrub') { drag.moved = true; scrubTo(e.offsetX, e); }
  });
  lane.addEventListener('pointermove', (e) => {
    if (!drag) {
      const hit = hitAt(e.offsetX);
      if (hit !== hover) { hover = hit; lane.style.cursor = hit === 'in' || hit === 'out' ? 'ew-resize' : hit === 'clip' ? 'grab' : 'default'; draw(); }
      return;
    }
    if (drag.mode === 'scrub') return scrubTo(e.offsetX, e);
    const dx = e.offsetX - drag.x;
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true;
    const { a0 } = drag, f = 1 / F(), len = fileLen(track());
    const out0 = a0.out ?? len ?? Infinity;
    const at = aAt(e.offsetX), dA = at - aAt(drag.x);
    let { offset, in: inT, out } = a0;
    if (drag.mode === 'in') { // the clip's start; the rest stays where it is in the action
      const t = snapA(Math.max(a0.offset, at), e);
      inT = Math.max(0, Math.min(out0 - f, t - a0.offset));
    } else if (drag.mode === 'out') {
      const t = snapA(at, e);
      out = Math.max(a0.in + f, Math.min(len ?? Infinity, t - a0.offset));
    } else if (drag.mode === 'slide') { // the whole clip: its start snaps
      offset = snapA(a0.offset + a0.in + dA, e) - a0.in;
    } else { // slip (Alt): the clip stays put, the audio moves inside it
      let d = e.shiftKey ? dA : Math.round(dA * F()) / F();
      d = Math.max(out0 - len, Math.min(a0.in, d));
      offset = a0.offset + d; inT = a0.in - d; out = out0 - d;
    }
    drag.live = { offset: +offset.toFixed(3), in: +inT.toFixed(3), out: out == null || out === Infinity ? null : +out.toFixed(3) };
    draw(); pop.refresh();
  });
  lane.addEventListener('pointerup', (e) => {
    const d = drag; drag = null;
    if (!d) return;
    if (d.mode === 'scrub') return draw();
    if (!d.moved) { scrubTo(e.offsetX, e); return draw(); }
    const n = d.live, o = d.a0, ch = (x, y) => Math.abs((x ?? -1) - (y ?? -1)) > 1e-4;
    const patch = {};
    if (ch(n.offset, o.offset)) patch.offset = n.offset;
    if (ch(n.in, o.in)) patch.in = n.in > 0 ? n.in : null;
    if (ch(n.out, o.out)) patch.out = n.out;
    if (Object.keys(patch).length) op(patch, { in: 'trim audio start', out: 'trim audio end', slide: 'slide audio', slip: 'slip audio' }[d.mode]);
    draw();
  });
  lane.addEventListener('pointerleave', () => { if (hover && !drag) { hover = null; draw(); } });

  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function draw() {
    const v = live();
    if (!v || lane.hidden) return;
    const { a } = v;
    const dpr = devicePixelRatio || 1, W = lane.clientWidth, H = lane.clientHeight;
    if (!W || !H) return;
    if (lane.width !== Math.round(W * dpr) || lane.height !== Math.round(H * dpr)) { lane.width = Math.round(W * dpr); lane.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const dim = css('--cc-text-dim'), faint = css('--cc-text-faint'), text = css('--cc-text'), accent = css('--cc-accent'), line = css('--cc-line');
    const mid = H / 2, left = xA(0), right = Math.min(W - 1, xA(axisEnd()));
    ctx.font = `10px ${css('--cc-font')}`; ctx.textBaseline = 'middle';
    // the header column, when the shots have one: the track's name
    if (left > 40) {
      ctx.fillStyle = a.muted ? faint : dim;
      const nm = a.name.replace(/\.[a-z0-9]+$/i, '');
      let label = nm; while (label.length > 1 && ctx.measureText(label).width > left - 26) label = label.slice(0, -1);
      ctx.fillText(label === nm ? label : `${label.trimEnd()}…`, 8, mid);
      ctx.fillStyle = line; ctx.fillRect(left - 14, 0, 1, H);
    }
    // each shot's span of the action, so the audio can be lined up with the cuts
    ctx.fillStyle = text;
    for (const sp of spans()) {
      const x0 = xA(sp.a0), x1 = xA(sp.a1);
      if (sp.active) { ctx.globalAlpha = 0.05; ctx.fillRect(x0, 0, x1 - x0, H); }
      ctx.globalAlpha = 0.18; ctx.fillRect(Math.round(x0), 0, 1, H); ctx.fillRect(Math.round(x1), 0, 1, H);
    }
    ctx.globalAlpha = 1;
    const peaks = audio.peaks, PR = audio.PEAK_RATE;
    if (peaks) {
      const len = peaks.length / PR;
      const c0 = Math.max(left, xA(v.offset + v.inT)), c1 = Math.min(right, xA(v.offset + Math.min(v.outT, len)));
      // the clip: a raised block with handles at its ends
      if (c1 > c0) {
        ctx.fillStyle = css('--cc-surface-solid'); ctx.globalAlpha = 0.7;
        ctx.fillRect(c0, 2, c1 - c0, H - 4); ctx.globalAlpha = 1;
      }
      const active = drag?.moved && drag.mode !== 'scrub';
      for (let x = Math.ceil(left); x < right; x++) {
        const f0 = aAt(x) - v.offset, f1 = aAt(x + 1) - v.offset; // file time under this px
        if (f1 <= 0 || f0 >= len) continue;
        const i0 = Math.max(0, Math.floor(f0 * PR)), i1 = Math.min(peaks.length, Math.max(i0 + 1, Math.ceil(f1 * PR)));
        let m = 0; for (let i = i0; i < i1; i++) if (peaks[i] > m) m = peaks[i];
        const inClip = f1 > v.inT && f0 < v.outT;
        ctx.fillStyle = inClip && active ? text : dim; ctx.globalAlpha = inClip ? 0.8 : 0.18;
        const hh = Math.max(0.5, m * (mid - 4));
        ctx.fillRect(x, mid - hh, 1, hh * 2);
      }
      ctx.globalAlpha = 1;
      drawBeats(v, left, right, H);
      // trim handles: where the clip starts and ends (on the lane's edge when it runs past the axis)
      const hl = (x, side, on) => {
        ctx.fillStyle = on ? accent : text; ctx.globalAlpha = on ? 1 : 0.55;
        ctx.fillRect(Math.round(x) - (side === 'in' ? 0 : 2), 2, 2, H - 4);
        ctx.fillRect(Math.round(x) - (side === 'in' ? 0 : 5), 2, 5, 1.5); ctx.fillRect(Math.round(x) - (side === 'in' ? 0 : 5), H - 3.5, 5, 1.5);
        ctx.globalAlpha = 1;
      };
      const showIn = xA(v.offset + v.inT) >= left - 1, showOut = v.outT !== Infinity && xA(v.offset + Math.min(v.outT, len)) <= right + 1;
      if (c1 > c0) {
        if (showIn) hl(c0, 'in', hover === 'in' || drag?.mode === 'in');
        if (showOut) hl(c1, 'out', hover === 'out' || drag?.mode === 'out');
        else if (xA(v.offset + v.outT) > right) { ctx.fillStyle = dim; ctx.fillText('›', right - 8, mid); } // runs on past the axis
      }
    } else {
      ctx.fillStyle = faint;
      ctx.fillText(audio.error ? `Could not read ${a.name}: ${audio.error}` : `Reading ${a.name}…`, left + 6, mid);
    }
    if (a.muted) { ctx.fillStyle = css('--cc-surface-sunk'); ctx.globalAlpha = 0.55; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    // the active shot's camera keys as ticks and its cuts as lines, so beats can be lined up with them
    ctx.fillStyle = faint;
    for (const x of keyXs()) ctx.fillRect(Math.round(x), 0, 1, 3);
    ctx.fillStyle = text; ctx.globalAlpha = 0.5;
    for (const x of cutXs()) ctx.fillRect(Math.round(x) - 0.25, 0, 1.5, H);
    ctx.globalAlpha = 1;
    // playhead
    ctx.fillStyle = accent;
    ctx.fillRect(Math.round(xA(playheadA())), 0, 1.5, H);
    if (drag?.moved && drag.live) { // readout while editing
      const s2 = (t) => `${t < 0 ? '−' : ''}${Math.abs(t).toFixed(2)} s`;
      const label = drag.mode === 'in' ? `starts ${s2(v.offset + v.inT)} · ${v.inT.toFixed(2)} s into the file`
        : drag.mode === 'out' ? `ends ${s2(v.offset + v.outT)} · ${v.outT.toFixed(2)} s into the file`
          : drag.mode === 'slip' ? `plays ${v.inT.toFixed(2)}–${(v.outT === Infinity ? v.len ?? 0 : v.outT).toFixed(2)} s of the file`
            : `starts ${s2(v.offset + v.inT)}`;
      const w = ctx.measureText(label).width + 10, lx = Math.max(left + 4, Math.min(right - w - 4, (drag.mode === 'out' ? xA(v.offset + v.outT) - w - 6 : xA(v.offset + v.inT) + 6)));
      ctx.fillStyle = css('--cc-surface-solid'); ctx.fillRect(lx, mid - 7, w, 14);
      ctx.fillStyle = text; ctx.fillText(label, lx + 5, mid);
    }
  }
  /**
   * The beat grid, when the track shows it: an accent tick at the top and bottom of the lane on each beat,
   * a longer one where a bar starts. Ticks outside the clip are faint; when the beats are too close to
   * read, only the bars are drawn.
   */
  function drawBeats(v, left, right, H) {
    if (!v.a.beats) return;
    const g = audio.grid();
    if (!g || !g.times.length) return;
    const step = xA(v.offset + g.beat) - xA(v.offset);
    if (step * 4 < 8) return;
    const every = step < 6 ? 4 : 1;
    ctx.fillStyle = css('--cc-accent');
    const k0 = Math.max(0, Math.floor((aAt(left) - v.offset - g.times[0]) / g.beat) - 1);
    for (let k = k0; k < g.times.length; k++) {
      const t = g.times[k], x = Math.round(xA(v.offset + t));
      if (x > right) break;
      const bar = (((k - g.bar) % 4) + 4) % 4 === 0;
      if (x < left || (!bar && every > 1)) continue;
      const inClip = t >= v.inT - 1e-3 && t <= v.outT + 1e-3;
      const len = bar ? 7 : 4;
      ctx.globalAlpha = (inClip ? 1 : 0.3) * (bar ? 0.9 : 0.6);
      ctx.fillRect(x, 0, bar ? 1.5 : 1, len); ctx.fillRect(x, H - len, bar ? 1.5 : 1, len);
    }
    ctx.globalAlpha = 1;
  }
  new ResizeObserver(draw).observe(lane);
  audio.on(() => { draw(); pop.refresh(); });

  // ---------- settings popover ----------
  const pop = mountAudioSettings({ anchor: btn, replace: () => input.click(), op, live });

  function refresh() {
    const a = track();
    const show = !!a;
    if (lane.hidden === show) { lane.hidden = !show; document.body.classList.toggle('has-audio', show); }
    btnLabel.textContent = a ? a.name.replace(/\.[a-z0-9]+$/i, '') : 'Audio';
    btn.title = a ? `${a.name}${a.muted ? ' (muted)' : ''}: start, trim, volume, fit the shot, replace or remove` : 'Load a music or dialogue track to pace the shots to (one track under every shot, mixed into the export). You can also drop an audio file on the timeline.';
    btn.classList.toggle('is-muted', !!a?.muted);
    if (!a && pop.open) pop.toggle(false);
    draw(); pop.refresh();
  }
  return { btn, lane, refresh, draw, loadFile };
}

function mountAudioSettings({ anchor, replace, op, live }) {
  const track = () => store.doc?.audio || null;
  const name = h('span.audio-file.cc-mono');
  const offNum = number({ step: 0.05, min: -3600, max: 3600, precision: 3, width: 56, title: 'Where the file starts in the action (the shots\' shared time), in seconds. Negative skips into the file. Or drag the clip.', onChange: (v) => op({ offset: v }, 'audio start') });
  const inNum = number({ step: 0.05, min: 0, max: 7200, precision: 3, width: 56, title: 'Trim: the clip starts this far into the file. Or drag the clip\'s left end.', onChange: (v) => op({ in: v > 0 ? v : null }, 'trim audio start') });
  const outNum = number({ step: 0.05, min: 0, max: 7200, precision: 3, width: 56, title: 'Trim: the clip ends this far into the file. Or drag the clip\'s right end.', onChange: (v) => op({ out: v }, 'trim audio end') });
  const untrimBtn = button({ label: 'Untrim', title: 'Clear the trim: play the whole file', onClick: () => op({ in: null, out: null }, 'clear audio trim') });
  const vol = slider({ min: 0, max: 2, step: 0.05, value: 1, precision: 2, onChange: (v) => op({ volume: v }, 'audio volume') });
  const mute = onOff({ title: 'Mute in playback and the export', onChange: (v) => op({ muted: v }, v ? 'mute audio' : 'unmute audio') });
  const beats = onOff({ title: 'Mark the beats on the audio lane (a tick per beat, a longer one per bar), found from the file\'s tempo', onChange: (v) => op({ beats: v }, v ? 'show beats' : 'hide beats') });
  const bpm = h('span.cc-label.cc-mono.audio-bpm');
  const fitBtn = button({ label: 'Fit shot', title: 'Make this shot end where the audio ends', onClick: () => op({ fit: true }, 'fit shot to audio') });
  const replaceBtn = button({ label: 'Replace', title: 'Load another audio file', onClick: () => replace() });
  const removeBtn = button({ icon: 'trash', kind: 'ghost', title: 'Remove the audio track', onClick: () => op({ clear: true }, 'remove audio') });
  const foot = h('div.cc-label.cc-mono.shot-foot.audio-foot');

  const p = panel({ title: 'Audio', collapsible: false, actions: [button({ icon: 'close', kind: 'ghost', title: 'Close (Esc)', onClick: () => toggle(false) })] });
  p.classList.add('audio-pop');
  p.hidden = true;
  const rowEl = (label, ...c) => h('div.cc-row', {}, h('span.cc-label', {}, label), ...c);
  p.body.append(
    rowEl('File', name),
    rowEl('Starts at', affix(offNum, 's')),
    rowEl('Trim start', affix(inNum, 's')),
    rowEl('Trim end', affix(outNum, 's')),
    rowEl('Volume', vol),
    rowEl('Mute', mute),
    rowEl('Beats', beats, bpm),
    h('div.cc-row.audio-actions', {}, fitBtn, untrimBtn, replaceBtn, h('span.cc-spacer'), removeBtn),
    h('div.cc-divider.cc-divider--h'),
    foot,
  );
  document.body.append(p);

  const api = { open: false, toggle, refresh };
  function place() { const r = anchor.getBoundingClientRect(); p.style.right = `${Math.max(12, innerWidth - r.right)}px`; }
  function toggle(on = p.hidden) {
    api.open = on; p.hidden = !on;
    anchor.classList.toggle('is-open', on);
    if (on) { place(); refresh(); }
  }
  function refresh() {
    const a = track(), v = live();
    if (!api.open || !a || !v) return;
    name.textContent = a.name; name.title = `${a.name} (scene audio/${a.file})`;
    offNum.set(v.offset);
    const len = v.len;
    inNum.set(v.inT);
    outNum.set(v.outT === Infinity ? len ?? 0 : v.outT);
    outNum.disabled = !len;
    untrimBtn.disabled = !(a.in > 0 || a.out != null);
    vol.set(a.volume ?? 1);
    mute.set(!!a.muted);
    beats.set(!!a.beats);
    const g = a.beats ? audio.grid() : null;
    bpm.textContent = !a.beats ? '' : g ? `${Math.round(g.tempo)} bpm` : audio.gridFound === false ? 'no steady beat' : audio.error ? '' : 'finding…';
    fitBtn.disabled = !len;
    const n = store.doc.shots.length;
    const s2 = (t) => `${t < 0 ? '−' : ''}${Math.abs(t).toFixed(2)}`;
    foot.textContent = len
      ? `${fmtLen(len)} file · plays ${s2(v.offset + v.inT)}–${s2(v.offset + Math.min(v.outT, len))} s of the action${n > 1 ? `, across all ${n} shots` : ''}`
      : audio.error ? `could not read the file: ${audio.error}` : 'reading the file…';
  }
  addEventListener('pointerdown', (e) => { if (api.open && !p.contains(e.target) && !anchor.contains(e.target)) toggle(false); }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && api.open) { e.stopPropagation(); toggle(false); } }, true);
  addEventListener('resize', () => { if (api.open) place(); });
  return api;
}
