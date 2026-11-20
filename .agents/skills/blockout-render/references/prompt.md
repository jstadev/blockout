# Writing the timed prompt

The model sees the blockout video as a motion reference and the images as look references. The prompt
tells it which is which, then walks the shot in time so the result follows the blockout move for move.
The camera facts come from `canvas brief`; the look, subject and action come from the user's message and
the reference images, which you open and look at.

Write it to `<render folder>/prompt.txt`. Plain text, sections in this order, each starting with its label.

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

## Checks before the plan

- Every time range in the prompt is inside the shot and matches a segment of the brief. The last line ends
  at the shot's length.
- The length in the Summary is the shot's real length, even when the model's duration is rounded up.
- Every `@image_n` in the prompt has an image, and every image is named. `recipe.mjs fill` warns about both.
- Nothing describes the blockout's grey boxes and mannequins as the look.
- If the user wrote their own prompt, keep their words and only add or correct the timed path and the
  reference tags. Say what you changed.

Other models name references differently or want a shorter prompt. The recipe's notes say how; follow the
notes over this page.
