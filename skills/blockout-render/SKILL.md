---
name: blockout-render
description: Turn a Blockout export (the whole timeline, every shot, as one reference video) into a finished video by running a ComfyUI reference-to-video workflow (Seedance 2.5 or any saved "recipe") on Comfy Cloud or the user's local ComfyUI. Use only when the user asks to render, generate or "run through Comfy / Seedance" a Blockout timeline or shot, asks for another take of a render, or asks to save or adapt a ComfyUI workflow for Blockout. Not for building the scene or camera (that is camera-canvas), and not for general ComfyUI work.
---

# Blockout render

An optional step after the blockout: the export of the **whole timeline** (every shot, cut together, as
`canvas export` makes it) goes into a ComfyUI reference-to-video workflow as one motion reference, next to the user's reference images and audio, and a finished video comes back into
the Blockout chat. Blockout itself has no ComfyUI code. You do the adapting, with the ComfyUI tools the
user already has.

You need the `camera-canvas` skill for every `canvas` command below (`node bin/canvas.mjs …`, or `canvas …`
from the plugin). This skill's own helper is `scripts/recipe.mjs` in this folder; it only reads and writes
workflow JSON and never talks to ComfyUI.

## The rules

1. **Nothing that spends credits runs before the user says go**, and nothing is submitted with a prompt
   the user has not seen. The confirm card (step 4) shows the full prompt for review, then asks; the go
   is its Render answer. Uploading inputs, validating and estimating are free and can happen before.
   Partner models such as Seedance bill Comfy credits even when the graph runs on the user's own machine.
2. **Ask with question cards, not paragraphs.** Whatever you need from the user goes on a `canvas ask`
   card (references/questions.md): one short question at a time, choices they can tap. Chat replies in
   this flow are one or two lines. Never post the plan as a block of text.
3. **Never edit a recipe in place.** Fill a copy into the render folder (`recipe.mjs fill --out`).
4. **The prompt's times come from `canvas brief`, not from memory or from watching the video.**
5. **Keep the seed** unless the user asks for another take, so a re-run changes only what they changed.
6. **Save every render with what made it**: the filled workflow, the prompt, the brief and the inputs.
7. **You never see an API key.** Use the sign-in the tools already hold. When a tool needs a key, ask for
   it with a key block (`"type": "secret"`), which saves it on the user's machine, and pass it with
   `canvas secret run NAME -- <command>`. Never ask for a key in words, read the secrets file or echo one.
8. If no ComfyUI tool is connected, say what to set up (references/running.md) and stop. Do not write your
   own client for the ComfyUI API.

## Flow

### 1. Gather

The request usually comes from **Render with Comfy**, in the menu on the Export button's caret. It opens the chat
with "Render this timeline with ComfyUI (blockout-render skill)." started. Most people send just that, so
expect to ask for the rest. A request typed by hand is the same thing.

Work out everything you can without asking, in this order: what the request says, files attached to it,
`renders/settings.json`, the brief, what is connected. Then put only what is still open on **one question
card** (references/questions.md has the card to start from): what sets the look and the images for it,
which model when the recipe offers more than one, where to run when both cloud and local are connected,
and a key block when the runner needs a key that `canvas secret list` does not show. If nothing is open,
skip the card. Do the free work (export, brief, render folder) while the user answers.


- What to render: **the whole timeline, all shots, as one reference video and one render.** The shots are
  one piece: the model gets the cuts from the blockout and the prompt, so the people, the set and the look
  stay the same across them. Never plan a render per shot, never ask which shot, and never offer to
  render shots separately or to merge them: the timeline is already one video. Render a single shot only
  when the user asks for that shot by name ("render just shot 2"); then use `--shot <id>` everywhere
  below in place of the timeline.
- The reference images: the files attached to the canvas prompt or to the card's answers (their paths are
  in the prompt), or paths the user gives. Open each one so you know what it shows. Ask which is which
  only if you cannot tell. No images is fine: the prompt then carries the look.
- Where things live: `canvas status` prints `scene: <path>`; that file's folder is the **scene folder**.
  Recipes are in `<scene folder>/recipes/`, renders go to `<scene folder>/renders/`.

### 2. Brief and export

```bash
node bin/canvas.mjs brief --timeline      # every shot in order with its cuts: moves, framings, moving objects, audio
node bin/canvas.mjs export                # the blockout mp4 of the whole timeline, with the audio; prints its path
```

`brief --timeline` gives every time in **seconds of the exported video**, with a `CUT at <t>s` line where
each shot starts. Those are the times the prompt uses. `--json` has every number. For beat times add
`--beats`: it covers the shot the tab is on, so for a timeline with music switch to each shot in turn
(`canvas shot <id>`, then `brief --timeline --beats`) and keep the beat lines, which are already in video
time. Make the render folder and keep both there:

```bash
node <skill>/scripts/recipe.mjs folder --root <scene folder> --scene <scene name> --shot timeline
# -> <scene folder>/renders/<scene>-timeline-<date>-<time>/   copy the export in as blockout.mp4, the brief as brief.txt
```

If the scene has audio, the export already carries it, laid out exactly as the timeline plays it. Take the
audio slot from the export, not from the source file:
`ffmpeg -i <render folder>/blockout.mp4 -vn -c copy <render folder>/audio.m4a` (re-encode if `-c copy`
fails). No audio in the export: fill with `--audio none`.

### 3. Pick a recipe and fill it

```bash
node <skill>/scripts/recipe.mjs list --root <scene folder>     # the user's recipes, then the built-in ones
node <skill>/scripts/recipe.mjs slots <recipe.json>            # where video, images, audio, prompt and settings go
```

Use the recipe the user names, else their last one (`renders/settings.json`), else
`seedance-2.5-reference`. Read the recipe's `.md` notes if it has them. How slots are found, how to save a
new recipe and what to do when a graph does not fit: references/recipes.md.

Write the prompt to `<render folder>/prompt.txt`: read the recipe's example prompt in full
(`<recipe>.prompt.txt`, shown by `recipe.mjs list`) and adapt it to this shot at the same level of detail,
following references/prompt.md. Then upload the inputs
(step 5 explains where; uploading is free) and fill a copy with the names the upload returned:

```bash
node <skill>/scripts/recipe.mjs fill <recipe.json> --out <render folder>/workflow.json \
  --video <uploaded blockout name> --image <uploaded image 1> --image <uploaded image 2> \
  --audio <uploaded audio name | none> --prompt-file <render folder>/prompt.txt \
  --duration <whole seconds> --ratio <ratio from the brief> --prefix blockout/<scene>/timeline
```

Images go in the order the prompt names them (`@image_1`, `@image_2`, …). Fewer images than the recipe has
slots removes the spare ones; more adds slots. `fill` prints every change and warns when the prompt names a
reference the graph does not have, or a placeholder is left. Fix every warning before the plan.

Duration: the timeline's length rounded up to a whole second, within what the model allows (the recipe
notes, or ask the node: `get_node` / `comfy nodes show <class>`).

- Shorter than the model's minimum: render the minimum, say in the prompt that the camera holds on the
  last framing after the timeline ends, and trim the result back to the timeline's length afterwards. Do
  this without asking; note it in one row of the confirm card (`["Length", "4s, trimmed to 2.94s"]`).
- Longer than the model's maximum: it cannot be one render. Ask once, with a card: shorten the timeline,
  or render it in parts split at cuts (cut `blockout.mp4` at the brief's cut times with ffmpeg, one prompt
  per part with times restarting at 0, each part costing its own credits).

### 4. Review the prompt, confirm, then wait for go

Ask with a confirm card and end your turn (or `canvas wait`). It has two steps: the full prompt to review,
then the plan as `rows` (at most five, a few words each, no tags, paths or seeds) with the Render button.

```json
{ "title": "Render with Comfy", "questions": [
  { "id": "prompt", "q": "Check the prompt", "type": "review", "file": "<render folder>/prompt.txt",
    "note": "This is what the model gets. Edit it here, or say what to change." },
  { "id": "go", "q": "Ready to render the timeline?", "when": { "prompt": ["approved", "edited"] },
  "rows": [["Video", "<n> shots · <length>s"], ["Look", "<2 images: her, the room | from the prompt>"],
           ["Audio", "<track>, <from>–<to>s | none"], ["Output", "<resolution> · <ratio> · <model>"],
           ["Cost", "about <n> credits | no estimate"]],
  "options": [{ "value": "go", "label": "Render", "note": "Spends about <n> credits." }, "Not yet"],
  "other": "Change something" } ] }
```

The prompt answer comes back as one of three:

- `approved as shown`: use `prompt.txt` as it is.
- `approved with their edits`: write their text to `prompt.txt` exactly, refill with it, and run `fill`'s
  checks. Do not reword it. If an edit broke a reference tag or a time from the brief, say which in one
  line and show the card again rather than fixing it silently.
- `NOT approved. Feedback: …`: the Render step was not shown. Revise `prompt.txt` (from their edited text
  if they changed it), refill, and show the same card again. Keep the brief's times unless they ask
  for a different move, which is a camera change (see Follow-ups).

Show the whole prompt every time it changes, and never a summary of it. A re-run with the same prompt
(another take) can skip the review step.

Only `go` is a go. A typed change: make it, refill, and show the card again. "Not yet" or a closed card:
reply in one line that it is ready when they are. Add a row only for something the user would not expect
(the model renders 4s for a 2.94s timeline: `["Length", "4s, trimmed to 2.94s"]`). Everything else about
the run is in the render folder, not in the chat.

Get the cost from `estimate_credits` when the cloud MCP is connected; otherwise the row says no estimate.
Never invent a number, and give one figure for the chosen model, not a range across models. A workflow
with no paid nodes on the user's own GPU is free: the card is still shown, unless they have told you to
skip it for free local runs (keep that in `renders/settings.json`).

### 5. Run

Where: what the user says in the request ("on my machine", "on cloud"), else `renders/settings.json`, else
whatever is connected, in this order: Comfy Cloud MCP, local `comfy-mcp`, `comfy` CLI. The steps are the
same everywhere: upload the inputs, validate, submit the filled workflow, wait, download the video.
Tool names and commands for each: references/running.md.

Show the job on a progress card from the moment the user says go, and keep it true until the video is in
the chat:

```bash
ID=$(node bin/canvas.mjs progress "Rendering on Comfy Cloud" --steps "Upload|Queue|Render|Download" --eta <seconds>)
node bin/canvas.mjs progress --id $ID --step 2                 # submitted, waiting in the queue
node bin/canvas.mjs progress --id $ID --step 3 --pct 40        # running; --pct only when the job reports one
node bin/canvas.mjs progress --id $ID --step 4                 # downloading the result
node bin/canvas.mjs progress --id $ID --done "Rendered in 3m 40s"      # or: --fail "<what went wrong, in plain words>"
```

- The card counts the elapsed time by itself, so it stays alive between your updates. Update it when the
  stage changes, not on a timer.
- Do not block on one long wait. Poll the job (`get_job_status`, `comfy --json jobs status <id>`, or
  `wait_for_job` with a short timeout) every 15 to 30 seconds and move the card when the status changes:
  queued or pending is step 2, running is step 3. Pass a percentage only if the status carries real
  progress; a partner model such as Seedance usually reports none, and then the stage and the clock are
  the progress. Never make a percentage up.
- `--eta`: seconds the whole job usually takes, from the recipe notes or the last `render.json` with the
  same recipe (`seconds`). Leave it out when you have nothing to go on.
- Every card ends: `--done` when `render.mp4` is saved, `--fail` on an error or when the user stops the job
  (`cancel_job` / `comfy jobs cancel`). Do not also post "working" messages; the card replaces them.
If the job fails, say what the error was in plain words, fix what is fixable (a missing input, a value the
node rejects) and ask before submitting again when the failed run may have cost credits.

### 6. Save and show

Put the result in the render folder as `render.mp4`, with `workflow.json`, `prompt.txt`, `brief.txt`,
`blockout.mp4`, the reference images under `refs/`, and a `render.json`:

```json
{ "recipe": "seedance-2.5-reference", "where": "cloud", "runner": "comfy-cloud-mcp", "job": "<id>",
  "shots": "all", "seed": 1, "duration": 11, "ratio": "9:16", "seconds": 220, "credits": null }
```

Write `{ "where": …, "runner": …, "recipe": … }` to `<scene folder>/renders/settings.json` so the next
render starts from the same choices. Then show it in the chat, where it plays in place:

```bash
node bin/canvas.mjs say --reply <promptId> --attach <render folder>/render.mp4 "Render done in 3m 40s, Seedance 2.5 on Comfy Cloud. Saved in <render folder>."
```

## Follow-ups

- **"Another take"**: `recipe.mjs fill <last render>/workflow.json --out <new folder>/workflow.json --seed new`.
  The uploaded inputs can usually be reused; nothing else changes. It spends credits, so it needs the
  confirm card unless the request itself is the go ("run another take").
- **A change to the prompt or an image**: edit `prompt.txt` or swap the file, refill, confirm card, go.
- **A change to the camera**: that is a Blockout edit. Make it with camera-canvas, export and brief again,
  then render. The old prompt's timings are stale.
- **"Same, on <other recipe>"**: fill the other recipe with the same inputs and prompt; check its notes for
  different limits and reference names.
- **"Save this workflow as a recipe"**: references/recipes.md.
