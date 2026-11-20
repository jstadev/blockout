# seedance-2.5-reference

ByteDance Seedance 2.5 reference-to-video (`ByteDance2ReferenceNodeV2`), made from the user's example
workflow. A paid partner node: it spends Comfy credits on cloud and on a local ComfyUI alike.

- **References**: `@video_1` is the blockout, trimmed and muted inside the graph (`LoadVideo → Video Slice →
  GetVideoComponents → CreateVideo` with no audio). `@image_1`, `@image_2` are the look references; the
  node has numbered image inputs, so `fill` can add `image_3` and up or remove spares. `@audio_1` is the
  soundtrack.
- **Settings in the example**: 720p, 9:16, 11 seconds for a 10.5 second shot, `generate_audio` on,
  `task_type` reference, watermark off. Duration is whole seconds: round the shot length up, and set the
  trim to the same number (`fill --duration` does both).
- **Limits**: not recorded here. Before the first render, read the node's options
  (`get_node ByteDance2ReferenceNodeV2`, or `comfy nodes show ByteDance2ReferenceNodeV2`) for the allowed
  durations, ratios, resolutions and how many references it takes, and add them to this file's copy in the
  user's recipes folder.
- **Prompt**: the long sectioned form in references/prompt.md, with a timed "Camera path and sync" list.
  The recipe's prompt is a template with `[PLACEHOLDERS]`; `fill` warns while any is left.
- **Loader names** are `REPLACE-…` placeholders. Fill them with the names the upload returns.
