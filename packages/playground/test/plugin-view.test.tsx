import { render } from '@cerebro-ide/jsx';
import type { ViewContribution } from '@cerebro-ide/plugin-api';
import { describe, expect, it } from 'vitest';
import { PluginView } from '../src/plugin-view.js';

/** A view that writes a line, and says when it's cleaned up, if it can be. */
function view(cleans: boolean, cleaned: string[]): ViewContribution {
  return {
    id: 'v',
    title: 'V',
    anchor: 'right',
    mount: (container) => {
      container.textContent = 'drawn by the plugin';
      return cleans ? () => void cleaned.push('cleaned') : undefined;
    },
  };
}

describe('a plugin’s view', () => {
  it('is drawn by the plugin, which cleans up when it goes', () => {
    const cleaned: string[] = [];
    const box = document.createElement('div');
    const handle = render(() => <PluginView view={view(true, cleaned)} />, box);
    expect(box.querySelector('.playground-view')?.textContent).toBe('drawn by the plugin');
    handle.dispose();
    expect(cleaned).toEqual(['cleaned']);
  });

  it('goes without cleaning up, if the plugin doesn’t say how', () => {
    const cleaned: string[] = [];
    const box = document.createElement('div');
    render(() => <PluginView view={view(false, cleaned)} />, box).dispose();
    expect(cleaned).toEqual([]);
  });
});
