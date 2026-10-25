// Measurement 3: tree-sitter index build time, from scratch, then for extra worktrees reusing it.
// Usage: node m3-index-build.mjs <worktree>...   (indexed in the order given)
import path from 'node:path';
import v8 from 'node:v8';
import { BlobIndex } from './blob-index.mjs';

const tInit = performance.now();
const index = await BlobIndex.create();
console.log(`parser + queries init: ${Math.round(performance.now() - tInit)} ms`);

const ms = (n) => String(Math.round(n)).padStart(7);
console.log('worktree      files  parsed  reused  parsed_MB  list_ms parse_ms total_ms');
for (const wt of process.argv.slice(2)) {
    const r = index.indexWorktree(path.resolve(wt));
    console.log(`${path.basename(wt).padEnd(12)} ${String(r.files).padStart(6)} ${String(r.parsed).padStart(7)} ${String(r.reused).padStart(7)} ${(r.bytes / 2 ** 20).toFixed(1).padStart(10)} ${ms(r.listMs)}  ${ms(r.parseMs)}  ${ms(r.totalMs)}`);
}

// Cost of keeping the index: heap, and size and load time of a serialized copy (warm restart).
global.gc?.();
const heapMb = process.memoryUsage().heapUsed / 2 ** 20;
const tSer = performance.now();
const blob = v8.serialize(index.blobs);
const serMs = performance.now() - tSer;
const tDe = performance.now();
v8.deserialize(blob);
const deMs = performance.now() - tDe;
let defs = 0, ids = 0;
for (const b of index.blobs.values()) {
    defs += b.defs.length;
    for (const list of b.ids.values()) ids += list.length / 2;
}
console.log(`\ndistinct blobs: ${index.blobs.size}, definitions: ${defs}, identifier occurrences: ${ids}`);
console.log(`heap used: ${Math.round(heapMb)} MB; serialized: ${Math.round(blob.length / 2 ** 20)} MB, write ${Math.round(serMs)} ms, load ${Math.round(deMs)} ms`);
