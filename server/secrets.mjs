// API keys the user types into a key block in the chat. They live in one file in the user's home folder
// (not in the scene, the repo or the chat log), readable only by the user. The server writes them and
// lists their names; `canvas secret run` reads them to hand to a command as environment variables.
// Nothing here returns a value over HTTP or prints one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SECRET_NAME } from '../core/ask.js';

export const secretsPath = () => process.env.CANVAS_SECRETS ? path.resolve(process.env.CANVAS_SECRETS) : path.join(os.homedir(), '.blockout', 'secrets.json');

export function readSecrets() {
  try { const all = JSON.parse(fs.readFileSync(secretsPath(), 'utf8')); return all && typeof all === 'object' ? all : {}; } catch { return {}; }
}
function writeSecrets(all) {
  const file = secretsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
}
export function saveSecret(name, value) {
  if (!SECRET_NAME.test(String(name || ''))) throw new Error('a secret needs a name like COMFY_API_KEY');
  const v = String(value ?? '').trim();
  if (!v) throw new Error('the key is empty');
  if (v.length > 4096 || /[\r\n]/.test(v)) throw new Error('that does not look like a key (one line, at most 4096 characters)');
  writeSecrets({ ...readSecrets(), [name]: { value: v, savedAt: Date.now() } });
}
export function removeSecret(name) {
  const all = readSecrets();
  if (!(name in all)) return false;
  delete all[name];
  writeSecrets(all);
  return true;
}
/** Names and dates only. */
export const listSecrets = () => Object.entries(readSecrets()).map(([name, s]) => ({ name, savedAt: s.savedAt || null }));
