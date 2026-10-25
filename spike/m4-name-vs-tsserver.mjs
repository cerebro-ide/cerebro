// Measurement 4: quality of name-based go to definition / find usages against tsserver's answers.
// Usage: node m4-name-vs-tsserver.mjs <worktree> [per-kind sample size]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BlobIndex } from './blob-index.mjs';
import { TsServer } from './tsserver-client.mjs';

const worktree = path.resolve(process.argv[2]);
const perKind = Number(process.argv[3] ?? 10);
const SRC = /^packages\/ag-charts-(core|community|enterprise)\/src\/(?!.*(\.spec\.|\.test\.|\/test\/))/;

const index = await BlobIndex.create();
const { paths } = index.indexWorktree(worktree);
const key = (file, row, col) => `${file}:${row}:${col}`;

// tsserver with every package's project loaded, as in measurement 2.
const server = new TsServer(worktree);
const mains = execFileSync('bash', ['-c', 'ls packages/*/src/main.ts'], { cwd: worktree }).toString().trim().split('\n');
for (const f of mains) await server.open(path.join(worktree, f));
const scope = new Set();
for (const f of mains) {
    const info = await server.send('projectInfo', { file: path.join(worktree, f), needFileNameList: true });
    for (const name of info.body?.fileNames ?? []) {
        const rel = path.relative(worktree, name);
        if (!rel.startsWith('..') && !rel.includes('node_modules')) scope.add(rel);
    }
}

// Seeded sample of definitions, up to `perKind` per kind.
let seed = 42;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const byKind = new Map();
for (const [file, blob] of paths) {
    if (!SRC.test(file) || !scope.has(file)) continue;
    for (const d of index.blobs.get(blob).defs) {
        if (!byKind.has(d.kind)) byKind.set(d.kind, []);
        byKind.get(d.kind).push({ file, ...d });
    }
}
const sample = [];
for (const [kind, defs] of [...byKind].sort()) {
    const pool = [...defs];
    for (let i = 0; i < perKind && pool.length; i++) sample.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
}

// Name-based answers, limited to the files tsserver's projects contain.
function nameUsages(name) {
    const hits = new Set();
    for (const [file, blob] of paths) {
        if (!scope.has(file)) continue;
        const list = index.blobs.get(blob).ids.get(name);
        for (let i = 0; list && i < list.length; i += 2) hits.add(key(file, list[i], list[i + 1]));
    }
    return hits;
}
function nameDefinitions(name) {
    const hits = new Set();
    for (const [file, blob] of paths) {
        if (!scope.has(file)) continue;
        for (const d of index.blobs.get(blob).defs) if (d.name === name) hits.add(key(file, d.row, d.col));
    }
    return hits;
}
const fromTs = (loc) => ({ file: path.relative(worktree, loc.file), row: loc.start.line - 1, col: loc.start.offset - 1 });

const rows = [];
for (const s of sample) {
    // Sanity check that tree-sitter columns line up with the source text.
    const lineText = readFileSync(path.join(worktree, s.file), 'utf8').split('\n')[s.row];
    if (lineText.slice(s.col, s.col + s.name.length) !== s.name) throw new Error(`column mismatch for ${s.name} in ${s.file}`);

    const file = path.join(worktree, s.file);
    await server.open(file);
    const t = performance.now();
    const res = await server.references(file, s.row + 1, s.col + 1);
    const refsMs = performance.now() - t;
    const tsRefs = (res.body?.refs ?? []).map(fromTs).filter((r) => scope.has(r.file));
    const truth = new Set(tsRefs.map((r) => key(r.file, r.row, r.col)));
    const found = nameUsages(s.name);
    const tp = [...truth].filter((k) => found.has(k)).length;

    // Go to definition from up to 3 usage sites.
    const usages = (res.body?.refs ?? []).filter((r) => !r.isDefinition && scope.has(path.relative(worktree, r.file))).slice(0, 3);
    const defs = nameDefinitions(s.name);
    let defSites = 0, defHit = 0, defUnique = 0;
    for (const u of usages) {
        await server.open(u.file);
        const d = await server.definition(u.file, u.start.line, u.start.offset);
        const targets = (d.body ?? []).map(fromTs).map((r) => key(r.file, r.row, r.col));
        if (!targets.length) continue;
        defSites++;
        if (targets.some((k) => defs.has(k))) defHit++;
        if (defs.size === 1 && targets.some((k) => defs.has(k))) defUnique++;
    }
    rows.push({ ...s, tsRefs: truth.size, nameHits: found.size, tp, refsMs: Math.round(refsMs), defSites, defHit, defUnique, nameDefs: defs.size });
}
server.close();

writeFileSync(path.join(import.meta.dirname, 'work/m4-results.json'), JSON.stringify(rows, null, 2));

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
console.log(`symbols: ${rows.length}, files in tsserver scope: ${scope.size}`);
console.log('kind          n  recall  precision  exact_sets  gotodef_hit  gotodef_unique  med_name_defs  med_ts_refs_ms');
const groups = [...new Set(rows.map((r) => r.kind))].map((k) => [k, rows.filter((r) => r.kind === k)]);
for (const [kind, rs] of [...groups, ['ALL', rows]]) {
    const sum = (f) => rs.reduce((a, r) => a + f(r), 0);
    const recall = pct(sum((r) => r.tp), sum((r) => r.tsRefs));
    const precision = pct(sum((r) => r.tp), sum((r) => r.nameHits));
    const exact = pct(rs.filter((r) => r.tp === r.tsRefs && r.tp === r.nameHits).length, rs.length);
    console.log(
        `${kind.padEnd(12)} ${String(rs.length).padStart(2)}  ${recall.padStart(6)}  ${precision.padStart(9)}  ${exact.padStart(10)}  ` +
            `${pct(sum((r) => r.defHit), sum((r) => r.defSites)).padStart(11)}  ${pct(sum((r) => r.defUnique), sum((r) => r.defSites)).padStart(14)}  ` +
            `${String(median(rs.map((r) => r.nameDefs))).padStart(13)}  ${String(median(rs.map((r) => r.refsMs))).padStart(14)}`,
    );
}
