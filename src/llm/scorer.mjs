import AnthropicVertex from '@anthropic-ai/vertex-sdk';

let _client = null;
function getClient() {
  if (!_client) {
    _client = new AnthropicVertex({
      projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
      region: process.env.CLOUD_ML_REGION,
    });
  }
  return _client;
}

export function inferType(text) {
  const t = text.toLowerCase();
  if (/^(add|new|support|introduce|implement|enable)/.test(t)) return 'new';
  if (/^(fix|resolve|correct|patch|prevent|repair)/.test(t)) return 'fix';
  return 'improved';
}

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

function buildVersionRange(releases) {
  if (!releases.length) return {};
  const sorted = [...releases].sort((a, b) => compareSemver(a.version, b.version));
  return {
    from: sorted[0].version,
    to: sorted[sorted.length - 1].version,
    fromDate: sorted[0].date,
    toDate: sorted[sorted.length - 1].date,
  };
}

function buildPrompt({ sourceName, flatItems, globalFilters, sourceFilters }) {
  const globalRules = globalFilters.length
    ? globalFilters.map(f => `- ${f}`).join('\n')
    : '(none)';
  const sourceRules = sourceFilters.length
    ? sourceFilters.map(f => `- ${f}`).join('\n')
    : '(none)';
  const itemLines = flatItems
    .map((item, i) => `${i + 1}. [v${String(item.version).replace(/^v/, '')}] ${item.text}`)
    .join('\n');

  return `You are analyzing release notes for: ${sourceName}

Filter rules — mark an item irrelevant if it matches any of these:
Global:
${globalRules}
Source-specific:
${sourceRules}

Items:
${itemLines}

Return JSON only — no prose, no markdown fences:
{
  "relevant": {"<number>": "<2-4 word category>"},
  "irrelevant": {"<number>": "<reason ≤6 words>"}
}

Keys are item numbers as strings. Every item number must appear in exactly one object.`;
}

function buildCanonicalSchema({ sourceName, parsedReleases, flatItems, scored, globalFilters, sourceFilters }) {
  const latestVersion = parsedReleases.reduce(
    (max, r) => (compareSemver(r.version, max) > 0 ? r.version : max),
    parsedReleases[0]?.version ?? ''
  );

  const excluded = [];
  const byTopic = {};

  for (let i = 0; i < flatItems.length; i++) {
    const key = String(i + 1);
    const item = flatItems[i];
    if (scored.irrelevant?.[key] !== undefined) {
      excluded.push({ text: item.text, version: item.version, reason: scored.irrelevant[key] });
    } else if (scored.relevant?.[key] !== undefined) {
      const topic = scored.relevant[key];
      const type = inferType(item.text);
      (byTopic[topic] = byTopic[topic] || []).push({ text: item.text, version: item.version, date: item.date, type });
    }
  }

  const topics = Object.entries(byTopic).map(([name, items]) => ({ name, items }));

  return {
    tool: sourceName,
    latestVersion,
    versionRange: buildVersionRange(parsedReleases),
    globalFilters,
    sourceFilters,
    topics,
    excluded,
  };
}

export async function scoreSource({ sourceName, parsedReleases, globalFilters, sourceFilters }) {
  const flatItems = parsedReleases.flatMap(release =>
    (release.items || []).map(text => ({ text, version: release.version, date: release.date }))
  );

  if (flatItems.length === 0) {
    return {
      tool: sourceName,
      latestVersion: parsedReleases[0]?.version ?? null,
      versionRange: buildVersionRange(parsedReleases),
      globalFilters,
      sourceFilters,
      topics: [],
      excluded: [],
    };
  }

  const prompt = buildPrompt({ sourceName, flatItems, globalFilters, sourceFilters });

  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5@20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = response.content[0].text.trim();
  const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let scored;
  try {
    scored = JSON.parse(stripped);
  } catch {
    console.warn(`[scorer] Failed to parse LLM response for ${sourceName}:`, rawText.slice(0, 200));
    return {
      tool: sourceName,
      latestVersion: parsedReleases[0]?.version ?? null,
      versionRange: buildVersionRange(parsedReleases),
      globalFilters,
      sourceFilters,
      topics: [],
      excluded: [],
    };
  }

  return buildCanonicalSchema({ sourceName, parsedReleases, flatItems, scored, globalFilters, sourceFilters });
}
