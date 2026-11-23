# Asking the user

Everything the render step needs from the user goes on a question card (`canvas ask`, described in the
blockout-canvas skill's references/api.md under "Question cards and keys"). The chat shows the questions one
at a time and sends the answers back as one prompt.

## Writing a card

- Never ask which shot to render or how to split or join shots: the whole timeline is one render
  (SKILL.md step 1).
- Ask only what you could not work out. A request that already names the images, the model or the place to
  run skips those questions. `renders/settings.json` answers "where" and "which recipe" after the first render.
- One card for the open questions, then one confirm card (the prompt to review, then Render: SKILL.md
  step 4). Not a card per question.
- A question is under about 8 words. One short `note` if it needs it. Options are 1 to 4 words, with a
  `note` for the trade-off (quality, speed, cost).
- Put your recommendation first. Use `when` so a follow-up shows only when it applies.
- Costs: one figure per option, from `estimate_credits`. No estimate, no number.
- Replies between cards are one or two lines ("Got it. Uploading and pricing it now.").

## The first card

Start from this and delete what you already know:

```json
{ "title": "Render with Comfy", "questions": [
  { "id": "look", "q": "What should set the look?",
    "note": "The blockout gives the camera move. The look comes from images or words.",
    "options": [
      { "value": "images", "label": "Reference images", "note": "A character, a place or a frame to match." },
      { "value": "words", "label": "Describe it", "note": "No images. The prompt carries the look." } ] },
  { "id": "refs", "q": "Add your reference images", "type": "images", "max": 4,
    "note": "Name them in the next step if it is not obvious which is which.", "when": { "look": "images" } },
  { "id": "describe", "q": "Describe the look", "type": "text",
    "placeholder": "Who is in it, where, the light, the film look", "when": { "look": "words" } },
  { "id": "model", "q": "Which model?",
    "options": [
      { "value": "<input value>", "label": "<model>", "note": "<what it is best at, about n credits>" },
      { "value": "<input value>", "label": "<cheaper model>", "note": "<faster and cheaper, about n credits>" } ] },
  { "id": "where", "q": "Where should it run?",
    "options": [
      { "value": "cloud", "label": "Comfy Cloud", "note": "Nothing to set up." },
      { "value": "local", "label": "My ComfyUI", "note": "Uses your machine. Paid models still cost credits." } ] },
  { "id": "key", "q": "Comfy API key", "type": "secret", "name": "COMFY_API_KEY",
    "note": "Needed to run from here. Create one in your Comfy account settings." } ] }
```

- `model`: only when the recipe's model node offers a choice (read the options from the node:
  `get_node` / `comfy nodes show`). Use the node's own values.
- `where`: only when both a cloud and a local runner are connected and settings do not say.
- `key`: only when the runner you will use needs a key and `canvas secret list` does not show it. The
  cloud MCP and a signed-in `comfy` CLI need none. Use the variable name the tool reads.
- Images that came with the request: skip `look` and `refs`. If you cannot tell what an image is for, ask
  that instead: `{ "id": "image_1", "q": "What is this image for?", "options": ["The character", "The place", "The overall look"], "other": "Something else" }`.

## Reading the answers

The answers arrive as a prompt: `Answers to "Render with Comfy":` and one line per question, with file paths
for images. A skipped question means "you decide": take the default and say which in the confirm card's
rows. A closed card (`Closed the questions … without answering`) means stop asking with cards: say in one
line what you still need.

## Keys

A key block saves the key on the user's machine. You are told its name, never its value:

```bash
canvas secret list                                   # names of the saved keys
canvas secret run COMFY_API_KEY -- comfy --json run --workflow workflow.json --where cloud
```

`secret run` sets the key as an environment variable for that one command and masks it in the output. If a
tool wants the key as a flag, let the shell expand it inside the command, never on your own command line:
`canvas secret run COMFY_API_KEY -- sh -c 'comfy … --api-key "$COMFY_API_KEY"'`. Do not read
`~/.blockout/secrets.json`, print the variable or write the key into a workflow, a settings file or the chat.
MCP tools hold their own sign-in and cannot take a key this way: if one is signed out, tell the user to
sign in there.
