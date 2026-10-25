// From-scratch index build split across worker threads; results are serialized back to the main thread.
// Usage: node m3-parallel-build.mjs <worktree> <workers>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { BlobIndex, languageOf } from './blob-index.mjs';

if (isMainThread) {
  const [wtArg, nArg] = process.argv.slice(2);
  const wt = path.resolve(wtArg), n = Number(nArg);
  const t0 = performance.now();
  const seen = new Map();
  for (const e of execFileSync('git', ['-C', wt, 'ls-files', '-s', '-z'], { maxBuffer: 1 << 28 }).toString().split('\0')) {
    const tab = e.indexOf('\t'); if (tab < 0) continue;
    const file = e.slice(tab + 1), [mode, blob] = e.slice(0, tab).split(' ');
    if (mode !== '120000' && languageOf(file) && !seen.has(blob)) seen.set(blob, file);
  }
  const jobs = [...seen].map(([blob, file]) => [blob, path.join(wt, file), languageOf(file)]);
  const chunks = Array.from({ length: n }, (_, i) => jobs.filter((_, j) => j % n === i));
  const blobs = new Map();
  await Promise.all(chunks.map((chunk) => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: chunk });
    w.on('message', (buf) => { for (const [k, v] of v8.deserialize(buf)) blobs.set(k, v); resolve(); });
    w.on('error', reject);
  })));
  console.log({ workers: n, blobs: blobs.size, totalMs: Math.round(performance.now() - t0) });
} else {
  const index = await BlobIndex.create();
  for (const [blob, file, lang] of workerData) index.blobs.set(blob, index.parse(readFileSync(file, 'utf8'), lang));
  parentPort.postMessage(v8.serialize(index.blobs));
}
