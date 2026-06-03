# feed-digest

A Claude Code plugin that fetches updates from sources you follow (GitHub Releases, RSS, and more), filters entries by personal relevance using LLM scoring, and renders a styled HTML digest in your browser.

## Features

- **Multi-source**: GitHub Releases today; RSS and more planned
- **Relevance filtering**: per-tool interests/ignore lists, LLM-scored 0–10
- **Grouped by topic**: MCP, Agents, UI/UX, etc. — not just a flat list
- **Type groups**: New / Improved / Fixed, collapsible per group
- **Release dates**: shown under each tool's version range
- **"Mark as Read"**: click once to advance your version cursor; next run shows only new entries
- **Historical mode**: "since v2.1.139" or "since last week" re-runs read-only, no state change
- **User-owned config**: lives in your dotfiles (`~/.claude/feed-digest/config.json`), not inside the plugin

## Install

```shell
/plugin marketplace add omril321/claude-feed-digest
/plugin install feed-digest@feed-digest
```

## Usage

```
/feed-digest
```

Or: "check changelogs", "what's new in my tools", "tool updates".

Historical: "/feed-digest since v2.1.139" or "/feed-digest since last week".

## Config

Config lives at `~/.claude/feed-digest/config.json` — user-owned and git-trackable in your dotfiles. On first run the plugin seeds it from the bundled `config.default.json`.

Example:

```json
{
  "tools": [
    {
      "name": "claude-code",
      "enabled": true,
      "feedType": "github-releases",
      "url": "anthropics/claude-code",
      "maxFirstRunDays": 3,
      "preferences": {
        "platform": "mac",
        "interests": ["new features", "MCP and tool use", "agent capabilities"],
        "ignore": [
          "Windows or WSL specific",
          "JetBrains plugin",
          "VSCode, Cursor, or Windsurf IDE-specific",
          "fast mode"
        ],
        "topics": ["MCP & Tools", "Agents", "Performance", "UI/UX", "Misc"]
      }
    }
  ]
}
```

## State & output

- State (version cursors): `~/.claude/plugins/data/feed-digest-feed-digest/state/<tool>.json`
- Generated HTML digests: `~/.claude/plugins/data/feed-digest-feed-digest/output/`
- User config: `~/.claude/feed-digest/config.json` (stable, survives plugin updates)

## Local development

```shell
claude --plugin-dir ~/path/to/claude-feed-digest
# inside Claude Code:
/reload-plugins
```

Validate before publishing:
```shell
claude plugin validate ~/path/to/claude-feed-digest
```

## Requirements

- Claude Code with plugin support
- `gh` CLI authenticated (for GitHub Releases feeds)
- macOS (uses `open` to launch HTML in browser)
