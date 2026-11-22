# Writing the timed prompt

The model sees the blockout video as a motion reference and the images as look references. The prompt
tells it which is which, then walks the video in time so the result follows the blockout move for move.
The blockout is the whole timeline: every shot, cut together, as one video. The prompt covers all of it,
with every time in seconds of that video and every cut named. The camera facts come from
`canvas brief --timeline`; the look, subject and action come from the user's message and
the reference images, which you open and look at.

Write it to `<render folder>/prompt.txt`. Plain text, sections in this order, each starting with its label.

## Start from the example, and match its detail

Every recipe can carry the full prompt it was made from: `<recipe>.prompt.txt`, next to the recipe
(`recipe.mjs list` prints its path). **Read all of it before you write anything.** It is the user's own
prompt for this workflow, and the new prompt is that prompt adapted to this shot, not a fresh one written
from the section list below. Adapt it like this:

- **Keep** its sections and their order, its sentence patterns, its standing rules (the Camera and
  Consistency wording, the exclusions) and any special section it has, when the same need exists in this
  shot. The built-in example has a "Head tracking" section because the subject had to keep looking at the
  lens: keep such a section when the user asks for the same thing, drop it when they do not.
- **Replace** everything that is about the example's own shot: the subject, the set, the look, the times,
  the moves, the sound. None of the example's people, props or rooms may be left in the new prompt.
- **Match its level of detail, section by section.** This is the point of having it. Compare as you write:
  - Subject: the example names hair, each piece of clothing, jewellery, shoes and what she sits in. Describe
    this shot's subject that closely, from the images (or the user's words when there are none).
  - Camera path: the example gives every move its own line with exact times, how the camera travels
    ("whips down and around", "banks up into a steep tilted overhead"), the framing it lands on, **what is
    in frame there** ("lava lamp behind her", "shooting through the silver stool"), what the subject does,
    and the hold after it. Do the same for every segment of the brief. Get what is in frame from the scene
    (`canvas ls`, a `canvas snapshot --t <time>` at each landing) and the images, not from guessing.
  - Camera: the example describes the character of the motion in numbers (whips of 0.1 to 0.3 seconds, a
    dead stop, a hover with slight drift, one whip per beat, the BPM). Give this shot's own character with
    its own numbers from the brief.
  - Audio: the example lists what is heard and when (clicks at 1.06s and 1.37s, the drop at 1.60s). With
    `canvas brief --beats`, name this track's events and times the same way.
  - Consistency: the example lists each thing that must not change, by name. List this shot's.
- A shot with fewer moves has fewer camera lines, so the prompt may be shorter overall. The detail per line
  and per section must not be. A one-move shot still gets a full Subject, Camera, Style, Audio and
  Consistency. If you do not know something the example would have stated (what she wears, what is on the
  wall), look at the images and snapshots, and ask the user only if they do not show it.
- A recipe without an example prompt: use the built-in recipe's example for the level of detail and the
  sections below for the content.

The sections below say where each section's facts come from.

## Sections

**References:** what each reference is for, by its tag. Say that the blocking, camera path, speed and
timing follow `@video_1` exactly. One clause per image: what `@image_1` defines (a person's face and
outfit, the room, the palette). If there is audio, say `@audio_1` is the soundtrack. If something should
*not* be taken from the blockout (the grey mannequin look, a head direction), say so here.

**Summary:** one or two sentences: one continuous take or how many cuts, the length in seconds, what the
camera does overall, where the subject is, how it ends, and the look in a few words.

**Subject:** who or what is in the shot, described from the images: build, hair, clothes, props, pose.
Use the blockout for where they are and what they do (the brief's "objects moving" lines and each object's
note), never for how they look.

**Camera path and sync:** the heart of it. One line per segment of the brief, in order, each starting with
its time range:

```
0–1.2s: Wide shot of the whole room, pushing in slowly at eye level.
1.2–1.5s: Hold on the full shot.
1.5–1.75s: Whips 90° around her to her left side, stopping abruptly.
3–4s: Slow zoom in to a close-up from ground level, looking up, as the horizon rolls 10° clockwise.
```

- Copy the times from the brief. Trim to at most two decimals; never round a 0.25 s whip to "about a
  second".
- Turn each segment's facts into film language: the move (push in, orbit, truck, crane, pan, tilt, zoom),
  its pace word from the brief (`snap` → "whips" / "snaps", `fast`, `steady`, `slow`), the ease when it
  shows (easeIn → "starting slowly", easeOut → "settling", snap → "abrupt dead stop"), and the framing it
  lands on (the text after `→`: shot size, side of the subject, height, angle).
- A `hold` is a line too: "Hold to 2.34s" can be folded into the end of the move before it.
- A `cut` is a hard cut: say so, and give the framing the new angle starts on.
- A timeline with several shots: the brief's `CUT at <t>s` lines are hard cuts between shots. Give each its
  own line ("5.00s: Hard cut to a low close-up from her left.") using the next shot's `opens on` framing,
  then carry on with that shot's moves. Times keep counting through the cuts; never restart at 0 for a
  new shot. In the Summary and Camera sections say how many shots and cuts there are ("three shots, two
  hard cuts, at 2.50s and 5.00s") and that there are no others, in place of the example's "one continuous
  take". Say that the people, clothes and set are the same in every shot.
- Shudder on a segment: say the camera judders or stutters through that move, and how many times.
- Meters and degrees help you; the model reads pictures. Prefer "a short push in" plus the landing framing
  over "push in 1.2 m", but keep angles for big orbits ("a quarter turn", "half way round").
- With beats: name the moments the move is cut to ("lands on the beat at 1.60s", "one whip per beat, about
  112 BPM"). Use the brief's `beats` and `strong onsets` lines for the times.
- What the subject does goes on the line where it happens ("she turns to the lens at 2.1s").

**Camera:** the standing rules for the whole take: replicate the trajectory, speed, heights, distances and
roll of `@video_1`; the character of the motion (smooth and floating, or snap-and-stick); no cuts, fades,
speed ramps or zooms that are not in the blockout. For a shot with cuts, say how many and that there are
no others.

**Style:** the look, matched to the images: film stock or camera, lighting, grain, palette.

**Audio:** what is heard and when. With `@audio_1`: use it unchanged at its original timing and length, no
added music, effects or dialogue. Without audio: say what the model should generate, or that it should be
silent, and set the recipe's generate-audio input to match.

**Consistency:** what must stay identical from every angle (face, hair, outfit, props, set dressing), the
expression, and the usual exclusions: no subtitles, no on-screen text, no watermark.

## Checks before the review

- Put the example and your prompt side by side. Each section is as specific as the example's, and each
  camera line says how the camera moves, where it lands, what is in frame and what the subject does.
- Nothing from the example's own shot is left (search for its nouns).

- Every time range in the prompt is inside the video and matches a segment of the timeline brief. Every cut
  in the brief is in the prompt, at its time. The last line ends at the timeline's length.
- The length in the Summary is the timeline's real length, even when the model's duration is rounded up.
- Every `@image_n` in the prompt has an image, and every image is named. `recipe.mjs fill` warns about both.
- Nothing describes the blockout's grey boxes and mannequins as the look.
- If the user wrote their own prompt, keep their words and only add or correct the timed path and the
  reference tags. Say what you changed.

Other models name references differently or want a shorter prompt. The recipe's notes say how; follow the
notes over this page.
