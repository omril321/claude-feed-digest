import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR =
  process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.claude', 'feed-digest');

export const STATE_DIR    = join(DATA_DIR, 'state');
export const OUTPUT_DIR   = join(DATA_DIR, 'output');
export const TEMPLATE_PATH = join(__dirname, '../renderer/templates/newsletter.html');
