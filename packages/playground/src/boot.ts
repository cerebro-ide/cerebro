// The page's entry. In the desktop app, a window without a project shows the Welcome screen; one
// with projects, or the page in a browser, shows the IDE.

import { loadProjects } from './projects.js';

const projects = await loadProjects();
await (window.cerebro && projects.length === 0 ? import('./welcome.js') : import('./main.js'));
