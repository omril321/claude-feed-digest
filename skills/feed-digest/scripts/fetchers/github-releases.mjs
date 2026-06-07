#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: github-releases.mjs <owner/repo> [--tag-prefix PREFIX] [--last-version VERSION]');
    process.exit(1);
  }

  const url = args[0];
  let tagPrefix = null;
  let lastVersion = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--tag-prefix' && i + 1 < args.length) {
      tagPrefix = args[++i];
    } else if (args[i] === '--last-version' && i + 1 < args.length) {
      lastVersion = args[++i];
    }
  }

  return { url, tagPrefix, lastVersion };
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

function fetchReleases(url) {
  try {
    const tmpFile = join(tmpdir(), `gh-releases-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

    const result = spawnSync('gh', ['api', `repos/${url}/releases?per_page=100`, '--paginate'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    });

    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || 'gh command failed');

    return JSON.parse(result.stdout);
  } catch (e) {
    throw new Error(`fetch failed: ${e.message}`);
  }
}

function filterByTagPrefix(releases, tagPrefix) {
  if (!tagPrefix) return releases;
  return releases.filter(r => r.tag_name.startsWith(tagPrefix));
}

function buildReleases(releases, lastVersion, tagPrefix) {
  const normalized = releases.map(r => ({
    version: r.tag_name,
    versionForCompare: tagPrefix ? r.tag_name.slice(tagPrefix.length) : r.tag_name,
    date: r.published_at ? r.published_at.split('T')[0] : 'unknown',
    items: parseReleaseBody(r.body),
  }));

  if (lastVersion) {
    const lastCompare = tagPrefix ? lastVersion.slice(tagPrefix.length) : lastVersion;
    return normalized.filter(r => compareSemver(r.versionForCompare, lastCompare) > 0);
  }

  return normalized;
}

function main() {
  try {
    const { url, tagPrefix, lastVersion } = parseArgs();
    const allReleases = fetchReleases(url);
    const filtered = filterByTagPrefix(allReleases, tagPrefix);
    const releases = buildReleases(filtered, lastVersion, tagPrefix);

    const latestVersion = allReleases.length > 0
      ? allReleases[0].tag_name
      : null;

    const output = {
      latestVersion,
      releases: releases.map(r => ({
        version: r.version,
        date: r.date,
        items: r.items,
      })),
    };

    console.log(JSON.stringify(output));
  } catch (e) {
    const output = {
      error: e.message,
      latestVersion: null,
      releases: [],
    };
    console.log(JSON.stringify(output));
    process.exit(1);
  }
}

main();
