---
name: feed-digest
description: >
  Fetches updates from sources you follow (changelogs, RSS, and more), filters entries by personal
  relevance, and opens a styled HTML digest in the browser. Tracks versions so only new entries
  are shown on each run. Use when user says /feed-digest, /changelog-feed, "check changelogs",
  "what's new in my tools", or "tool updates".
invocation: user
allowed-tools: Bash(curl *), Bash(gh api *), Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/feed-digest/scripts/*), Bash(open *), Read, Write, Agent
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
mkdir -p ~/.claude/feed-digest && cp ${CLAUDE_PLUGIN_ROOT}/skills/feed-digest/config.default.json ~/.claude/feed-digest/config.json
```

For each enabled tool (`enabled: true`), read its state file at `~/.claude/feed-digest/state/<tool-name>.json`. If the file doesn't exist, this is a first run for that tool.

Compute `cutoffISO` for each tool **yourself** (do not delegate to subagents):
- **First run** (no state file): subtract `maxFirstRunDays` from today's date. Example: today = 2026-05-28, maxFirstRunDays = 3 → cutoffISO = `2026-05-25`.
- **Subsequent runs**: use the `lastRunISO` from the state file as the cutoff.

---

## Step 2: Fetch all tools in parallel

For each enabled tool, dispatch one Agent using the agent definition at `${CLAUDE_PLUGIN_ROOT}/skills/feed-digest/agents/feed-fetcher.md`.

**Dispatch ALL agents in a single message** (one turn with multiple Agent tool calls) so they run in parallel. Do not dispatch them sequentially.

Each agent's prompt must include:

```
TOOL_CONFIG: <paste the full JSON object for this tool from config.json>
CUTOFF_ISO: <the cutoffISO you computed for this tool, e.g. "2026-05-25">
LAST_VERSION_SEEN: <lastVersionSeen from state file, or null if first run>

For github-releases tools: filter by VERSION_FLOOR (entries newer than LAST_VERSION_SEEN using semver comparison). For rss/html tools: filter by CUTOFF_ISO date.

Fetch and filter this tool's changelog following the instructions in your system prompt.
Output ONLY the raw JSON array — no markdown fences, no explanation. Do NOT run scripts or open browsers.
```

---

## Step 3: Validate and merge results

Collect all agent results. For each result:
1. Strip any markdown code fences (` ```json ... ``` `) if present — parse the JSON inside
2. If result is not valid JSON, create: `{"tool": "<tool name>", "error": "invalid JSON response", "topics": [], "excluded": [], "latestVersion": null}`
3. Validate: result must have `tool`, `topics` (array), and `latestVersion` fields

Count total items across all valid results (sum of all items in all topics).

If total items = 0 AND no errors → print: **"All caught up! No new entries since last check."** and stop (do not open browser, do not update state).

If total items = 0 BUT some tools errored → proceed to render (error cards will show).

---

## Step 4: Render digest

**Write** the merged results JSON array to `~/.claude/feed-digest/output/.feed-input-tmp.json` using the Write tool (do NOT use echo/bash — large JSON gets truncated in shell commands). Then pipe it to the render script:

```bash
cat ~/.claude/feed-digest/output/.feed-input-tmp.json | node ${CLAUDE_PLUGIN_ROOT}/skills/feed-digest/scripts/render.mjs
```

Note: the render script binds a local port for the mark-read server — this requires `dangerouslyDisableSandbox: true` on the bash command.

The script writes to `~/.claude/feed-digest/output/feed-digest-YYYY-MM-DD.html` and opens it in the browser.

---

## Step 5: State is handled by the digest

**Do not write state files.** The render script spawns a background mark-read server. State is updated only when the user clicks **"Mark as Read"** in the digest. This ensures the user isn't marked as having read entries they never looked at.

Exception: if `HISTORICAL_MODE = true`, the mark-read button is hidden and state is never updated (by design).

---

## Step 6: Report to user

Tell the user: **"Opened digest — N new items across M tools. Versions covered: [tool: vX→vY, ...]"**

If any tools errored: also mention "⚠ [tool-name] failed to fetch — will retry next run."
