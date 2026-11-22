# Running the workflow

Three ways to reach ComfyUI. Use the one the user has; the steps are always upload, validate, submit,
wait, download. These tools are young and change: before the first run in a session, look at what is
actually there (your MCP tool list and each tool's schema, or `comfy --json discover`) and follow that
over this page. Checked against docs.comfy.org in November 2026.

Find out what is connected:

- Tools named `mcp__comfy-cloud__*` (or similar): the Comfy Cloud MCP.
- Tools named `mcp__comfy-mcp__*`: local ComfyUI through comfy-mcp.
- `command -v comfy`: the comfy CLI, which reaches both (`--where local|cloud`).

None of them: tell the user the one-line setup for the place they want to run, and stop.

## Money

- Partner (API) nodes such as Seedance run on the partner's servers and spend Comfy credits, on cloud and
  on a local ComfyUI alike. Always plan and wait for go.
- Comfy Cloud also bills GPU time for ordinary nodes and needs an active subscription to run anything.
- Open-weight workflows on the user's own GPU are free.
- `estimate_credits` (cloud MCP) prices paid API nodes only; `0` means "not priced", not free.

## 1. Comfy Cloud MCP (first choice on cloud)

Setup, once: `claude mcp add --transport http comfy-cloud https://cloud.comfy.org/mcp`, then `/mcp` and
authenticate in the browser. Codex: `codex mcp add comfy-cloud --url https://cloud.comfy.org/mcp`, then
`codex mcp login comfy-cloud`.

| Step | Tool |
| --- | --- |
| upload each input (blockout mp4, images, audio) | `upload_file`; use the name it returns in the workflow |
| check the model's options | `get_node` with the node class (for example `ByteDance2ReferenceNodeV2`) |
| cost for the plan | `estimate_credits` |
| run, after go | `submit_workflow` with the filled API-format workflow |
| wait | `wait_for_job` (or `get_job_status`); `cancel_job` if the user stops it |
| download | `get_output` returns a signed URL and a `curl` command: run it as given, saving to `render.mp4` |

Cloud storage is flat and content-addressed: an uploaded file comes back under a hash name like
`2d39ca…5749a.mp4`. Fill the recipe with those names, not the local ones. Upload size may be limited by the
MCP client; if a video will not go through `upload_file`, upload with the CLI (`comfy upload`) instead.

The workflow can also be kept on the account (`save_workflow`, `get_saved_workflow`, `run_saved_workflow`).
Blockout renders still fill a local copy, so the exact graph is saved next to the render.

## 2. Local ComfyUI through comfy-mcp

Setup, once: `pip install "comfy-cli>=1.14.0" comfy-mcp`, then
`claude mcp add comfy-mcp -e COMFY_BIN=/path/to/comfy -- comfy-mcp` (`COMFY_BIN` only when `comfy` is in a
virtualenv). It needs a ComfyUI workspace (`comfy install`, or `comfy set-default <path>`).

| Step | Tool |
| --- | --- |
| is ComfyUI running, and where | `server_info` first; `launch_comfyui` if it is not |
| inputs | `comfy upload <files> --where local`, or copy them into the ComfyUI workspace's `input/` folder (`server_info` names the workspace) |
| check the model's options | `get_node` |
| pre-flight | `validate_workflow` (unknown nodes, missing models, bad wiring) |
| run, after go | `run_workflow(workflow_path, wait=True)`, or `wait=False` and then `wait_for_job` / `job_status` |
| download | `fetch_outputs(prompt_id, out_dir)` into the render folder |

Local input names are the plain file names in `input/`. Give the inputs names that will not collide, for
example `<scene>-timeline-blockout.mp4`. A partner node needs the user to be signed in to their Comfy account
in that ComfyUI; if the run fails with a sign-in or key error, ask them to sign in there. Do not ask for
the key in chat. When the CLI itself needs a key, ask with a key block and pass it with
`canvas secret run` (references/questions.md, "Keys").

## 3. comfy CLI (agents without MCP, or either place from a terminal)

Setup, once: `pip install comfy-cli`, then `comfy setup` (or `comfy cloud login` for cloud).

```bash
comfy upload blockout.mp4 woman.png room.png audio.mp3 --where cloud      # use the names it reports
comfy nodes show ByteDance2ReferenceNodeV2                                # the model's inputs and options
comfy validate --workflow workflow.json
RES=$(comfy --json run --workflow workflow.json --where cloud)            # after go; returns at once
ID=$(echo "$RES" | jq -r .data.prompt_id)
comfy jobs wait "$ID"                                                     # or: comfy jobs status "$ID"
comfy download "$ID"                                                      # saves to ./outputs/
```

`--where local|cloud` picks the place per command; without it the CLI uses cloud when signed in to cloud,
else local. Put `--json` before the subcommand; every command then answers
`{ ok, command, where, data, error }` and a failure explains itself in `error.hint`. `comfy download` writes
to `./outputs/` under the current folder: run it from the render folder and move the video to `render.mp4`.
`comfy run … --wait` blocks instead of returning the id. `comfy jobs cancel <id>` stops a job.

## When a run fails

- Validation or `400`: a node or input name is wrong for this ComfyUI. Compare with `get_node` /
  `comfy nodes show` and fix the filled copy. Free to retry.
- A missing input file: the name in the workflow is not the name the upload returned.
- `402` / `InsufficientFundsError`, `429` / `InactiveSubscriptionError`: the account needs credits or a
  subscription. Tell the user; do not retry.
- The partner model rejects the request (length, ratio, a reference it will not take, a moderation stop):
  quote the message, change what it names, and ask before running again.
- A job that errors after it started may still have been billed. Say so when you report it.
