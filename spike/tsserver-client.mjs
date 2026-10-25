// Minimal tsserver client over stdio, with RSS sampling of the server process tree.
// Uses the worktree's own node_modules/typescript, so nothing extra is installed.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

function treeRssKb(pid) {
    let total = 0;
    const visit = (p) => {
        try {
            const status = readFileSync(`/proc/${p}/status`, 'utf8');
            total += Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
            for (const task of readdirSync(`/proc/${p}/task`)) {
                const children = readFileSync(`/proc/${p}/task/${task}/children`, 'utf8').trim();
                for (const c of children ? children.split(' ') : []) visit(c);
            }
        } catch {
            // process exited between listing and reading
        }
    };
    visit(pid);
    return total;
}

export class TsServer {
    constructor(worktree) {
        this.worktree = worktree;
        this.seq = 0;
        this.pending = new Map();
        this.buffer = Buffer.alloc(0);
        this.peakRssKb = 0;
        this.started = performance.now();
        const tsserver = path.join(worktree, 'node_modules/typescript/lib/tsserver.js');
        this.proc = spawn(process.execPath, [tsserver, '--disableAutomaticTypingAcquisition'], {
            cwd: worktree,
            stdio: ['pipe', 'pipe', 'inherit'],
        });
        this.proc.stdout.on('data', (chunk) => this.onData(chunk));
        this.sampler = setInterval(() => {
            this.peakRssKb = Math.max(this.peakRssKb, this.rssKb());
        }, 100);
    }

    rssKb() {
        return treeRssKb(this.proc.pid);
    }

    onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        for (;;) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd < 0) return;
            const length = Number(/Content-Length: (\d+)/.exec(this.buffer.subarray(0, headerEnd).toString())[1]);
            const bodyStart = headerEnd + 4;
            if (this.buffer.length < bodyStart + length) return;
            const message = JSON.parse(this.buffer.subarray(bodyStart, bodyStart + length).toString());
            this.buffer = this.buffer.subarray(bodyStart + length);
            if (message.type === 'response' && this.pending.has(message.request_seq)) {
                this.pending.get(message.request_seq)(message);
                this.pending.delete(message.request_seq);
            }
        }
    }

    send(command, args, expectResponse = true) {
        const seq = ++this.seq;
        this.proc.stdin.write(JSON.stringify({ seq, type: 'request', command, arguments: args }) + '\n');
        if (!expectResponse) return Promise.resolve();
        return new Promise((resolve) => this.pending.set(seq, resolve));
    }

    open(file) {
        return this.send('open', { file }, false);
    }

    references(file, line, offset) {
        return this.send('references', { file, line, offset });
    }

    definition(file, line, offset) {
        return this.send('definition', { file, line, offset });
    }

    close() {
        clearInterval(this.sampler);
        this.proc.kill();
    }
}

// 1-based line/offset of the first whole-word occurrence of `symbol` in `file`.
export function locate(file, symbol) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const re = new RegExp(`\\b${symbol}\\b`);
    for (let i = 0; i < lines.length; i++) {
        const m = re.exec(lines[i]);
        if (m) return { line: i + 1, offset: m.index + 1 };
    }
    throw new Error(`${symbol} not found in ${file}`);
}
