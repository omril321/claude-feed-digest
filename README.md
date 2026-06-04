# feed-digest

A Claude Code plugin that fetches updates from sources you follow, filters entries by your personal relevance preferences, and renders a styled HTML digest in your browser.

Works with **GitHub Releases**, **RSS/Atom feeds**, and **HTML changelog pages**. Add any tool — not just Claude Code. Configure what matters to you, ignore the noise.

## What it looks like

Each run opens an HTML page in your browser:

- Sources are grouped into sections (one per tool/feed)
- Within each section, entries are grouped by **topic** (e.g. "MCP & Tools", "Agents", "Performance") — you define the topics per source
- Within each topic, items are grouped by type: **✦ New** → **⬆ Improved** → **⚙ Fixed**, each collapsible
- Release dates shown under each version range
- Filtered items are hidden but viewable via "Show N filtered items"
- Active filter rules shown at the top (collapsed by default)
- **Mark as Read** button advances your version cursor — next run shows only entries newer than what you just read
- **Historical mode**: `/feed-digest since v2.1.139` or `/feed-digest since last week` re-runs read-only with no state change

## Install

```
/plugin marketplace add omril321/claude-feed-digest
/plugin install feed-digest@feed-digest
```

Then run it:

```
/feed-digest
```

Or say: "check changelogs", "what's new in my tools", "tool updates".

## Config

Config lives at `~/.claude/feed-digest/config.json` — **user-owned and git-trackable** in your dotfiles. On first run the plugin seeds it from the bundled `config.default.json`.

The config is a JSON object with a `tools` array. Each entry:

```json
{
  "name": "my-tool",
  "enabled": true,
  "feedType": "github-releases",
  "url": "owner/repo",
  "maxFirstRunDays": 7,
  "preferences": {
    "platform": "mac",
    "interests": ["new features", "performance improvements"],
    "ignore": ["Windows-specific", "items prefixed with [Windows]"],
    "topics": ["Core", "UI/UX", "Bug Fixes", "Misc"]
  }
}
```

### `feedType` options

| Value | Source | `url` format |
|---|---|---|
| `github-releases` | GitHub Releases API | `owner/repo` |
| `rss` or `atom` | RSS/Atom feed | full URL |
| `html` | HTML changelog page | full URL |

### `preferences`

- **`interests`**: what you care about. Items matching these score higher and are included.
- **`ignore`**: what to exclude. Matching items are filtered out (shown collapsed in the digest).
- **`topics`**: groupings shown in the digest. Items are LLM-assigned to the best-fit topic. Put `"Misc"` last as a catch-all.
- **`platform`**: informs filtering (e.g. `"mac"` — Windows-specific items ignored by default).

### Adding a source

Any tool with a GitHub repo, RSS feed, or HTML changelog page works. Example — adding [Plannotator](https://github.com/backnotprop/plannotator):

```json
{
  "name": "plannotator",
  "enabled": true,
  "feedType": "github-releases",
  "url": "backnotprop/plannotator",
  "maxFirstRunDays": 7,
  "preferences": {
    "platform": "mac",
    "interests": ["new features", "UI/UX improvements", "bug fixes"],
    "ignore": ["Windows-specific"],
    "topics": ["Core", "UI/UX", "Bug Fixes", "Misc"]
  }
}
```

## How it works

1. Reads your config, loads per-tool version state
2. Spawns one subagent per source in parallel — each fetches and filters its feed
3. Each entry is LLM-scored 0–10 for relevance against your `interests`/`ignore` lists; items scoring < 4 are excluded
4. Results are grouped by topic and rendered into an HTML digest
5. A local mark-read server runs for 2 hours — clicking "Mark as Read" persists your version cursor so the next run starts from where you left off

## Requirements

- Claude Code with plugin support
- `gh` CLI authenticated (for `github-releases` sources)
- macOS (`open` is used to launch the HTML in your browser)

## State & output

| Location | What |
|---|---|
| `~/.claude/feed-digest/config.json` | Your config (user-owned, git-trackable) |
| `~/.claude/plugins/data/feed-digest-feed-digest/state/` | Per-tool version cursors |
| `~/.claude/plugins/data/feed-digest-feed-digest/output/` | Generated HTML digests |

## Local development

```bash
# Load from local dir — no install needed
claude --plugin-dir ~/path/to/claude-feed-digest

# After editing source files
/reload-plugins

# Validate before publishing
claude plugin validate ~/path/to/claude-feed-digest
```

## License

MIT
