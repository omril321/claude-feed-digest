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
