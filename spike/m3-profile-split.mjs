// Splits from-scratch indexing time into parsing and the two queries.
// Usage: node m3-profile-split.mjs <worktree>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BlobIndex, languageOf } from './blob-index.mjs';
const wt = path.resolve(process.argv[2]);
const index = await BlobIndex.create();
const files = execFileSync('git', ['-C', wt, 'ls-files'], { maxBuffer: 1 << 28 }).toString().split('\n').filter((f) => languageOf(f));
const sources = files.map((f) => [readFileSync(path.join(wt, f), 'utf8'), languageOf(f)]);
let parse = 0, tags = 0, ids = 0;
for (const [src, lang] of sources) {
  const l = index.langs[lang];
  let t = performance.now(); const tree = l.parser.parse(src); parse += performance.now() - t;
  t = performance.now(); l.tags.matches(tree.rootNode); tags += performance.now() - t;
  t = performance.now(); const caps = l.ids.captures(tree.rootNode); for (const c of caps) c.node.text; ids += performance.now() - t;
  tree.delete();
}
console.log({ files: files.length, parseMs: Math.round(parse), tagsQueryMs: Math.round(tags), idsQueryMs: Math.round(ids) });
