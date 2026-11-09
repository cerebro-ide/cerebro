// The askpass client as the host's entry runs it (`main.js askpass <kind> <prompt>`), from the
// source: Node strips its types.

import { askPassClient } from '../../src/askpass.ts';

process.exitCode = await askPassClient(
  process.argv.slice(3),
  process.env,
  process.stdout,
  process.stderr,
);
