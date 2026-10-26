// The agent end to end, with a pretend `claude` on the PATH: it runs the hooks the host gave it
// (through --settings) as Claude Code would, writes a file during its turn, and shows the arguments
// it got. Not on Windows, where a script on the PATH can't be run by its #! line.

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch, type Running } from './app.js';

const FAKE_CLAUDE = `#!/usr/bin/env node
const { execSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const at = args.indexOf('--settings');
const hooks = JSON.parse(args[at + 1]).hooks;
const run = (event) =>
  execSync(hooks[event][0].hooks[0].command, {
    input: '{"session_id":"fake-session","prompt":"Write a file"}',
  });
console.log('pretend claude: ' + args.filter((_, i) => i !== at && i !== at + 1).join(' '));
run('UserPromptSubmit');
writeFileSync('agent.txt', 'written by the agent\\n');
setTimeout(() => run('Stop'), 500);
setInterval(() => {}, 1000);
`;

describe.skipIf(process.platform === 'win32')('the agent', () => {
  let running: Running;
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-agent-')));
  const repo = join(root, 'project');
  const bin = join(root, 'bin');

  beforeAll(async () => {
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    mkdirSync(bin);
    writeFileSync(join(bin, 'claude'), FAKE_CLAUDE);
    chmodSync(join(bin, 'claude'), 0o755);
    running = await launch({
      CEREBRO_REPO: repo,
      PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
    });
  });

  afterAll(async () => {
    await running.close();
    rmSync(root, { recursive: true, force: true });
  });

  /** What the terminals show, their lines joined: the Claude tool window's is narrow. */
  const shown = () =>
    running.page.evaluate(() =>
      [...document.querySelectorAll('.cerebro-terminal__row')]
        .map((row) => row.textContent)
        .join(''),
    );

  it('shows its status from its hooks, and resumes its session after a restart', async () => {
    const page = running.page;
    const status = page.locator('.cerebro-statusbar');
    // Each hook runs the host's entry as Node: slow, in CI more than a poll's second.
    await expect.poll(() => status.innerText(), { timeout: 15_000 }).toContain('Claude is done');
    await expect.poll(shown).toContain('pretend claude:');
    expect(await shown()).not.toContain('--resume');
    await running.restart();
    await expect
      .poll(shown, { timeout: 15_000 })
      .toContain('pretend claude: --resume fake-session');
  });

  it('lists its turn in the Commit tool window, with the file it wrote, and shows its diff', async () => {
    const page = running.page;
    await page.locator('.cerebro-stripe-button[data-id="commit"]').click({ force: true });
    // Both runs' turns: the one after the restart wrote the same file again, changing nothing.
    const turns = page.locator('.cerebro-tree-row', { hasText: 'Write a file' });
    // Each hook runs the host's entry as Node: slow, so this waits longer than most.
    await expect.poll(() => turns.count(), { timeout: 15_000 }).toBe(2);
    await turns.last().dblclick();
    const file = page.locator('.cerebro-tree-row[data-key^="turn:"][data-key$=":agent.txt"]');
    await file.click();
    await page.keyboard.press('ControlOrMeta+d');
    const added = page.locator('.cerebro-editor-diff .cm-merge-b .cm-changedLine');
    await expect.poll(() => added.allTextContents()).toEqual(['written by the agent']);
  });
});
