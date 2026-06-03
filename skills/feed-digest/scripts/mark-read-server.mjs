#!/usr/bin/env node
// Tiny HTTP server spawned by render.mjs. Stays alive for 2 hours.
// On POST /mark-read, writes state files for all tools in the session, then exits.

import { createServer } from 'http';
import { writeFileSync, mkdirSync } from 'fs';
import { STATE_DIR } from './paths.mjs';
const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const port = parseInt(process.argv[2], 10);
const stateUpdates = JSON.parse(process.argv[3]); // [{tool, latestVersion, today}]

if (!port || !stateUpdates?.length) {
  console.error('Usage: mark-read-server.mjs <port> <stateUpdatesJSON>');
  process.exit(1);
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/mark-read') {
    mkdirSync(STATE_DIR, { recursive: true });
    for (const { tool, latestVersion, today } of stateUpdates) {
      const statePath = join(STATE_DIR, `${tool}.json`);
      writeFileSync(statePath, JSON.stringify({
        lastVersionSeen: latestVersion,
        lastRunISO: today,
      }, null, 2));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, marked: stateUpdates.map(u => u.tool) }));
    server.close(() => process.exit(0));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(port, '127.0.0.1', () => {
  // Silence — this process runs detached
});

// Auto-exit after TTL
setTimeout(() => {
  server.close(() => process.exit(0));
}, TTL_MS).unref();
