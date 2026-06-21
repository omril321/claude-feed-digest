# Feed Digest SDK Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Claude Code skill/agent orchestration with a standalone Node.js script (`node src/index.mjs`) that uses `@anthropic-ai/vertex-sdk` directly — one LLM call per source for filtering + categorization.

**Architecture:** Top-level `src/` replaces `skills/`. A new entry point (`src/index.mjs`) fetches all sources in parallel (deterministic, no LLM), then fires one Haiku SDK call per source to get back a JSON map of item-number → category (relevant) or item-number → reason (irrelevant). Canonical schema is assembled in pure JS and passed to the existing renderer unchanged.

**Tech Stack:** Node.js ESM, `@anthropic-ai/vertex-sdk`, `gh` CLI for GitHub API calls, no bundler.

## Global Constraints

- Package manager: `yarn` (not npm)
- SDK: `@anthropic-ai/vertex-sdk` — instantiate with `new AnthropicVertex({ projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID, region: process.env.CLOUD_ML_REGION })`
- Vertex model ID format: `claude-haiku-4-5@20251001`
- `"type": "module"` in package.json — all files use ESM `import`/`export`
- No test frameworks — plain Node.js assert pattern (matches existing `render.test.mjs` style)
- State files location: `~/.claude/feed-digest/state/<name>.json` (unchanged)
- Config file location: `~/.claude/feed-digest/config.json` (unchanged)
- Canonical schema consumed by renderer must stay identical to current shape (see Task 4)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Create | Dependencies, `"type": "module"`, scripts |
| `src/config/paths.mjs` | Create (moved from `skills/.../scripts/paths.mjs`) | DATA_DIR, STATE_DIR, OUTPUT_DIR, TEMPLATE_PATH |
| `src/config/loader.mjs` | Create | Load config.json, state files, compute per-source cutoffs |
| `src/fetchers/github-releases.mjs` | Create (refactored from skills script) | Export `fetchGithubReleases()` module function |
| `src/llm/scorer.mjs` | Create | Build prompt, call Haiku, join response to flat items, return canonical schema |
| `src/renderer/render.mjs` | Create (moved, +export) | All existing HTML generation logic, now exports `render()` |
| `src/renderer/mark-read-server.mjs` | Create (moved, no change) | 2-hour HTTP server for mark-read |
| `src/renderer/templates/newsletter.html` | Create (moved, no change) | HTML template |
| `src/renderer/render.test.mjs` | Create (moved, import path updated) | Unit tests for render helpers + new `inferType` |
| `src/index.mjs` | Create | Entry point: args, pipeline orchestration |
| `skills/` | Delete | Replaced by `src/` |

---

### Task 1: Project Scaffold — package.json and paths

**Files:**
- Create: `package.json`
- Create: `src/config/paths.mjs`

**Interfaces:**
- Produces: `DATA_DIR`, `STATE_DIR`, `OUTPUT_DIR`, `TEMPLATE_PATH` exported from `src/config/paths.mjs`

- [ ] **Step 1: Create package.json**

```json
{
  "type": "module",
  "scripts": {
    "start": "node src/index.mjs",
    "test": "node src/renderer/render.test.mjs"
  },
  "dependencies": {
    "@anthropic-ai/vertex-sdk": "^0.7.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
yarn install
```

Expected: `node_modules/` created, `yarn.lock` written.

- [ ] **Step 3: Create src/config/paths.mjs**

```js
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR =
  process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.claude', 'feed-digest');

export const STATE_DIR    = join(DATA_DIR, 'state');
export const OUTPUT_DIR   = join(DATA_DIR, 'output');
export const TEMPLATE_PATH = join(__dirname, '../renderer/templates/newsletter.html');
```

- [ ] **Step 4: Verify paths resolve correctly**

```bash
node -e "
import('./src/config/paths.mjs').then(m => {
  console.log('DATA_DIR:', m.DATA_DIR);
  console.log('TEMPLATE_PATH:', m.TEMPLATE_PATH);
})"
```

Expected: prints paths under `~/.claude/feed-digest` and a `src/renderer/templates/newsletter.html` path.

- [ ] **Step 5: Commit**

```bash
git add package.json yarn.lock src/config/paths.mjs
git commit -m "feat: scaffold src/ structure with package.json and paths"
```

---

### Task 2: Config Loader

**Files:**
- Create: `src/config/loader.mjs`

**Interfaces:**
- Consumes: `DATA_DIR`, `STATE_DIR` from `./paths.mjs`
- Produces:
  - `loadConfig() → { preferences: { ignore: string[] }, sources: Record<string, SourceConfig> }`
  - `loadSourceState(name: string) → { lastVersionSeen: string, lastRunISO: string } | null`
  - `computeCutoff(sourceConfig, state) → { lastVersion: string } | { since: string }`

- [ ] **Step 1: Create src/config/loader.mjs**

```js
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
```

- [ ] **Step 2: Verify config loader works against real config**

```bash
node -e "
import('./src/config/loader.mjs').then(m => {
  const cfg = m.loadConfig();
  console.log('sources:', Object.keys(cfg.sources));
  console.log('global filters:', cfg.preferences.ignore.length);
})"
```

Expected: prints your source names and filter count. If config missing, clear error message.

- [ ] **Step 3: Commit**

```bash
git add src/config/loader.mjs
git commit -m "feat: add config/state loader"
```

---

### Task 3: GitHub Fetcher Module

**Files:**
- Create: `src/fetchers/github-releases.mjs` (refactored from `skills/feed-digest/scripts/fetchers/github-releases.mjs`)

**Interfaces:**
- Produces: `fetchGithubReleases({ url: string, tagPrefix?: string, lastVersion?: string }) → Promise<{ latestVersion: string|null, releases: Array<{ version: string, date: string, items: string[] }> }>`

- [ ] **Step 1: Create src/fetchers/github-releases.mjs**

Refactor the existing CLI script into an exported module function. The `compareSemver`, `parseReleaseBody`, `fetchReleases`, `filterByTagPrefix`, and `buildReleases` helpers are moved verbatim; the `main()` CLI entry is replaced with an exported async function.

```js
import { spawnSync } from 'child_process';

function compareSemver(a, b) {
  const normalize = v => String(v).replace(/^v/, '').split('.').map(Number);
  const pa = normalize(a);
  const pb = normalize(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseReleaseBody(body) {
  if (!body) return [];
  const lines = body.split('\n');
  const items = [];
  let currentItem = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.match(/^[-*]\s+/) || trimmed.match(/^\d+\.\s+/)) {
      if (currentItem) items.push(currentItem.trim());
      currentItem = trimmed.replace(/^[-*]\s+|^\d+\.\s+/, '');
    } else if (currentItem && trimmed) {
      currentItem += ' ' + trimmed;
    }
  }
  if (currentItem) items.push(currentItem.trim());
  return items.map(item => item.replace(/`([^`]+)`/g, '$1'));
}

function ghFetchReleases(url) {
  const result = spawnSync('gh', ['api', `repos/${url}/releases?per_page=100`, '--paginate'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'gh command failed');
  return JSON.parse(result.stdout);
}

export async function fetchGithubReleases({ url, tagPrefix = null, lastVersion = null }) {
  const allReleases = ghFetchReleases(url);
  const filtered = tagPrefix
    ? allReleases.filter(r => r.tag_name.startsWith(tagPrefix))
    : allReleases;

  const normalized = filtered.map(r => ({
    version: r.tag_name,
    versionForCompare: tagPrefix ? r.tag_name.slice(tagPrefix.length) : r.tag_name,
    date: r.published_at ? r.published_at.split('T')[0] : 'unknown',
    items: parseReleaseBody(r.body),
  }));

  const releases = lastVersion
    ? (() => {
        const lastCompare = tagPrefix ? lastVersion.slice(tagPrefix.length) : lastVersion;
        return normalized.filter(r => compareSemver(r.versionForCompare, lastCompare) > 0);
      })()
    : normalized;

  const latestVersion = allReleases.length > 0 ? allReleases[0].tag_name : null;

  return {
    latestVersion,
    releases: releases.map(({ version, date, items }) => ({ version, date, items })),
  };
}
```

- [ ] **Step 2: Verify fetcher returns data**

```bash
node -e "
import('./src/fetchers/github-releases.mjs').then(async m => {
  const result = await m.fetchGithubReleases({ url: 'anthropics/claude-code', lastVersion: null });
  console.log('latestVersion:', result.latestVersion);
  console.log('releases fetched:', result.releases.length);
  console.log('first release items:', result.releases[0]?.items?.slice(0, 3));
})"
```

Expected: prints the latest version tag, a count of releases, and 3 sample items.

- [ ] **Step 3: Commit**

```bash
git add src/fetchers/github-releases.mjs
git commit -m "feat: add github-releases fetcher module"
```

---

### Task 4: LLM Scorer

**Files:**
- Create: `src/llm/scorer.mjs`

**Interfaces:**
- Consumes: `fetchGithubReleases` output shape: `{ releases: Array<{ version, date, items: string[] }> }`
- Produces: `scoreSource({ sourceName, parsedReleases, globalFilters, sourceFilters }) → Promise<CanonicalResult>`

`CanonicalResult` shape (must match what `render.mjs` expects):
```js
{
  tool: string,
  latestVersion: string,
  versionRange: { from: string, to: string, fromDate: string, toDate: string },
  globalFilters: string[],
  sourceFilters: string[],
  topics: Array<{ name: string, items: Array<{ text: string, version: string, date: string, type: 'new'|'improved'|'fix', link?: string }> }>,
  excluded: Array<{ text: string, version: string, reason: string }>,
}
```

- [ ] **Step 1: Write failing test for inferType in src/renderer/render.test.mjs**

Add this block at the top of the test file (we'll create it in Task 5 by moving the existing one — add it here as a reminder that Task 4 and Task 5 tests live together. For now, just verify the function works by running it inline):

```bash
node -e "
function inferType(text) {
  const t = text.toLowerCase();
  if (/^(add|new|support|introduce|implement|enable)/.test(t)) return 'new';
  if (/^(fix|resolve|correct|patch|prevent|repair)/.test(t)) return 'fix';
  return 'improved';
}
console.assert(inferType('Added MCP support') === 'new', 'add → new');
console.assert(inferType('Fixed crash on startup') === 'fix', 'fix → fix');
console.assert(inferType('Improved performance') === 'improved', 'improved → improved');
console.assert(inferType('New hook type') === 'new', 'new → new');
console.assert(inferType('Resolve deadlock in queue') === 'fix', 'resolve → fix');
console.log('inferType: all passed');
"
```

Expected: prints `inferType: all passed`.

- [ ] **Step 2: Create src/llm/scorer.mjs**

```js
import AnthropicVertex from '@anthropic-ai/vertex-sdk';

const client = new AnthropicVertex({
  projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
  region: process.env.CLOUD_ML_REGION,
});

export function inferType(text) {
  const t = text.toLowerCase();
  if (/^(add|new|support|introduce|implement|enable)/.test(t)) return 'new';
  if (/^(fix|resolve|correct|patch|prevent|repair)/.test(t)) return 'fix';
  return 'improved';
}

function compareSemver(a, b) {
  const normalize = v => String(v).replace(/^v/, '').split('.').map(Number);
  const pa = normalize(a);
  const pb = normalize(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function buildVersionRange(releases) {
  if (!releases.length) return {};
  const sorted = [...releases].sort((a, b) => compareSemver(a.version, b.version));
  return {
    from: sorted[0].version,
    to: sorted[sorted.length - 1].version,
    fromDate: sorted[0].date,
    toDate: sorted[sorted.length - 1].date,
  };
}

function buildPrompt({ sourceName, flatItems, globalFilters, sourceFilters }) {
  const globalRules = globalFilters.length
    ? globalFilters.map(f => `- ${f}`).join('\n')
    : '(none)';
  const sourceRules = sourceFilters.length
    ? sourceFilters.map(f => `- ${f}`).join('\n')
    : '(none)';
  const itemLines = flatItems
    .map((item, i) => `${i + 1}. [v${String(item.version).replace(/^v/, '')}] ${item.text}`)
    .join('\n');

  return `You are analyzing release notes for: ${sourceName}

Filter rules — mark an item irrelevant if it matches any of these:
Global:
${globalRules}
Source-specific:
${sourceRules}

Items:
${itemLines}

Return JSON only — no prose, no markdown fences:
{
  "relevant": {"<number>": "<2-4 word category>"},
  "irrelevant": {"<number>": "<reason ≤6 words>"}
}

Keys are item numbers as strings. Every item number must appear in exactly one object.`;
}

function buildCanonicalSchema({ sourceName, parsedReleases, flatItems, scored, globalFilters, sourceFilters }) {
  const latestVersion = parsedReleases.reduce(
    (max, r) => (compareSemver(r.version, max) > 0 ? r.version : max),
    parsedReleases[0]?.version ?? ''
  );

  const excluded = [];
  const byTopic = {};

  for (let i = 0; i < flatItems.length; i++) {
    const key = String(i + 1);
    const item = flatItems[i];
    if (scored.irrelevant?.[key] !== undefined) {
      excluded.push({ text: item.text, version: item.version, reason: scored.irrelevant[key] });
    } else if (scored.relevant?.[key] !== undefined) {
      const topic = scored.relevant[key];
      const type = inferType(item.text);
      (byTopic[topic] = byTopic[topic] || []).push({ text: item.text, version: item.version, date: item.date, type });
    }
  }

  const topics = Object.entries(byTopic).map(([name, items]) => ({ name, items }));

  return {
    tool: sourceName,
    latestVersion,
    versionRange: buildVersionRange(parsedReleases),
    globalFilters,
    sourceFilters,
    topics,
    excluded,
  };
}

export async function scoreSource({ sourceName, parsedReleases, globalFilters, sourceFilters }) {
  const flatItems = parsedReleases.flatMap(release =>
    (release.items || []).map(text => ({ text, version: release.version, date: release.date }))
  );

  if (flatItems.length === 0) {
    return {
      tool: sourceName,
      latestVersion: parsedReleases[0]?.version ?? null,
      versionRange: buildVersionRange(parsedReleases),
      globalFilters,
      sourceFilters,
      topics: [],
      excluded: [],
    };
  }

  const prompt = buildPrompt({ sourceName, flatItems, globalFilters, sourceFilters });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5@20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].text.trim();
  const scored = JSON.parse(raw);

  return buildCanonicalSchema({ sourceName, parsedReleases, flatItems, scored, globalFilters, sourceFilters });
}
```

- [ ] **Step 3: Smoke-test scorer against real data (requires GCP auth)**

```bash
node -e "
import('./src/fetchers/github-releases.mjs').then(async ({ fetchGithubReleases }) => {
  const { releases } = await fetchGithubReleases({ url: 'anthropics/claude-code', lastVersion: null });
  const recent = { releases: releases.slice(0, 2) };
  const { scoreSource } = await import('./src/llm/scorer.mjs');
  const result = await scoreSource({
    sourceName: 'claude-code',
    parsedReleases: recent.releases,
    globalFilters: ['Windows or WSL specific'],
    sourceFilters: [],
  });
  console.log('topics:', result.topics.map(t => t.name));
  console.log('excluded:', result.excluded.length);
  console.log('latestVersion:', result.latestVersion);
})"
```

Expected: topic names printed, excluded count, version string.

- [ ] **Step 4: Commit**

```bash
git add src/llm/scorer.mjs
git commit -m "feat: add LLM scorer with single SDK call per source"
```

---

### Task 5: Move Renderer Files

**Files:**
- Create: `src/renderer/render.mjs` (moved from `skills/.../scripts/render.mjs`, +export `render`)
- Create: `src/renderer/mark-read-server.mjs` (moved from `skills/.../scripts/mark-read-server.mjs`, no change)
- Create: `src/renderer/templates/newsletter.html` (moved, no change)
- Create: `src/renderer/render.test.mjs` (moved + updated imports + inferType tests)

**Interfaces:**
- Produces: `render(jsonString: string, opts?: { historical?: boolean }) → Promise<void>` exported from `render.mjs`
- All other exports (`compareSemver`, `validateToolResult`, `buildItemsHtml`, etc.) unchanged

- [ ] **Step 1: Copy newsletter.html**

```bash
mkdir -p src/renderer/templates
cp skills/feed-digest/templates/newsletter.html src/renderer/templates/newsletter.html
```

- [ ] **Step 2: Copy and update mark-read-server.mjs**

```bash
cp skills/feed-digest/scripts/mark-read-server.mjs src/renderer/mark-read-server.mjs
```

No code changes needed — it has no local imports.

- [ ] **Step 3: Copy render.mjs, update import path, and export render()**

```bash
cp skills/feed-digest/scripts/render.mjs src/renderer/render.mjs
```

Then make two edits to `src/renderer/render.mjs`:

**Edit 1** — update import (line ~7):
```js
// Before:
import { TEMPLATE_PATH, OUTPUT_DIR } from './paths.mjs';
// After:
import { TEMPLATE_PATH, OUTPUT_DIR } from '../config/paths.mjs';
```

**Edit 2** — export the `render` function (line ~219):
```js
// Before:
async function render(inputJson, { historical = false } = {}) {
// After:
export async function render(inputJson, { historical = false } = {}) {
```

- [ ] **Step 4: Copy render.test.mjs, update import path, add inferType tests**

```bash
cp skills/feed-digest/scripts/render.test.mjs src/renderer/render.test.mjs
```

Edit `src/renderer/render.test.mjs`:

**Edit 1** — update import (line 2):
```js
// Before:
import { compareSemver, validateToolResult, buildItemsHtml, buildTopicItemsHtml, buildTypeGroupsHtml } from './render.mjs';
// After:
import { compareSemver, validateToolResult, buildItemsHtml, buildTopicItemsHtml, buildTypeGroupsHtml } from './render.mjs';
import { inferType } from '../llm/scorer.mjs';
```

**Edit 2** — add `inferType` test block after the `buildTypeGroupsHtml` block and before the item links block:

```js
// --- inferType ---
console.log('\ninferType:');
assert(inferType('Added MCP server support') === 'new', 'add → new');
assert(inferType('New streaming API') === 'new', 'new → new');
assert(inferType('Fixed crash on startup') === 'fix', 'fix → fix');
assert(inferType('Resolve deadlock in queue') === 'fix', 'resolve → fix');
assert(inferType('Improved performance of tool calls') === 'improved', 'improved → improved');
assert(inferType('Better error messages in CLI') === 'improved', 'no prefix → improved');
```

- [ ] **Step 5: Run tests**

```bash
node src/renderer/render.test.mjs
```

Expected: all tests pass, `N passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/
git commit -m "feat: move renderer files to src/renderer/, export render()"
```

---

### Task 6: Entry Point

**Files:**
- Create: `src/index.mjs`

**Interfaces:**
- Consumes:
  - `loadConfig()`, `loadSourceState()`, `computeCutoff()` from `./config/loader.mjs`
  - `fetchGithubReleases({ url, tagPrefix, lastVersion })` from `./fetchers/github-releases.mjs`
  - `scoreSource({ sourceName, parsedReleases, globalFilters, sourceFilters })` from `./llm/scorer.mjs`
  - `render(jsonString, { historical })` from `./renderer/render.mjs`

- [ ] **Step 1: Create src/index.mjs**

```js
import { loadConfig, loadSourceState, computeCutoff } from './config/loader.mjs';
import { fetchGithubReleases } from './fetchers/github-releases.mjs';
import { scoreSource } from './llm/scorer.mjs';
import { render } from './renderer/render.mjs';

function parseSinceArg(since) {
  if (!since) return null;
  // Version override: "v2.0.111" or "2.0.111"
  if (/^v?\d+\.\d+/.test(since)) return { lastVersion: since };
  // Relative date: "last week", "last month"
  if (/last\s+week/i.test(since)) {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return { since: d.toISOString().slice(0, 10) };
  }
  if (/last\s+month/i.test(since)) {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return { since: d.toISOString().slice(0, 10) };
  }
  // ISO date: "2026-01-15"
  if (/^\d{4}-\d{2}-\d{2}$/.test(since)) return { since };
  throw new Error(`Cannot parse --since value: "${since}". Use a version (v2.0.111), ISO date (2026-01-15), or "last week".`);
}

async function main() {
  const args = process.argv.slice(2);
  const historical = args.includes('--historical');

  let sinceOverride = null;
  const sinceIdx = args.indexOf('--since');
  if (sinceIdx !== -1 && args[sinceIdx + 1]) {
    sinceOverride = parseSinceArg(args[sinceIdx + 1]);
  }

  const config = loadConfig();
  const globalFilters = config.preferences?.ignore ?? [];
  const sources = Object.entries(config.sources ?? {})
    .filter(([, src]) => src.enabled !== false);

  if (sources.length === 0) {
    console.log('No enabled sources in config.');
    return;
  }

  // Fetch all sources in parallel
  const fetchResults = await Promise.all(
    sources.map(async ([name, src]) => {
      try {
        const state = loadSourceState(name);
        const cutoff = sinceOverride ?? computeCutoff(src, state);
        const data = await fetchGithubReleases({
          url: src.url,
          tagPrefix: src.tagPrefix ?? null,
          lastVersion: cutoff.lastVersion ?? null,
        });
        return { name, data, src };
      } catch (e) {
        console.error(`⚠ ${name}: fetch failed — ${e.message}`);
        return { name, error: e.message, src };
      }
    })
  );

  // Score all sources in parallel
  const results = await Promise.all(
    fetchResults.map(async ({ name, data, error, src }) => {
      if (error) return { tool: name, error };
      if (!data.releases.length) {
        return {
          tool: name,
          latestVersion: data.latestVersion,
          versionRange: {},
          globalFilters,
          sourceFilters: src.preferences?.ignore ?? [],
          topics: [],
          excluded: [],
        };
      }
      try {
        return await scoreSource({
          sourceName: name,
          parsedReleases: data.releases,
          globalFilters,
          sourceFilters: src.preferences?.ignore ?? [],
        });
      } catch (e) {
        console.error(`⚠ ${name}: scoring failed — ${e.message}`);
        return { tool: name, error: e.message };
      }
    })
  );

  const totalItems = results
    .filter(r => r.topics)
    .reduce((sum, r) => sum + r.topics.reduce((s, t) => s + t.items.length, 0), 0);

  if (totalItems === 0 && results.every(r => !r.error)) {
    console.log('All caught up — no new items.');
    return;
  }

  await render(JSON.stringify(results), { historical });

  const versions = results
    .filter(r => r.latestVersion)
    .map(r => `${r.tool}: ${r.latestVersion}`)
    .join(', ');
  console.log(`${totalItems} new items across ${sources.length} sources. Latest: ${versions}`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
```

- [ ] **Step 2: Run end-to-end (requires GCP auth and gh CLI)**

```bash
node src/index.mjs
```

Expected: HTML file opens in browser. Console prints item count and latest versions.

- [ ] **Step 3: Test historical mode**

```bash
node src/index.mjs --since "last week"
```

Expected: HTML opens with historical banner, "Mark as Read" button hidden.

- [ ] **Step 4: Test version-based override**

```bash
node src/index.mjs --since v2.1.100
```

Expected: items since v2.1.100 shown, historical banner visible.

- [ ] **Step 5: Commit**

```bash
git add src/index.mjs
git commit -m "feat: add entry point with full pipeline orchestration"
```

---

### Task 7: Remove skills/ and Update README

**Files:**
- Delete: `skills/` directory
- Delete: `.claude-plugin/` directory
- Modify: `README.md`

- [ ] **Step 1: Run tests one final time before deleting**

```bash
node src/renderer/render.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Delete the old skill tree**

```bash
rm -rf skills/ .claude-plugin/
```

- [ ] **Step 3: Update README.md**

Replace the "Installation" and "Usage" sections. The new invocation is:

```bash
node src/index.mjs
node src/index.mjs --since "last week"
node src/index.mjs --since v2.1.100
node src/index.mjs --historical
```

The config file location (`~/.claude/feed-digest/config.json`) and schema are unchanged.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: replace skill orchestration with standalone SDK script"
```

---

## Verification

```bash
# Install deps
yarn install

# Unit tests
node src/renderer/render.test.mjs
# Expected: N passed, 0 failed

# Full run
node src/index.mjs
# Expected: browser opens with digest HTML, console shows item count

# Historical mode
node src/index.mjs --since "last week"
# Expected: orange "Historical view" banner, no mark-read button

# No-new-items case (after marking as read)
node src/index.mjs
# Expected: "All caught up — no new items."
```
