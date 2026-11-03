// A plugin's view in its tool window: a container the plugin fills however it likes (the plugin
// API's boundary is the DOM), cleaned up as it goes, if the plugin says how.

import { onCleanup } from '@cerebro-ide/jsx';
import type { ViewContribution } from '@cerebro-ide/plugin-api';

export function PluginView(props: { view: ViewContribution }): Node {
  const container = document.createElement('div');
  container.className = 'playground-view';
  const cleanup = props.view.mount(container);
  if (cleanup) onCleanup(cleanup);
  return container;
}
