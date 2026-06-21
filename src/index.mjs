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
        if (src.feedType !== 'github-releases') {
          console.error(`⚠ ${name}: feedType "${src.feedType}" is not yet supported — skipping`);
          return { name, error: `feedType "${src.feedType}" not yet supported`, src };
        }
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
