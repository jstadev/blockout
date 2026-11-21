---
name: blockout-render
description: Turn a Blockout export into a finished shot by running a ComfyUI reference-to-video workflow (Seedance 2.5 or any saved "recipe") on Comfy Cloud or the user's local ComfyUI. Use only when the user asks to render, generate or "run through Comfy / Seedance" a Blockout shot, asks for another take of a render, or asks to save or adapt a ComfyUI workflow for Blockout. Not for building the scene or camera (that is camera-canvas), and not for general ComfyUI work.
---

# Blockout render

An optional step after the blockout: the shot's export goes into a ComfyUI reference-to-video workflow as
the motion reference, next to the user's reference images and audio, and a finished video comes back into
the Blockout chat. Blockout itself has no ComfyUI code. You do the adapting, with the ComfyUI tools the
user already has.

You need the `camera-canvas` skill for every `canvas` command below (`node bin/canvas.mjs …`, or `canvas …`
from the plugin). This skill's own helper is `scripts/recipe.mjs` in this folder; it only reads and writes
workflow JSON and never talks to ComfyUI.

## The rules

1. **Nothing that spends credits runs before the user says go.** Post the render plan, then stop and wait.
   Uploading inputs, validating and estimating are free and can happen before. Partner models such as
   Seedance bill Comfy credits even when the graph runs on the user's own machine.
2. **Never edit a recipe in place.** Fill a copy into the render folder (`recipe.mjs fill --out`).
3. **The prompt's times come from `canvas brief`, not from memory or from watching the video.**
4. **Keep the seed** unless the user asks for another take, so a re-run changes only what they changed.
5. **Save every render with what made it**: the filled workflow, the prompt, the brief and the inputs.
6. **API keys stay out of files, chat and command lines you echo.** Use the sign-in the tools already hold.
7. If no ComfyUI tool is connected, say what to set up (references/running.md) and stop. Do not write your
   own client for the ComfyUI API.

## Flow

### 1. Gather

The request usually comes from the **Render** button next to Export in the timeline bar. It opens the chat
with "Render this shot with ComfyUI (blockout-render skill)." started, and the user adds their reference
images and what each is for before sending. A request typed by hand is the same thing.


- The shot: the one the prompt came from (`shot:` in the canvas prompt), the one the user names, or the
  active one. One render per shot. Render a whole sequence as one video only if the user asks for that.
- The reference images: the files attached to the canvas prompt (their paths are in the prompt), or paths
  the user gives. Open each one so you know what it shows. Ask which is which only if you cannot tell.
- Where things live: `canvas status` prints `scene: <path>`; that file's folder is the **scene folder**.
  Recipes are in `<scene folder>/recipes/`, renders go to `<scene folder>/renders/`.

### 2. Brief and export

```bash
node bin/canvas.mjs brief --shot <id> --beats     # camera moves with times, framings, moving objects, audio, beats
node bin/canvas.mjs export --shot <id>            # the blockout mp4; prints its path
```

`--beats` needs the tab open on that shot and an audio track; leave it off otherwise. `brief --json` has
every number. Make the render folder and keep both there:

```bash
node <skill>/scripts/recipe.mjs folder --root <scene folder> --scene <scene name> --shot <id>
# -> <scene folder>/renders/<scene>-<shot>-<date>-<time>/   copy the export in as blockout.mp4, the brief as brief.txt
```

If the scene has audio, the brief says which part of the file the shot plays (`audio: … = 3.00–13.50s of
the file`) and where the file is. Cut that part for the audio slot:
`ffmpeg -ss <fileFrom> -t <shot length> -i <audio file> -c copy <render folder>/audio.<ext>` (re-encode if
`-c copy` fails). No audio on the shot: fill with `--audio none`.

### 3. Pick a recipe and fill it

```bash
node <skill>/scripts/recipe.mjs list --root <scene folder>     # the user's recipes, then the built-in ones
node <skill>/scripts/recipe.mjs slots <recipe.json>            # where video, images, audio, prompt and settings go
```

Use the recipe the user names, else their last one (`renders/settings.json`), else
`seedance-2.5-reference`. Read the recipe's `.md` notes if it has them. How slots are found, how to save a
new recipe and what to do when a graph does not fit: references/recipes.md.

Write the prompt to `<render folder>/prompt.txt` following references/prompt.md, then upload the inputs
(step 5 explains where; uploading is free) and fill a copy with the names the upload returned:

```bash
node <skill>/scripts/recipe.mjs fill <recipe.json> --out <render folder>/workflow.json \
  --video <uploaded blockout name> --image <uploaded image 1> --image <uploaded image 2> \
  --audio <uploaded audio name | none> --prompt-file <render folder>/prompt.txt \
  --duration <whole seconds> --ratio <ratio from the brief> --prefix blockout/<scene>/<shot>
```

Images go in the order the prompt names them (`@image_1`, `@image_2`, …). Fewer images than the recipe has
slots removes the spare ones; more adds slots. `fill` prints every change and warns when the prompt names a
reference the graph does not have, or a placeholder is left. Fix every warning before the plan.

Duration: the shot length rounded up to a whole second, within what the model allows (the recipe notes, or
ask the node: `get_node` / `comfy nodes show <class>`). A shot longer than the limit cannot be rendered in
one go: tell the user and offer to cut the shot or render the first part.

### 4. Plan, then wait for go

Reply in the Blockout chat with the plan as plain lines, and end your turn (or `canvas wait`):

```
Render plan · <recipe> · <cloud | local>
Blockout: <shot>, 0–<length>s, muted, as @video_1
Images: @image_1 <file>: <what it sets> / @image_2 <file>: <what it sets>
Audio: <track> <from>–<to>s as @audio_1   (or: none)
Output: <resolution> · <ratio> · <duration>s · seed <kept | new>
Prompt: <n> timed moves · saved at <render folder>/prompt.txt
Cost: about <estimate> credits   (or: no estimate available)
Say go to run, or tell me what to change.
```

Get the cost from `estimate_credits` when the cloud MCP is connected; otherwise say there is no estimate.
Never invent a number. When the user changes something, refill and post the changed lines only. A workflow
with no paid nodes on the user's own GPU is free: the plan is still shown, unless they have told you to
skip it for free local runs (keep that in `renders/settings.json`).

### 5. Run

Where: what the user says in the request ("on my machine", "on cloud"), else `renders/settings.json`, else
whatever is connected, in this order: Comfy Cloud MCP, local `comfy-mcp`, `comfy` CLI. The steps are the
same everywhere: upload the inputs, validate, submit the filled workflow, wait, download the video.
Tool names and commands for each: references/running.md.

While it runs, keep the user posted without closing their prompt:
`canvas say --working "Running on Comfy Cloud, usually a few minutes"`.
If the job fails, say what the error was in plain words, fix what is fixable (a missing input, a value the
node rejects) and ask before submitting again when the failed run may have cost credits.

### 6. Save and show

Put the result in the render folder as `render.mp4`, with `workflow.json`, `prompt.txt`, `brief.txt`,
`blockout.mp4`, the reference images under `refs/`, and a `render.json`:

```json
{ "recipe": "seedance-2.5-reference", "where": "cloud", "runner": "comfy-cloud-mcp", "job": "<id>",
  "shot": "shot-2", "seed": 1, "duration": 11, "ratio": "9:16", "seconds": 220, "credits": null }
```

Write `{ "where": …, "runner": …, "recipe": … }` to `<scene folder>/renders/settings.json` so the next
render starts from the same choices. Then show it in the chat, where it plays in place:

```bash
node bin/canvas.mjs say --reply <promptId> --attach <render folder>/render.mp4 "Render done in 3m 40s, Seedance 2.5 on Comfy Cloud. Saved in <render folder>."
```

## Follow-ups

- **"Another take"**: `recipe.mjs fill <last render>/workflow.json --out <new folder>/workflow.json --seed new`.
  The uploaded inputs can usually be reused; nothing else changes. It spends credits, so it needs a go
  unless the request itself is the go ("run another take").
- **A change to the prompt or an image**: edit `prompt.txt` or swap the file, refill, plan, go.
- **A change to the camera**: that is a Blockout edit. Make it with camera-canvas, export and brief again,
  then render. The old prompt's timings are stale.
- **"Same, on <other recipe>"**: fill the other recipe with the same inputs and prompt; check its notes for
  different limits and reference names.
- **"Save this workflow as a recipe"**: references/recipes.md.
