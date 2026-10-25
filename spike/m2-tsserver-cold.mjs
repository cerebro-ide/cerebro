// Measurement 2: tsserver cold start time and memory (RSS) until find-usages first answers.
// Usage: node m2-tsserver-cold.mjs <worktree> <file relative to worktree> <symbol> [file to open first...]
// Extra files load their projects, so find-usages also searches those packages.
import path from 'node:path';
import { TsServer, locate } from './tsserver-client.mjs';

const [worktree, relFile, symbol, ...extra] = process.argv.slice(2).map((a, i) => (i === 0 ? path.resolve(a) : a));
const file = path.join(worktree, relFile);
const { line, offset } = locate(file, symbol);

const server = new TsServer(worktree);
for (const f of extra) await server.open(path.join(worktree, f));
await server.open(file);
const response = await server.references(file, line, offset);
const coldMs = performance.now() - server.started;
const refs = response.body?.refs ?? [];

// A second query on the now-warm server, for comparison.
const t = performance.now();
await server.references(file, line, offset);
const warmMs = performance.now() - t;

// Let the process settle, then read its steady RSS.
await new Promise((r) => setTimeout(r, 2000));
const result = {
    worktree: path.basename(worktree),
    symbol,
    projectsOpened: extra.length + 1,
    success: response.success,
    message: response.message,
    refs: refs.length,
    files: new Set(refs.map((r) => r.file)).size,
    coldMs: Math.round(coldMs),
    warmMs: Math.round(warmMs),
    peakRssMb: Math.round(server.peakRssKb / 1024),
    settledRssMb: Math.round(server.rssKb() / 1024),
};
server.close();
console.log(JSON.stringify(result));
