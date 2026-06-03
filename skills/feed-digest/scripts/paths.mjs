import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const CODE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

// Runtime state + generated output.
// ${CLAUDE_PLUGIN_DATA} when running as a plugin,
// else fall back to ~/.claude/feed-digest (personal-skill / dev mode).
export const DATA_DIR =
  process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.claude', 'feed-digest');

export const TEMPLATE_PATH = join(CODE_DIR, 'templates', 'newsletter.html');
export const OUTPUT_DIR     = join(DATA_DIR, 'output');
export const STATE_DIR      = join(DATA_DIR, 'state');
