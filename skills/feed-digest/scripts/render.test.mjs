// Simple test runner — no test framework needed
import { compareSemver, validateToolResult, buildItemsHtml, buildTopicItemsHtml, buildTypeGroupsHtml } from './render.mjs';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// --- compareSemver ---
console.log('\ncompareSemver:');
assert(compareSemver('2.1.155', '2.1.150') > 0, '2.1.155 > 2.1.150');
assert(compareSemver('2.1.99', '2.1.100') < 0, '2.1.99 < 2.1.100 (not string sort)');
assert(compareSemver('2.2.0', '2.1.155') > 0, '2.2.0 > 2.1.155');
assert(compareSemver('3.0.0', '2.9.9') > 0, '3.0.0 > 2.9.9');
assert(compareSemver('2.1.150', '2.1.150') === 0, 'equal versions');
assert(compareSemver('1.0', '0.9') > 0, 'handles 2-part versions');
assert(compareSemver('v2.1.155', '2.1.150') > 0, 'strips leading v');

// --- validateToolResult ---
console.log('\nvalidateToolResult:');
const validResult = {
  tool: 'claude-code',
  versionRange: { from: '2.1.150', to: '2.1.155' },
  topics: [{ name: 'MCP & Tools', items: [] }],
  excludedCount: 5,
  latestVersion: '2.1.155',
  error: null
};
assert(validateToolResult(validResult).ok === true, 'valid result passes');
assert(validateToolResult({ tool: 'x', error: 'fetch failed' }).ok === false, 'error result fails');
assert(validateToolResult({ tool: 'x' }).ok === false, 'missing topics fails');
assert(validateToolResult(null).ok === false, 'null fails');
assert(validateToolResult('not json').ok === false, 'string fails');

// --- buildItemsHtml (legacy, kept for compat) ---
console.log('\nbuildItemsHtml:');
const items = [{ text: 'Add new MCP tool', version: '2.1.155', relevance: 9 }];
const html = buildItemsHtml(items, 'feature');
assert(html.includes('Add new MCP tool'), 'includes item text');
assert(html.includes('2.1.155'), 'includes version');
assert(html.includes('feature'), 'includes category class');
assert(buildItemsHtml([], 'fix') === '', 'empty items returns empty string');

// --- buildTopicItemsHtml ---
// Note: type badges are now in group headers (buildTypeGroupsHtml), not per item
console.log('\nbuildTopicItemsHtml:');
const topicItems = [{ text: 'Fixed MCP reconnect loop', version: '2.1.153', type: 'fix', relevance: 8 }];
const topicHtml = buildTopicItemsHtml(topicItems);
assert(topicHtml.includes('Fixed MCP reconnect loop'), 'includes item text');
assert(topicHtml.includes('2.1.153'), 'includes version');
assert(!topicHtml.includes('item__type'), 'no per-item type badge (moved to group header)');
assert(buildTopicItemsHtml([]) === '', 'empty items returns empty string');
const newItem = buildTopicItemsHtml([{ text: 'New hook', version: '2.1.152', type: 'new', relevance: 9 }]);
assert(!newItem.includes('item__type--new'), 'no per-item type class (in group header instead)');

// --- buildTypeGroupsHtml ---
console.log('\nbuildTypeGroupsHtml:');
const mixedItems = [
  { text: 'Fix crash', version: '2.1.153', type: 'fix', relevance: 7 },
  { text: 'New hook', version: '2.1.152', type: 'new', relevance: 9 },
  { text: 'Better perf', version: '2.1.151', type: 'improved', relevance: 6 },
];
const groupsHtml = buildTypeGroupsHtml(mixedItems);
assert(groupsHtml.includes('<details'), 'uses details element');
assert(groupsHtml.includes('type-group__summary--new'), 'has new group header');
assert(groupsHtml.includes('type-group__summary--fix'), 'has fix group header');
assert(groupsHtml.includes('✦ New'), 'new label correct');
assert(groupsHtml.includes('⚙ Fixed'), 'fix label correct');
assert(groupsHtml.indexOf('New') < groupsHtml.indexOf('Improved'), 'new before improved');
assert(groupsHtml.indexOf('Improved') < groupsHtml.indexOf('Fixed'), 'improved before fixed');
assert(buildTypeGroupsHtml([]) === '', 'empty returns empty string');

// --- item links ---
console.log('\nitem links:');
const linkedItem = buildTopicItemsHtml([{ text: 'Added MessageDisplay hook', version: '2.1.152', type: 'new', relevance: 9, link: 'https://example.com/docs' }]);
assert(linkedItem.includes('href="https://example.com/docs"'), 'link rendered as href');
assert(linkedItem.includes('→ docs'), 'link label shown');
const noLinkItem = buildTopicItemsHtml([{ text: 'Fixed crash', version: '2.1.153', type: 'fix', relevance: 7 }]);
assert(!noLinkItem.includes('href'), 'no link when not present');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
