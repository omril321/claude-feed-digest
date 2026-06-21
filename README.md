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

```bash
git clone https://github.com/omril321/claude-feed-digest
cd claude-feed-digest
yarn install
```

## Usage

Run the digest in your current terminal:

```bash
node src/index.mjs
```

Pass flags to override the version cursor:

```bash
node src/index.mjs --since "last week"
node src/index.mjs --since v2.1.100
node src/index.mjs --historical
```

By default, `--historical` runs read-only (no state change). To query back 7 days from now without updating state:

```bash
node src/index.mjs --since "last week"
```

To jump to a specific version:

```bash
node src/index.mjs --since v2.1.100
```

Each run opens an HTML page in your browser and prints the item count to console.

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

feed-digest runs a **two-stage subagent pipeline** via the Anthropic Vertex SDK, designed for reliability and cost-efficiency:

### Stage 1 — Fetch (one agent per source, in parallel)

Each source gets its own **fetcher agent** (Claude Sonnet, up to 8 turns). It fetches the feed and filters for relevance using `curl` or `gh api`, scores each item 0–10 against your `preferences.ignore` lists, excludes items scoring < 4, and returns structured JSON.

### Stage 2 — Score & Format

Each fetcher result is handed to a **scoring agent** (Claude Haiku, 1 turn, no tools). It validates the JSON, assigns topic labels, and returns the exact canonical schema the renderer expects.

### Render

The formatted results are merged and piped to a local Node.js renderer that produces the HTML digest and spawns a mark-read server (2-hour TTL). Clicking "Mark as Read" persists your version cursor — next run starts from there.

## Requirements

- Node.js 18+
- `gh` CLI authenticated (for `github-releases` sources)
- macOS (`open` is used to launch the HTML in your browser)
- GCP credentials for Vertex AI: `ANTHROPIC_VERTEX_PROJECT_ID` and `CLOUD_ML_REGION` env vars set

## State & output

| Location | What |
|---|---|
| `~/.claude/feed-digest/config.json` | Your config (user-owned, git-trackable) |
| `~/.claude/feed-digest/state/` | Per-tool version cursors |
| `/tmp` (macOS: `$TMPDIR`) | Generated HTML digests (temp files) |

## Local development

```bash
# Run tests
node src/renderer/render.test.mjs

# Run digest locally
node src/index.mjs

# Run with historical flags
node src/index.mjs --since "last week"
```

## License

MIT
