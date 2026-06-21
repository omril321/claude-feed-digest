import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { DATA_DIR, STATE_DIR } from './paths.mjs';

export function loadConfig() {
  const configPath = join(DATA_DIR, 'config.json');
  if (!existsSync(configPath)) {
    throw new Error(
      `Config not found at ${configPath}.\n` +
      `Copy skills/feed-digest/config.default.json to that path and edit it.`
    );
  }
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

export function loadSourceState(sourceName) {
  const statePath = join(STATE_DIR, `${sourceName}.json`);
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

export function computeCutoff(sourceConfig, state) {
  if (state?.lastVersionSeen) {
    return { lastVersion: state.lastVersionSeen };
  }
  const days = sourceConfig.maxFirstRunDays ?? 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  return { since: cutoffDate.toISOString().slice(0, 10) };
}
