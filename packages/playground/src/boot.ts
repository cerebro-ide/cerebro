// The page's entry. In the desktop app, a window without a project shows the Welcome screen; one
// with a project, or the page in a browser, shows the IDE.

import { loadProject } from './projects.js';

const project = await loadProject();
await (window.cerebro && !project ? import('./welcome.js') : import('./main.js'));
