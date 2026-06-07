---
name: feed-digest
description: >
  Fetches updates from sources you follow (changelogs, RSS, and more), filters entries by personal
  relevance, and opens a styled HTML digest in the browser. Tracks versions so only new entries
  are shown on each run. Use when user says /feed-digest, /changelog-feed, "check changelogs",
  "what's new in my tools", or "tool updates".
invocation: user
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/feed-digest/scripts/fetchers/github-releases.mjs *), Bash(cat *), Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/feed-digest/scripts/render.mjs), Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/feed-digest/scripts/render.mjs *), Bash(open *), Read, Write, Agent
---

# Feed Digest

Fetch new entries from all monitored sources, filter by relevance, and render a digest.

---

## Step 0: Detect historical mode (optional)

Check if the user's message contains a historical override like:
- `"since v2.0.111"` or `"since version 2.0.111"` → version floor
- `"since April 26"` / `"since 2026-04-26"` / `"since last month"` → date cutoff

If an override is detected:
- Set `HISTORICAL_MODE = true`
- Compute `OVERRIDE_CUTOFF_ISO` (for date-based) or `OVERRIDE_VERSION` (for version-based)
- In Step 2, pass this as `CUTOFF_ISO` / `LAST_VERSION_SEEN` override **for all tools**, ignoring their state files
- In Step 4, append `--historical` flag to the render command
- In Step 5, **skip state update entirely** (historical views are read-only)

If no override detected, proceed normally (Step 1 onwards).

---

## Step 1: Load config and state

Read `~/.claude/feed-digest/config.json`. If the file does not exist, seed it first:
```bash
mkdir -p ~/.claude/feed-digest && cp ~/.claude/skills/changelog-feed/config.default.json ~/.claude/feed-digest/config.json
```

Config has two top-level keys: `preferences` (global ignore rules) and `sources` (object keyed by source name).

For each enabled source (`enabled: true`) in `config.sources`, read its state file at `~/.claude/feed-digest/state/<source-name>.json`. If the file doesn't exist, this is a first run for that source.

Compute `cutoffISO` for each source **yourself** (do not delegate to subagents):
- **First run** (no state file): subtract `maxFirstRunDays` from today's date. Example: today = 2026-05-28, maxFirstRunDays = 3 → cutoffISO = `2026-05-25`.
- **Subsequent runs**: use the `lastRunISO` from the state file as the cutoff.

---

## Step 2: Fetch and parse all sources in parallel

Dispatch 3 parallel Bash calls to fetch scripts (one per enabled source). Do NOT use Agent.

For each enabled source, run:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/feed-digest/scripts/fetchers/github-releases.mjs \
  <url> \
  [--tag-prefix <prefix>] \
  [--last-version <lastVersionSeen>]
```

Example calls (all in one batch):
```bash
node ~/.claude/skills/changelog-feed/scripts/fetchers/github-releases.mjs anthropics/claude-code --last-version 2.1.160
node ~/.claude/skills/changelog-feed/scripts/fetchers/github-releases.mjs superset-sh/superset --tag-prefix desktop-v --last-version desktop-v1.12.1
node ~/.claude/skills/changelog-feed/scripts/fetchers/github-releases.mjs backnotprop/plannotator --last-version v0.19.26
```

Each script outputs:
```json
{
  "latestVersion": "<newest version in FULL feed>",
  "releases": [
    {"version": "2.1.163", "date": "2026-06-05", "items": ["item text 1", "item text 2"]},
    {"version": "2.1.162", "date": "2026-06-04", "items": [...]}
  ]
}
```

On error, outputs: `{"error":"fetch failed: <reason>","latestVersion":null,"releases":[]}`

Store each output as `parsed_<source-name>.json` temp file for Step 3.

---

## Step 3: Score and format all results in parallel

For each parsed result from Step 2, dispatch one `feed-scorer` Agent. **All in a single message.**

Use `subagent_type: feed-scorer` (defined in `agents/feed-scorer.md`). Each scorer prompt:

```
SOURCE_NAME: "<source-name>"
PARSED_RELEASES: <paste the full releases array from step 2 output — ALL releases, not just the first few>
GLOBAL_FILTERS: <config.preferences.ignore array>
SOURCE_FILTERS: <source.preferences.ignore array (or [] if none)>
```

For each result:
1. Strip markdown code fences if present, parse JSON
2. If invalid JSON: create `{"tool":"<name>","error":"invalid JSON","items":[],"excluded":[],"latestVersion":null}`
3. Validate: must have `tool`, `items` (array), `excluded` (array), `latestVersion`

---

## Step 4: Merge scored results

Collect all scorer agent results from Step 3. Build the canonical schema array:

```json
[
  {
    "tool": "<source-name>",
    "versionRange": {"from":"<oldest version>","to":"<newest version>","fromDate":"YYYY-MM-DD","toDate":"YYYY-MM-DD"},
    "topics": [{"name":"<topic>","items":[...]}],
    "excluded": [...],
    "globalFilters": [...],
    "sourceFilters": [...],
    "latestVersion": "...",
    "error": null
  },
  ...
]
```

For each scorer result:
- Extract items and group by `topic` into `topics` array
- Sort within each topic: `new` first, `improved`, `fix` last
- Compute `versionRange.from/to/fromDate/toDate` from item dates and versions
- Include all `excluded` items
- Add `globalFilters` and `sourceFilters` (copy from config)
- If scorer returned error: include error, set `topics: []`, `excluded: []`

Count total items across all tools. If 0 AND no errors → **"All caught up!"** and stop.

---

## Step 5: Render digest

**Write** merged JSON array to `~/.claude/feed-digest/output/.feed-input-tmp.json` using the Write tool. Then:

```bash
cat ~/.claude/feed-digest/output/.feed-input-tmp.json | node ~/.claude/skills/changelog-feed/scripts/render.mjs
```

Requires `dangerouslyDisableSandbox: true` (render script binds a local port).

Writes to `~/.claude/feed-digest/output/feed-digest-YYYY-MM-DD.html` and opens in browser.

---

## Step 6: State is handled by the digest

**Do not write state files.** Mark-read server is spawned by the render script. State updates only when user clicks "Mark as Read".

Exception: `HISTORICAL_MODE = true` → mark-read button hidden, state never updated.

---

## Step 7: Report to user

**"Opened digest — N new items across M tools. Versions covered: [tool: vX→vY, ...]"**

If errors: "⚠ [tool-name] failed to fetch — will retry next run."
