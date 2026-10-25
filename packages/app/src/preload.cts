// Runs in the window before the page, sandboxed (so CommonJS): tells the page it runs in the app,
// and on which platform, so it can leave room for the window controls.

// The CommonJS form of an import; verbatimModuleSyntax rules out `import … from` here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require('electron');

electron.contextBridge.exposeInMainWorld('cerebro', { app: true, platform: process.platform });
