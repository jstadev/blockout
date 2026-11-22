// Question cards: the agent asks in the chat (canvas ask), the tab shows the questions one at a time,
// and the answers come back to the agent as one prompt. Shared by the server, the CLI and the browser.
//
// A card: { title?, questions: [question, …] }. A question:
//   { id, q, note?, type: 'choice' | 'text' | 'images' | 'secret' | 'review',
//     options?: [{ value, label, note? }], multi?, other?,   choice: pick one (or several); other = a free-text option
//     placeholder?,                                          text
//     max?,                                                  images: how many (default 4)
//     name?,                                                 secret: the name it is saved under (COMFY_API_KEY)
//     body,                                                  review: a text to read (a prompt, a script). The user
//                                                            approves it, edits it in place, or writes feedback
//     rows?: [[label, value], …],                            a short summary shown above the answer area
//     optional?,                                             adds Skip
//     when?: { <question id>: value | [values] } }           only asked when an earlier answer matches
//
// A secret's value never comes back in the answers: the tab saves it on the machine and the agent is told
// only that it is there.

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const TYPES = ['choice', 'text', 'images', 'secret', 'review'];
const BODY_MAX = 20000;
const indent = (t) => t.split('\n').map((l) => `  | ${l}`).join('\n');
const str = (v, max = 400) => String(v ?? '').trim().slice(0, max);

export function normalizeAsk(input) {
  const src = Array.isArray(input) ? { questions: input } : input?.questions ? input : input?.q ? { questions: [input] } : null;
  if (!src || !Array.isArray(src.questions) || !src.questions.length) throw new Error('a question card needs { questions: [{ id, q, … }] }');
  if (src.questions.length > 12) throw new Error('at most 12 questions on one card');
  const ids = new Set();
  const questions = src.questions.map((raw, i) => {
    const q = typeof raw === 'string' ? { q: raw } : raw || {};
    const out = { id: str(q.id || `q${i + 1}`, 40), q: str(q.q || q.question) };
    if (!out.q) throw new Error(`question ${i + 1} has no text (q)`);
    if (!/^[\w-]+$/.test(out.id)) throw new Error(`question id "${out.id}" must be letters, digits, - or _`);
    if (ids.has(out.id)) throw new Error(`two questions share the id "${out.id}"`);
    ids.add(out.id);
    out.type = q.type || (q.options ? 'choice' : q.name ? 'secret' : q.body != null ? 'review' : 'text');
    if (out.type === 'image') out.type = 'images';
    if (out.type === 'confirm') out.type = 'choice';
    if (!TYPES.includes(out.type)) throw new Error(`question "${out.id}": type must be one of ${TYPES.join(', ')}`);
    if (q.note) out.note = str(q.note);
    if (q.optional) out.optional = true;
    if (Array.isArray(q.rows)) out.rows = q.rows.slice(0, 8).map((r) => (Array.isArray(r) ? [str(r[0], 30), str(r[1], 120)] : [str(r.label, 30), str(r.value, 120)]));
    if (out.type === 'choice') {
      out.options = (q.options || []).slice(0, 8).map((o) => {
        const opt = typeof o === 'string' ? { label: o } : o || {};
        const label = str(opt.label ?? opt.value, 80);
        if (!label) throw new Error(`question "${out.id}" has an option with no label`);
        return { value: str(opt.value ?? label, 80), label, ...(opt.note ? { note: str(opt.note, 160) } : {}) };
      });
      if (q.other) out.other = q.other === true ? 'Something else' : str(q.other, 60);
      if (out.options.length + (out.other ? 1 : 0) < 2) throw new Error(`question "${out.id}" needs at least two options (or one and "other")`);
      if (q.multi) out.multi = true;
    }
    if (out.type === 'text' && q.placeholder) out.placeholder = str(q.placeholder, 120);
    if (out.type === 'images') out.max = Math.max(1, Math.min(8, Number(q.max) || 4));
    if (out.type === 'review') {
      out.body = String(q.body ?? '').replace(/\r\n/g, '\n').trim();
      if (!out.body) throw new Error(`question "${out.id}": a review needs the text to show (body, or file with canvas ask)`);
      if (out.body.length > BODY_MAX) throw new Error(`question "${out.id}": the text to review is over ${BODY_MAX} characters`);
    }
    if (out.type === 'secret') {
      out.name = str(q.name, 64);
      if (!SECRET_NAME.test(out.name)) throw new Error(`question "${out.id}": a secret needs a name like COMFY_API_KEY`);
      if (q.placeholder) out.placeholder = str(q.placeholder, 60);
    }
    if (q.when && typeof q.when === 'object') {
      for (const k of Object.keys(q.when)) if (!ids.has(k) || k === out.id) throw new Error(`question "${out.id}": when refers to "${k}", which is not an earlier question`);
      out.when = Object.fromEntries(Object.entries(q.when).map(([k, v]) => [k, (Array.isArray(v) ? v : [v]).map((x) => String(x))]));
    }
    return out;
  });
  return { ...(src.title ? { title: str(src.title, 80) } : {}), questions };
}

/** Is this question asked, given the answers so far? */
export function asked(q, answers = {}) {
  if (!q.when) return true;
  return Object.entries(q.when).every(([id, want]) => {
    const a = answers[id];
    if (!a || a.skipped) return false;
    const got = a.values || (a.value != null ? [a.value] : []);
    return got.some((v) => want.includes(String(v)));
  });
}

/** One answer in a few words, for the card's summary and the agent. Never a secret's value. */
export function answerLabel(q, a) {
  if (!a || a.skipped) return 'Skipped';
  if (q.type === 'choice') {
    const label = (v) => q.options.find((o) => o.value === v)?.label ?? v;
    const picked = (a.values || (a.value != null ? [a.value] : [])).map(label);
    if (a.text) picked.push(a.text);
    return picked.join(', ') || 'Skipped';
  }
  if (q.type === 'images') return `${a.images?.length || 0} image${a.images?.length === 1 ? '' : 's'}`;
  if (q.type === 'secret') return a.saved ? 'Saved on this machine' : 'Skipped';
  if (q.type === 'review') return a.value === 'feedback' ? `Asked for changes: ${a.feedback}` : a.value === 'edited' ? 'Approved with your edits' : 'Approved';
  return a.text || 'Skipped';
}

/**
 * Check the tab's answers against the card and write them out for the agent.
 * `image(file)` maps an uploaded file name to { file, url, path } (or null if it is not there).
 */
export function answerAsk(ask, raw = {}, cancelled = false, image = () => null) {
  const answers = {}, images = [];
  const title = ask.title || ask.questions[0].q;
  if (cancelled) return { answers, images, text: `Closed the questions "${title}" without answering. Ask what they want instead, in plain words.` };
  const lines = [];
  for (const q of ask.questions) {
    if (!asked(q, answers)) continue;
    const r = raw[q.id] || {};
    let a;
    if (r.skipped || !raw[q.id]) a = { skipped: true };
    else if (q.type === 'choice') {
      const vals = (Array.isArray(r.values) ? r.values : r.value != null ? [r.value] : []).map(String).filter((v) => q.options.some((o) => o.value === v));
      const text = q.other ? str(r.text, 2000) : '';
      a = !vals.length && !text ? { skipped: true } : q.multi ? { values: vals, ...(text ? { text } : {}) } : text ? { text } : { value: vals[0] };
    } else if (q.type === 'images') {
      const files = (Array.isArray(r.images) ? r.images : []).map(image).filter(Boolean).slice(0, q.max);
      a = files.length ? { images: files } : { skipped: true };
      images.push(...files);
    } else if (q.type === 'secret') a = r.saved ? { saved: true, name: q.name } : { skipped: true };
    else if (q.type === 'review') {
      // value: approved (as shown), edited (their text replaces it) or feedback (not approved: revise and show again)
      const feedback = str(r.feedback, 4000);
      const body = String(r.text ?? '').replace(/\r\n/g, '\n').trim().slice(0, BODY_MAX);
      const changed = !!body && body !== q.body;
      a = { value: feedback ? 'feedback' : changed ? 'edited' : 'approved', ...(feedback ? { feedback } : {}), ...(changed ? { text: body } : {}) };
    }
    else { const text = str(r.text, 4000); a = text ? { text } : { skipped: true }; }
    answers[q.id] = a;
    let line = `- ${q.id} (${q.q}): `;
    if (a.skipped) line += 'skipped';
    else if (q.type === 'choice') line += [...(a.values || (a.value != null ? [a.value] : [])).map((v) => { const o = q.options.find((x) => x.value === v); return o.label === v ? v : `${o.label} [${v}]`; }), ...(a.text ? [`"${a.text}"`] : [])].join(', ');
    else if (q.type === 'images') line += a.images.map((f) => f.path).join(' | ');
    else if (q.type === 'review') line += a.value === 'feedback' ? `NOT approved. Feedback: "${a.feedback}"${a.text ? '\n  They also edited the text. Start from their version:\n' + indent(a.text) : ''}\n  Revise it and show it for review again.`
      : a.value === 'edited' ? `approved with their edits. Use exactly this text:\n${indent(a.text)}` : 'approved as shown';
    else if (q.type === 'secret') line += `${q.name} is saved on this machine. Its value is not shown to you. Use it with: canvas secret run ${q.name} -- <command>`;
    else line += a.text;
    lines.push(line);
  }
  return { answers, images, text: `Answers to "${title}":\n${lines.join('\n')}` };
}
