# Feed Digest — SDK Rewrite Design

## Context

The current implementation is a Claude Code skill (SKILL.md) that orchestrates Claude agent subagents to fetch, score, and format feed items. This tightly couples the tool to Claude Code's agent system, makes the LLM calls non-deterministic (multi-turn agents), and wastes tokens by letting the scorer re-express data it was already handed.

Goal: replace the skill-based orchestration with a standalone Node.js script (`node src/index.mjs`) that uses `@anthropic-ai/vertex-sdk` directly. Data fetching is fully deterministic (no LLM). LLM is used exactly once per source for two jobs simultaneously: filter irrelevant items and assign a category to each relevant item.

---

## Architecture

```
src/
  index.mjs                  # entry point, CLI args, top-level pipeline
  config/
    loader.mjs               # load user config.json + state files, compute cutoffs
    paths.mjs                # DATA_DIR, STATE_DIR, OUTPUT_DIR (moved from scripts/)
  fetchers/
    github-releases.mjs      # moved from scripts/fetchers/ (no logic change)
  llm/
    scorer.mjs               # single SDK call per source → scored + categorized output
  renderer/
    render.mjs               # moved from scripts/ (no logic change)
    mark-read-server.mjs     # moved from scripts/ (no logic change)
    templates/
      newsletter.html        # moved from templates/ (no change)
package.json                 # NEW — @anthropic-ai/vertex-sdk dep
```

The `skills/` directory is removed. The HTML template and render/state machinery are reused verbatim — only their location changes.

---

## Pipeline (src/index.mjs)

```
1. Load config + state         → {sources[], globalFilters[], cutoffs{}}
2. Fetch all sources           → parallel, one process per source
3. Score + categorize          → parallel, one SDK call per source
4. Build canonical schema      → pure JS, no LLM
5. Render HTML                 → call render.mjs logic directly (import, not pipe)
6. Report to stdout
```

Historical mode (`--since v2.0.111` or `--since "last week"`): override cutoff, pass `--historical` flag to renderer. State files not written.

---

## LLM Call Design (src/llm/scorer.mjs)

### What gets sent to the LLM

Flatten all items across all releases for a source into a numbered list. Include version prefix as context. Items are text-only — metadata (version, date, link) stays in our array and is joined back by index after the response.

```
You are analyzing release notes for: {sourceName}

Filter rules — mark an item irrelevant if it matches any of these:
Global:
- Windows or WSL specific — including PowerShell, .exe, WSL, Windows paths
- JetBrains plugin
Source-specific:
- (none)

Items:
1. [v2.1.163] Added MCP server support in the API
2. [v2.1.163] Fixed crash on Windows startup
3. [v2.1.162] Improved performance of tool calls
4. [v2.1.162] Added JetBrains plugin support

Return JSON only — no prose, no markdown fences:
{
  "relevant": {"1": "MCP & Tools", "3": "Performance"},
  "irrelevant": {"2": "Windows-specific", "4": "JetBrains plugin"}
}

Keys in both objects are item numbers as strings.
"relevant" value: a short 2–4 word category label.
"irrelevant" value: a short reason (≤ 6 words).
Every item number must appear in exactly one object.
```

### Model

`claude-haiku-4-5@20251001` (Vertex format). Single-turn, `max_tokens: 1024`. No tools.

### Joining back

After the response, `scorer.mjs` reassociates each item number with its original `{text, version, date, link}` from the flat array. Type (`new|improved|fix`) is inferred from item text using a heuristic (no LLM):
- Starts with Add/New/Support/Introduce → `new`
- Starts with Fix/Resolve/Correct/Patch/Prevent → `fix`
- Otherwise → `improved`

### Output of scorer.mjs

```ts
{
  tool: string,
  latestVersion: string,
  versionRange: { from, to, fromDate, toDate },
  globalFilters: string[],
  sourceFilters: string[],
  topics: Array<{ name: string, items: Array<{ text, version, date, type, link? }> }>,
  excluded: Array<{ text, version, reason }>
}
```

This is the same canonical schema `render.mjs` already consumes — no changes to the renderer.

---

## Config & State (unchanged schema)

User config: `~/.claude/feed-digest/config.json`
State files: `~/.claude/feed-digest/state/<source-name>.json`

`config/loader.mjs` reads both, computes per-source `lastVersion` (or `maxFirstRunDays` fallback), and returns what the fetchers and scorer need. No new fields.

---

## Fetching (src/fetchers/github-releases.mjs)

Logic moved verbatim from `skills/feed-digest/scripts/fetchers/github-releases.mjs`. Called as a module function (not a subprocess) from `index.mjs`:

```js
import { fetchGithubReleases } from './fetchers/github-releases.mjs';
const raw = await fetchGithubReleases({ url, lastVersion });
```

The current script is already self-contained and correct — refactor to export a function, remove the CLI-only argv handling.

---

## package.json

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

No bundler. Node.js ESM. `@anthropic-ai/sdk` types are importable from vertex-sdk as a bundled dep (error classes, message types).

---

## Error Handling

Per-source errors (fetch failure, SDK error, JSON parse failure) produce `{ tool, error }` — same shape `render.mjs` already handles. One source failing does not block others.

---

## Verification

```bash
# Install
yarn install

# Run against real data
node src/index.mjs

# Historical mode
node src/index.mjs --since "last week"

# Unit tests (render helpers, semver, type inference)
node src/renderer/render.test.mjs
```

Confirm: HTML opens in browser, items grouped by topic, filtered items in collapsed section, version range correct, "Mark as Read" updates state file.
