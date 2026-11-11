#!/usr/bin/env node
// The host's entry point: serves the UI over stdin and stdout, for the repository in the folder it
// was started in (or CEREBRO_REPO), with the language servers CEREBRO_LANGUAGE_SERVERS names (all,
// when it's unset), keeping its index in the folder CEREBRO_INDEX_CACHE names, and exits when the UI closes its end. Run as `main.js hook <name>`, it's an
// agent's hook instead, telling the host that started the agent (agents.ts); as `main.js askpass
// <kind> <prompt>`, git's or ssh's askpass, asking the host that ran git (askpass.ts).

import { servers } from '@cerebro-ide/servers';
import { parseHookInput, sendHook } from './agents.js';
import { askPassClient } from './askpass.js';
import { serve } from './host.js';
import { LanguageServers } from './lsp.js';
import { watchEventLoop } from './slow.js';

if (process.argv[2] === 'askpass') {
  void askPassClient(process.argv.slice(3), process.env, process.stdout, process.stderr).then(
    (code) => {
      process.exitCode = code;
    },
  );
} else if (process.argv[2] === 'hook') {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    text += chunk;
  });
  process.stdin.on('end', () => {
    void sendHook(process.env['CEREBRO_HOOK_SOCKET'] ?? '', {
      key: process.env['CEREBRO_AGENT_KEY'] ?? '',
      event: process.argv[3] ?? '',
      input: parseHookInput(text),
    });
  });
} else {
  watchEventLoop("the host's");
  const indexCache = process.env['CEREBRO_INDEX_CACHE'];
  serve(process.stdin, process.stdout, {
    repo: process.env['CEREBRO_REPO'] ?? process.cwd(),
    languageServers: new LanguageServers(servers(process.env['CEREBRO_LANGUAGE_SERVERS'])),
    ...(indexCache ? { indexCache } : {}),
  });
}
