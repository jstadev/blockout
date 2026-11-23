#!/usr/bin/env node
// Copy the canonical skills (skills/blockout-canvas, skills/blockout-render) to where each agent looks for them:
//   Claude Code: .claude/skills/<skill>     Codex: .agents/skills/<skill>
// Pass --global to also install into ~/.claude/skills and ~/.codex/skills (the skills then work from any folder;
// they find this repo through the CANVAS_HOME path written into it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = ['blockout-canvas', 'blockout-render'];
const SRC = path.join(ROOT, 'skills', 'blockout-canvas');
const global = process.argv.includes('--global');

for (const skill of SKILLS) {
  const src = path.join(ROOT, 'skills', skill);
  const targets = [path.join(ROOT, '.claude/skills', skill), path.join(ROOT, '.agents/skills', skill)];
  if (global) targets.push(path.join(os.homedir(), '.claude/skills', skill), path.join(os.homedir(), '.codex/skills', skill));
  for (const dest of targets) {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    if (!dest.startsWith(ROOT)) {
      for (const f of fs.readdirSync(dest, { recursive: true }).filter((f) => f.endsWith('.md'))) {
        const file = path.join(dest, f);
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('node bin/canvas.mjs', `node "${path.join(ROOT, 'bin/canvas.mjs')}"`));
      }
    }
    console.log(`skill -> ${dest}`);
  }
}

// The builder helper (Claude Code subagent) is generated from the skill's reference, so there is one source.
const builder = fs.readFileSync(path.join(SRC, 'references', 'builder.md'), 'utf8').replace(/^# .*\n+(<!--[\s\S]*?-->\n+)?/, '');
const agentFile = path.join(ROOT, '.claude', 'agents', 'canvas-builder.md');
fs.mkdirSync(path.dirname(agentFile), { recursive: true });
fs.writeFileSync(agentFile, `---
name: canvas-builder
description: Builds one part of a Blockout scene (a zone such as "the house", "the street", "the crowd") from a brief written by the main canvas agent, working in parallel with other builders. Use only when the blockout-canvas skill's orchestration guide says to fan out.
tools: Bash, Read, Write
---

<!-- Generated from skills/blockout-canvas/references/builder.md by bin/sync-skills.mjs. Edit that file instead. -->

${builder}`);
console.log(`builder agent -> ${agentFile}`);

