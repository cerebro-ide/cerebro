#!/usr/bin/env node
// The host's entry point: serves the UI over stdin and stdout, for the repository in the folder it
// was started in (or CEREBRO_REPO), and exits when the UI closes its end. Run as `main.js hook
// <name>`, it's an agent's hook instead, telling the host that started the agent (agents.ts).

import { parseHookInput, sendHook } from './agents.js';
import { serve } from './host.js';

if (process.argv[2] === 'hook') {
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
  serve(process.stdin, process.stdout, { repo: process.env['CEREBRO_REPO'] ?? process.cwd() });
}
