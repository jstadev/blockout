// A question card in the chat (canvas ask): the agent's questions, one at a time. Choices are tappable
// rows, images drop in, text is a field, and an API key goes into a key block that saves it on this machine
// without sending it to the agent. When the last one is answered the card folds into a short summary and
// the answers go to the agent as one prompt.

import { h, icon } from './ui/kit.js';
import { asked, answerLabel } from '/core/ask.js';

/**
 * askCard(message, { answered, upload, post, context, onChange })
 *   message.ask   { id, title?, questions }
 *   answered      the prompt that answered it (from history), if any
 *   upload(file)  → uploaded file name (for image questions)
 *   post(route, body) → the server's JSON
 */
export function askCard(m, { answered = null, upload, post, context = () => ({}), onChange = () => {} } = {}) {
  const ask = m.ask;
  const el = h('div.chat-ask', { 'data-ask': ask.id });
  const answers = {};        // id -> { value | values | text | images | saved | skipped }
  const thumbs = {};         // id -> [{ file, url, pending, error }] for image questions
  let index = 0;
  let sending = false;
  let error = '';

  const fill = (...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  const list = () => ask.questions.filter((q) => asked(q, answers));
  const title = ask.title || 'A few questions';

  function done(prompt) {
    const a = prompt.answers || {};
    el.classList.add('is-done');
    fill(prompt.cancelled
      ? h('div.chat-ask-head', {}, h('span.chat-ask-title', {}, title), h('span.chat-ask-step', {}, 'Closed'))
      : h('div.chat-ask-head', {}, h('span.chat-ask-title', {}, title)),
    ...(prompt.cancelled ? [] : [h('dl.chat-ask-sum', {}, ...ask.questions.filter((q) => a[q.id]).flatMap((q) => [
      h('dt', {}, q.q),
      h('dd', {}, q.type === 'images' && a[q.id].images?.length
        ? h('span.chat-ask-thumbs', {}, ...a[q.id].images.map((f) => h('a.chat-ask-thumb', { href: f.url, target: '_blank', rel: 'noopener' }, h('img', { src: f.url, alt: '', loading: 'lazy' }))))
        : q.type === 'secret' && a[q.id].saved ? h('span.chat-ask-secret-ok', {}, icon('lock'), 'Saved on this machine')
        : answerLabel(q, a[q.id])),
    ]))]));
    onChange();
  }

  async function submit(cancelled = false) {
    if (sending) return;
    sending = true; error = ''; render();
    const res = await post('/api/ask/answer', { id: ask.id, answers, cancelled, context: context() }).catch((e) => ({ ok: false, error: e.message }));
    sending = false;
    if (res?.ok) return done(res.prompt);
    if (/already answered/.test(res?.error || '')) return; // the prompt event fills the card in
    error = res?.error || 'Could not send the answers. Try again.';
    render();
  }

  function next(answer) {
    const qs = list();
    answers[qs[index].id] = answer;
    // an answer can change which later questions are asked: drop answers to ones no longer asked
    const now = list();
    for (const id of Object.keys(answers)) if (!now.some((q) => q.id === id)) delete answers[id];
    if (index >= now.length - 1) return submit();
    index++; render(true);
  }

  // ---------- one question's answer area ----------
  function choice(q) {
    const cur = answers[q.id] || {};
    const picked = new Set(cur.values || (cur.value != null ? [cur.value] : []));
    const other = h('input.chat-ask-input', { type: 'text', placeholder: q.other, value: cur.text || '', 'aria-label': q.other, spellcheck: false });
    const go = () => {
      const text = other.value.trim();
      if (q.multi) return next({ values: [...picked], ...(text ? { text } : {}) });
      if (text) next({ text });
    };
    const cont = q.multi ? h('button.cc-btn.cc-btn--primary.chat-ask-go', { type: 'button', onClick: go }, 'Continue') : null;
    const sync = () => { if (cont) cont.disabled = !picked.size && !other.value.trim(); };
    const opts = q.options.map((o, i) => {
      const b = h(`button.chat-ask-opt${picked.has(o.value) ? '.is-on' : ''}`, { type: 'button', 'aria-pressed': picked.has(o.value) ? 'true' : 'false' },
        h('span.chat-ask-key', {}, q.multi ? icon('check') : String(i + 1)),
        h('span.chat-ask-opt-text', {}, h('span.chat-ask-opt-label', {}, o.label), o.note ? h('span.chat-ask-opt-note', {}, o.note) : null));
      b.addEventListener('click', () => {
        if (!q.multi) return next({ value: o.value });
        picked.has(o.value) ? picked.delete(o.value) : picked.add(o.value);
        b.classList.toggle('is-on', picked.has(o.value)); b.setAttribute('aria-pressed', picked.has(o.value));
        sync();
      });
      return b;
    });
    other.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
    other.addEventListener('input', sync);
    sync();
    const otherRow = q.other ? h('div.chat-ask-other', {}, other, q.multi ? null : h('button.cc-btn.cc-btn--ghost.cc-btn--icon', { type: 'button', title: 'Use this answer', 'aria-label': 'Use this answer', onClick: go }, icon('send'))) : null;
    return { body: [h('div.chat-ask-opts', {}, ...opts), otherRow], action: cont, focus: opts[0] };
  }

  function text(q) {
    const input = h('textarea.chat-ask-input.chat-ask-text', { rows: 2, placeholder: q.placeholder || 'Type your answer', spellcheck: false, 'aria-label': q.q });
    input.value = answers[q.id]?.text || '';
    const cont = h('button.cc-btn.cc-btn--primary.chat-ask-go', { type: 'button' }, 'Continue');
    const go = () => { const v = input.value.trim(); if (v) next({ text: v }); };
    const sync = () => { cont.disabled = !input.value.trim(); };
    cont.addEventListener('click', go);
    input.addEventListener('input', sync);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(); } });
    sync();
    return { body: [input], action: cont, focus: input };
  }

  function images(q) {
    const mine = (thumbs[q.id] ||= []);
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, hidden: true });
    const tray = h('div.chat-ask-tray');
    const cont = h('button.cc-btn.cc-btn--primary.chat-ask-go', { type: 'button' }, 'Continue');
    const drop = h('button.chat-ask-drop', { type: 'button' }, icon('image'), h('span', {}, `Add image${q.max === 1 ? '' : 's'}`), h('span.chat-ask-drop-note', {}, 'or drop or paste here'));
    const paint = () => {
      tray.replaceChildren(...mine.map((t) => h(`div.chat-thumb${t.pending ? '.is-pending' : ''}${t.error ? '.is-error' : ''}`, { title: t.error ? 'Upload failed' : '' },
        h('img', { src: t.url, alt: '' }), t.pending ? h('span.cc-spin') : null,
        h('button.chat-thumb-x', { type: 'button', title: 'Remove', 'aria-label': 'Remove image', onClick: () => { mine.splice(mine.indexOf(t), 1); paint(); } }, icon('close')))));
      tray.hidden = !mine.length;
      drop.hidden = mine.length >= q.max;
      cont.disabled = mine.some((t) => t.pending) || !mine.some((t) => t.file);
      onChange();
    };
    const add = async (files) => {
      for (const f of [...files].filter((x) => x.type?.startsWith('image/')).slice(0, q.max - mine.length)) {
        const t = { url: URL.createObjectURL(f), pending: true };
        mine.push(t); paint();
        try { t.file = await upload(f); } catch { t.error = true; }
        t.pending = false; paint();
      }
    };
    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { add(file.files); file.value = ''; });
    cont.addEventListener('click', () => next({ images: mine.filter((t) => t.file).map((t) => t.file) }));
    const zone = h('div.chat-ask-images', { tabindex: -1 }, tray, drop, file);
    zone.addEventListener('paste', (e) => { const fs_ = [...(e.clipboardData?.files || [])]; if (fs_.length) { e.preventDefault(); e.stopPropagation(); add(fs_); } });
    zone.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.stopPropagation(); zone.classList.add('is-drop'); } });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-drop'));
    zone.addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); e.stopPropagation(); zone.classList.remove('is-drop'); add(e.dataTransfer.files); });
    paint();
    return { body: [zone], action: cont, focus: zone };
  }

  // The key block. The value goes straight from this field to the server, which keeps it in a file in the
  // user's home folder. It is not put in the answers, the chat log or anything the agent reads.
  function secret(q) {
    const input = h('input.chat-ask-input.chat-ask-key-input', { type: 'password', placeholder: q.placeholder || 'Paste your key', autocomplete: 'off', spellcheck: false, 'aria-label': q.name });
    const save = h('button.cc-btn.cc-btn--primary.chat-ask-go', { type: 'button', disabled: true }, 'Save key');
    const keep = h('button.chat-ask-opt.chat-ask-keep', { type: 'button', hidden: true, onClick: () => next({ saved: true }) },
      h('span.chat-ask-key', {}, icon('check')), h('span.chat-ask-opt-text', {}, h('span.chat-ask-opt-label', {}, 'Use the key already saved'), h('span.chat-ask-opt-note', {}, 'Or paste a new one below to replace it.')));
    const note = h('div.chat-ask-private', {}, icon('lock'), h('span', {}, 'Stays on this machine. Your agent is told a key is saved, never what it is.'));
    const go = async () => {
      const value = input.value.trim();
      if (!value || save.disabled) return;
      save.disabled = true;
      const res = await post('/api/secret', { name: q.name, value }).catch((e) => ({ ok: false, error: e.message }));
      input.value = '';
      if (res?.ok) return next({ saved: true });
      error = res?.error || 'Could not save the key.'; render();
    };
    input.addEventListener('input', () => { save.disabled = !input.value.trim(); });
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); go(); } });
    save.addEventListener('click', go);
    fetch('/api/secrets').then((r) => r.json()).then((r) => { if (r.secrets?.some((s) => s.name === q.name)) { keep.hidden = false; onChange(); } }).catch(() => {});
    return { body: [keep, h('div.chat-ask-keyrow', {}, h('span.cc-mono.chat-ask-keyname', {}, q.name), input), note], action: save, focus: input };
  }

  // A text to check before it is used (the prompt for a render): read it, change it in place, or say what
  // to change. Feedback sends it back to the agent instead of approving it.
  function review(q) {
    const cur = answers[q.id] || {};
    const body = h('textarea.chat-ask-input.chat-ask-body', { spellcheck: false, 'aria-label': q.q });
    body.value = cur.text || q.body;
    const feedback = h('input.chat-ask-input', { type: 'text', placeholder: 'Or say what to change', value: cur.feedback || '', 'aria-label': 'What to change', spellcheck: false });
    const state = h('span.chat-ask-edited', { hidden: true }, 'Edited');
    const reset = h('button.cc-btn.cc-btn--ghost.chat-ask-reset', { type: 'button', hidden: true, onClick: () => { body.value = q.body; sync(); } }, 'Undo edits');
    const cont = h('button.cc-btn.cc-btn--primary.chat-ask-go', { type: 'button' });
    const changed = () => body.value.trim() !== q.body;
    function sync() {
      const fb = feedback.value.trim(), ed = changed();
      cont.textContent = fb ? 'Send feedback' : ed ? 'Use my edits' : 'Looks good';
      cont.disabled = !body.value.trim();
      state.hidden = reset.hidden = !ed;
    }
    const go = () => { if (!cont.disabled) next({ value: feedback.value.trim() ? 'feedback' : changed() ? 'edited' : 'approved', text: body.value, feedback: feedback.value.trim() }); };
    cont.addEventListener('click', go);
    body.addEventListener('input', sync);
    body.addEventListener('keydown', (e) => e.stopPropagation());
    feedback.addEventListener('input', sync);
    feedback.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
    sync();
    return { body: [h('div.chat-ask-review', {}, body, h('div.chat-ask-review-bar', {}, h('span', {}, `${q.body.split(/\s+/).length} words · click to edit`), h('span.cc-spacer'), state, reset)), feedback], action: cont, fixedLabel: true, focus: cont };
  }

  function render(focus = false) {
    const qs = list();
    index = Math.max(0, Math.min(index, qs.length - 1));
    const q = qs[index];
    const part = { choice, text, images, secret, review }[q.type](q);
    const last = index === qs.length - 1;
    if (part.action && last && q.type !== 'secret' && !part.fixedLabel) part.action.textContent = 'Send';
    if (part.action && sending) part.action.disabled = true;
    el.classList.toggle('is-sending', sending);
    fill(
      h('div.chat-ask-head', {},
        h('span.chat-ask-title', {}, title),
        qs.length > 1 ? h('span.chat-ask-step', {}, `${index + 1} of ${qs.length}`) : null,
        h('button.chat-ask-x', { type: 'button', title: 'Close without answering', 'aria-label': 'Close without answering', onClick: () => submit(true) }, icon('close'))),
      h('div.chat-ask-q', {}, q.q),
      q.note ? h('div.chat-ask-note', {}, q.note) : null,
      q.rows?.length ? h('dl.chat-ask-rows', {}, ...q.rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null,
      ...part.body,
      error ? h('div.chat-ask-error', { role: 'alert' }, error) : null,
      h('div.chat-ask-foot', {},
        index > 0 ? h('button.cc-btn.cc-btn--ghost.chat-ask-back', { type: 'button', onClick: () => { index--; error = ''; render(true); } }, icon('chevronLeft'), 'Back') : null,
        h('span.cc-spacer'),
        q.optional ? h('button.cc-btn.cc-btn--ghost.chat-ask-skip', { type: 'button', onClick: () => next({ skipped: true }) }, 'Skip') : null,
        part.action));
    error = '';
    if (focus) part.focus?.focus({ preventScroll: true });
    onChange();
  }

  // 1–9 pick an option while the card has focus
  el.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 9) { const b = el.querySelectorAll('.chat-ask-opts .chat-ask-opt')[n - 1]; if (b) { e.preventDefault(); e.stopPropagation(); b.click(); } }
  });

  if (answered) done(answered); else render();
  return { el, id: ask.id, done, focus: () => el.querySelector('.chat-ask-opt, .chat-ask-input, .chat-ask-drop')?.focus({ preventScroll: true }) };
}
