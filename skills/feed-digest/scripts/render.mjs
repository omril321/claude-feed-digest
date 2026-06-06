import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execFileSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'net';
import { TEMPLATE_PATH, OUTPUT_DIR } from './paths.mjs';

export function compareSemver(a, b) {
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

export function validateToolResult(result) {
  if (!result || typeof result !== 'object') return { ok: false, reason: 'not an object' };
  if (result.error) return { ok: false, reason: result.error };
  if (!result.tool) return { ok: false, reason: 'missing tool' };
  if (!Array.isArray(result.topics)) return { ok: false, reason: 'missing topics array' };
  if (!result.latestVersion) return { ok: false, reason: 'missing latestVersion' };
  return { ok: true };
}

export function getExcluded(result) {
  if (Array.isArray(result.excluded)) return result.excluded;
  return [];
}

// Legacy helper kept for tests
export function buildItemsHtml(items, category) {
  if (!items || items.length === 0) return '';
  return items.map(item => `
    <li class="item item--${category}">
      <span class="item__version">v${item.version}</span>
      <span class="item__text">${escapeHtml(item.text)}</span>
    </li>`).join('');
}

export function buildTopicItemsHtml(items) {
  if (!items || items.length === 0) return '';
  return items.map(item => {
    const linkHtml = item.link
      ? ` <a class="item__link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">→ docs</a>`
      : '';
    return `
    <li class="item">
      <span class="item__text">${escapeHtml(item.text)}${linkHtml}</span>
      <span class="item__version">v${escapeHtml(String(item.version).replace(/^v/, ''))}</span>
    </li>`;
  }).join('');
}

export function buildFilterSummaryHtml(results) {
  const filters = results
    .flatMap(r => r.globalFilters || [])
    .filter((f, i, arr) => arr.indexOf(f) === i); // dedupe
  if (filters.length === 0) return '';
  const itemsHtml = filters.map(f => `<li class="filter-item">${escapeHtml(f)}</li>`).join('');
  return `
  <details class="filter-summary">
    <summary class="filter-summary__toggle">Global filters <span class="filter-summary__count">${filters.length}</span></summary>
    <ul class="filter-summary__list">${itemsHtml}</ul>
  </details>`;
}

export function buildSourceFilterHtml(sourceFilters) {
  if (!sourceFilters || sourceFilters.length === 0) return '';
  const itemsHtml = sourceFilters.map(f => `<li class="filter-item">${escapeHtml(f)}</li>`).join('');
  return `
    <details class="filter-summary filter-summary--source">
      <summary class="filter-summary__toggle">Source filters <span class="filter-summary__count">${sourceFilters.length}</span></summary>
      <ul class="filter-summary__list">${itemsHtml}</ul>
    </details>`;
}

export function buildExcludedHtml(excluded, toolIndex) {
  if (!excluded || excluded.length === 0) return '';
  const id = `excluded-${toolIndex}`;
  const itemsHtml = excluded.map(item => `
    <li class="excluded-item">
      <span class="excluded-item__version">v${escapeHtml(String(item.version).replace(/^v/, ''))}</span>
      <span class="excluded-item__text">${escapeHtml(item.text)}</span>
      <span class="excluded-item__reason">${escapeHtml(item.reason)}</span>
    </li>`).join('');
  return `
    <div class="excluded-section">
      <button class="excluded-toggle" onclick="toggleExcluded('${id}')">
        Show ${excluded.length} filtered item${excluded.length !== 1 ? 's' : ''} ▾
      </button>
      <ul class="excluded-list" id="${id}">${itemsHtml}</ul>
    </div>`;
}

const TYPE_CONFIG = {
  new:      { label: '✦ New',      order: 0 },
  improved: { label: '⬆ Improved', order: 1 },
  fix:      { label: '⚙ Fixed',    order: 2 },
};

export function buildTypeGroupsHtml(items) {
  if (!items || items.length === 0) return '';

  const groups = {};
  for (const item of items) {
    const type = TYPE_CONFIG[item.type] ? item.type : 'improved';
    (groups[type] = groups[type] || []).push(item);
  }

  return Object.entries(groups)
    .sort(([a], [b]) => (TYPE_CONFIG[a]?.order ?? 1) - (TYPE_CONFIG[b]?.order ?? 1))
    .map(([type, typeItems]) => {
      const { label } = TYPE_CONFIG[type];
      const itemsHtml = buildTopicItemsHtml(typeItems);
      return `
      <details class="type-group" open>
        <summary class="type-group__summary type-group__summary--${type}">
          <span class="type-group__label">${label}</span>
          <span class="type-group__count">${typeItems.length}</span>
        </summary>
        <ul class="items">${itemsHtml}</ul>
      </details>`;
    }).join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function estimateReadTime(totalItems) {
  return Math.max(1, Math.ceil(totalItems / 15));
}

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(startPort, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', () => {
      if (startPort < 7850) resolve(findFreePort(startPort + 1));
      else reject(new Error('No free port found in range 7832-7850'));
    });
  });
}

function spawnMarkReadServer(port, stateUpdates) {
  const serverScript = join(dirname(fileURLToPath(import.meta.url)), 'mark-read-server.mjs');
  const child = spawn(process.execPath, [serverScript, String(port), JSON.stringify(stateUpdates)], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function renderToolSection(result, toolIndex) {
  const { tool, versionRange, topics } = result;
  const allItems = (topics || []).flatMap(t => t.items || []);
  if (allItems.length === 0) return '';

  const topicsHtml = (topics || []).map(topic => {
    const groupsHtml = buildTypeGroupsHtml(topic.items || []);
    if (!groupsHtml) return '';
    return `
    <div class="topic">
      <h3 class="topic__title">${escapeHtml(topic.name)}</h3>
      ${groupsHtml}
    </div>`;
  }).join('\n');

  const excluded = getExcluded(result);
  const excludedHtml = buildExcludedHtml(excluded, toolIndex);
  const sourceFilterHtml = buildSourceFilterHtml(result.sourceFilters || []);

  const fromVer = versionRange?.from ? `v${String(versionRange.from).replace(/^v/, '')}` : '';
  const toVer   = versionRange?.to   ? `v${String(versionRange.to).replace(/^v/, '')}`   : '';
  const versionLabel = fromVer && toVer && fromVer !== toVer ? `${fromVer} → ${toVer}` : (toVer || fromVer);

  const fromDate = versionRange?.fromDate || '';
  const toDate   = versionRange?.toDate   || '';
  const dateLabel = fromDate && toDate && fromDate !== toDate ? `${fromDate} → ${toDate}` : (toDate || fromDate);

  return `
  <section class="tool-section">
    <div class="tool-header">
      <h2 class="tool-name">${escapeHtml(tool)}</h2>
      <div class="tool-version-meta">
        <span class="tool-versions">${escapeHtml(versionLabel)}</span>
        ${dateLabel ? `<span class="tool-date">${escapeHtml(dateLabel)}</span>` : ''}
      </div>
      <span class="tool-count">${allItems.length} item${allItems.length !== 1 ? 's' : ''}</span>
    </div>
    ${topicsHtml}
    ${sourceFilterHtml}
    ${excludedHtml}
  </section>`;
}

function renderErrorSection(result) {
  return `
  <section class="tool-section tool-section--error">
    <div class="tool-header">
      <h2 class="tool-name">${escapeHtml(result.tool || 'unknown')}</h2>
      <span class="tool-error">⚠ Fetch failed</span>
    </div>
    <p class="error-detail">${escapeHtml(result.error || 'Unknown error')}</p>
  </section>`;
}

async function render(inputJson, { historical = false } = {}) {
  const results = JSON.parse(inputJson);
  if (!Array.isArray(results)) throw new Error('Input must be a JSON array of tool results');

  const today = new Date().toISOString().slice(0, 10);
  const toolSectionsHtml = results.map((result, i) => {
    const validation = validateToolResult(result);
    return validation.ok ? renderToolSection(result, i) : renderErrorSection(result);
  }).join('\n');

  const totalItems = results
    .filter(r => validateToolResult(r).ok)
    .reduce((sum, r) => sum + (r.topics || []).reduce((s, t) => s + (t.items?.length ?? 0), 0), 0);

  if (totalItems === 0 && results.every(r => !validateToolResult(r).ok)) {
    console.log('All tools failed to fetch.');
    process.exit(0);
  }

  let port = 0;
  const historicalBanner = historical
    ? `<div class="historical-banner">⏮ Historical view — state will not be updated</div>`
    : '';

  if (!historical) {
    const stateUpdates = results
      .filter(r => validateToolResult(r).ok)
      .map(r => ({ tool: r.tool, latestVersion: r.latestVersion, today }));
    port = await findFreePort(7832);
    spawnMarkReadServer(port, stateUpdates);
  }

  const filterSummaryHtml = buildFilterSummaryHtml(results.filter(r => validateToolResult(r).ok));

  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const html = template
    .replace(/\{\{date\}\}/g, today)
    .replace(/\{\{filterSummary\}\}/g, filterSummaryHtml)
    .replace(/\{\{toolSections\}\}/g, toolSectionsHtml)
    .replace(/\{\{readTime\}\}/g, String(estimateReadTime(totalItems)))
    .replace(/\{\{generatedAt\}\}/g, new Date().toISOString())
    .replace(/\{\{itemCount\}\}/g, String(totalItems))
    .replace(/\{\{markReadPort\}\}/g, String(port))
    .replace(/\{\{historicalBanner\}\}/g, historicalBanner)
    .replace(/\{\{markReadBarStyle\}\}/g, historical ? 'display:none' : '');

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = join(OUTPUT_DIR, `feed-digest-${today}.html`);
  writeFileSync(outPath, html, 'utf8');
  execFileSync('open', [outPath]);
  console.log(`Opened: ${outPath} (${totalItems} items)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const historical = process.argv.includes('--historical');
  const chunks = [];
  process.stdin.on('data', d => chunks.push(d));
  process.stdin.on('end', async () => {
    try {
      await render(Buffer.concat(chunks).toString('utf8'), { historical });
    } catch (e) {
      console.error('render error:', e.message);
      process.exit(1);
    }
  });
}
