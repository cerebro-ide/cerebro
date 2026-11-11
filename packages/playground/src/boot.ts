// The page's entry. In the desktop app, a diff window shows its diff (its hash names it); a window
// without a project shows the Welcome screen; one with projects, or the page in a browser, shows
// the IDE.

import { loadProjects } from './projects.js';

if (window.cerebro && location.hash.startsWith('#diff=')) {
  await import('./diff-window.js');
} else {
  const projects = await loadProjects();
  await (window.cerebro && projects.length === 0 ? import('./welcome.js') : import('./main.js'));
}
