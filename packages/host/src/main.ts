#!/usr/bin/env node
// The host's entry point: serves the UI over stdin and stdout, for the repository in the folder it
// was started in (or CEREBRO_REPO), and exits when the UI closes its end.

import { serve } from './host.js';

serve(process.stdin, process.stdout, { repo: process.env['CEREBRO_REPO'] ?? process.cwd() });
