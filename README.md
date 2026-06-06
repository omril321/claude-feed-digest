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

The config has two top-level keys:

```json
{
  "preferences": {
    "ignore": [
      "Windows or WSL specific",
      "JetBrains plugin",
      "VSCode, Cursor, or Windsurf IDE-specific"
    ]
  },
  "sources": {
    "my-tool": {
      "enabled": true,
      "feedType": "github-releases",
      "url": "owner/repo",
      "maxFirstRunDays": 7,
      "preferences": {
        "ignore": ["feature X — not relevant to my setup"]
      }
    }
  }
}
```

### Two levels of filtering

**Global** (`preferences.ignore`) — applies to every source. Put things that are never relevant to you regardless of tool: OS-specific items, IDE integrations you don't use, etc.

**Per-source** (`sources.<name>.preferences.ignore`) — applies only to that source. Put things that are specific to one tool's context.

Topics are **auto-generated** — the fetcher assigns short labels (e.g. "MCP & Tools", "Performance", "Bug Fixes") per item. No config needed.

### `feedType` options

| Value | Source | `url` format |
|---|---|---|
| `github-releases` | GitHub Releases API | `owner/repo` |
| `rss` or `atom` | RSS/Atom feed | full URL |
| `html` | HTML changelog page | full URL |

### Adding a source

Any tool with a GitHub repo, RSS feed, or HTML changelog page works. Add an entry under `sources`. Example — adding [Plannotator](https://github.com/backnotprop/plannotator):

```json
{
  "sources": {
    "plannotator": {
      "enabled": true,
      "feedType": "github-releases",
      "url": "backnotprop/plannotator",
      "maxFirstRunDays": 7,
      "preferences": {
        "ignore": []
      }
    }
  }
}
```

To temporarily mute a source without removing it, set `"enabled": false`.

## How it works

feed-digest uses a **two-stage subagent pipeline** designed for reliability and low cost:

### Stage 1 — Fetch (one agent per source, in parallel)

Each source gets its own **fetcher agent** (Claude Sonnet, up to 8 turns). Its only job is to fetch the feed and filter for relevance — no schema pressure. It runs `curl` or `gh api`, scores each item 0–10 against your `interests`/`ignore` lists, excludes items scoring < 4, and returns loose JSON. Because it doesn't have to care about output structure, it can focus entirely on data quality.

### Stage 2 — Format (one agent per result, in parallel)

Each fetcher result is immediately handed to a **formatter agent** (Claude Haiku, 1 turn, no tools). Its only job is structural: convert the fetcher's loose output into the exact canonical schema the renderer expects. Single-shot, deterministic, cheap. Separating this concern means schema compliance doesn't compete with data collection.

### Render

The formatted results are merged and piped to a local Node.js renderer that produces the HTML digest and spawns a mark-read server (2-hour TTL). Clicking "Mark as Read" persists your version cursor — next run starts from there.

## Requirements

- Claude Code **v2.1.154 or later** (plugin support + subagent model selection)
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
