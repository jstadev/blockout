# Recipes

A recipe is a ComfyUI workflow the user has saved for rendering Blockout shots: one JSON file in **API
format**, with an optional notes file beside it.

```
<scene folder>/recipes/my-look.json     the workflow (ComfyUI: Workflow > Export (API))
<scene folder>/recipes/my-look.md       notes for you: limits, what each image slot is for, quirks
<scene folder>/recipes/my-look.prompt.txt   the full prompt the workflow came with: the example to adapt
<skill>/recipes/seedance-2.5-reference.json   built in, made from the user's Seedance 2.5 example
```

The editor format (a file with `nodes` and `links`) cannot be filled. Ask for the API export, or convert it:
the cloud MCP's `run_saved_workflow` and `comfy run` both accept the editor format, but for slot filling
you need the API JSON (`get_saved_workflow`, or export it from ComfyUI).

## How slots are found

`recipe.mjs slots <file>` reads the graph and reports, by node type:

| Slot | Found as | Filled with |
| --- | --- | --- |
| video | a `LoadVideo`-like node (class matches "load video") | the uploaded blockout export |
| trim | `Video Slice` / trim-video node with a `duration` | the same seconds as the model duration |
| images | `LoadImage` nodes, ordered by the model input they feed (`…image_1`, `…image_2`) | the reference images, in prompt order |
| audio | a `LoadAudio`-like node | the export's audio track (the whole timeline), or removed |
| model | the node with a prompt that draws on the most loaders | (not filled; it holds the next four) |
| prompt | the model's `prompt` / `text` input | `prompt.txt` |
| duration, ratio, resolution, seed | inputs of the model ending in those names | from the brief and the user |
| save | the node with `filename_prefix` | `blockout/<scene>/timeline` |

"→ model.reference_images.image_1" in the output is the model input a loader feeds. "(through other
nodes)" means there are nodes in between, such as the trim and mute chain on the blockout video: those are
left as they are.

When the guess is wrong (two video loaders, a prompt on a text node, an unusual custom node), tag the node
by putting one of these in its title in ComfyUI, and save the recipe again: `@video`, `@image_1`,
`@image_2`, `@audio`, `@model` (or `@prompt`), `@trim`, `@save`. A tag always wins over the guess.

Anything else is set by hand with `--set <node id>.<input>=<value>`, for example
`--set seedance.model.generate_audio=false`. The node id is the key in the JSON; the input name is
everything after the first dot.

## What the blockout video is in the graph

In the Seedance example the blockout goes `LoadVideo → Video Slice (trim) → GetVideoComponents →
CreateVideo` with no audio wired in, so the model gets a muted, trimmed copy as `@video_1`, and the real
soundtrack comes in separately as `@audio_1`. Keep that shape: the export's own audio is only a guide.

## Image slots

- The order is the prompt's order: the first `--image` is `@image_1`.
- Fewer images than slots: the spare loaders and their model inputs are removed.
- More images than slots: the last slot is copied (`image_3`, …) when it is a numbered input wired
  straight into the model. Check the model's limit in the notes or with `get_node` first.
- A slot that reaches the model through other nodes (a resize, a crop) is not removed or copied for you:
  the script says so, and you edit the copy by hand or ask the user to adjust the recipe.

## Saving a new recipe

When the user gives you a workflow to keep ("save this as a recipe", or a new attachment):

1. Get it in API format and run `recipe.mjs slots` on it. Every slot the render needs must be found:
   video, prompt, and whatever references the workflow uses.
2. If a slot is missed, tell the user which title tag to add, or add `_meta.title` tags in the JSON yourself.
3. Before you change anything, copy the workflow's own prompt, whole and unedited, to
   `<name>.prompt.txt`. It is the example every later prompt for this recipe is adapted from
   (references/prompt.md), so the user's level of detail and phrasing carry over.
4. Replace the file names in the loaders with `REPLACE-…` placeholders, so a stale upload is never run by
   mistake (`fill` warns while a placeholder is left).
5. Save it as `<scene folder>/recipes/<name>.json`. Write `<name>.md` with what you learned: the model's
   duration, ratio and resolution options (`get_node` / `comfy nodes show <class>`), how many images it
   takes, how the prompt refers to references (`@image_1`, or something else), whether it is a paid
   partner node or runs on local models, and anything the user said about how they use it.

Any reference-to-video workflow works this way, paid or open-weight. A workflow that takes a control video
and a start frame instead of loose reference images is the same recipe with one image slot.
