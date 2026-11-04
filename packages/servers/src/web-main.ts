// The entry of Cerebro's own server for JSON, CSS and HTML (web.ts), as the host starts it: LSP on
// stdin and stdout.

import { serveWeb } from './web.js';

serveWeb(process.stdin, process.stdout);
