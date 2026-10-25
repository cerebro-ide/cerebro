// Lists the tsserver references that name-based matching missed, for one definition.
// Usage: node m4-explain-misses.mjs <file relative to worktree> <symbol>   (runs against work/worktrees/wt-latest)
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { BlobIndex } from './blob-index.mjs';
import { TsServer } from './tsserver-client.mjs';
const wt = path.resolve('work/worktrees/wt-latest');
const [rel, name] = process.argv.slice(2);
const index = await BlobIndex.create();
const { paths } = index.indexWorktree(wt);
const d = index.blobs.get(paths.get(rel)).defs.find((x) => x.name === name);
const s = new TsServer(wt);
for (const m of ['core', 'community', 'enterprise']) await s.open(`${wt}/packages/ag-charts-${m}/src/main.ts`);
await s.open(path.join(wt, rel));
const res = await s.references(path.join(wt, rel), d.row + 1, d.col + 1);
for (const r of res.body.refs) {
  const f = path.relative(wt, r.file), row = r.start.line - 1, col = r.start.offset - 1;
  const ids = index.blobs.get(paths.get(f))?.ids.get(name) ?? [];
  let hit = false; for (let i = 0; i < ids.length; i += 2) if (ids[i] === row && ids[i + 1] === col) hit = true;
  if (!hit) console.log('MISSED', f, r.start.line, JSON.stringify(readFileSync(r.file, 'utf8').split('\n')[row].trim()));
}
s.close();
