import { Environments } from '@cerebro-ide/layout';
import { beforeAll, describe, expect, it } from 'vitest';
import { workspace } from '../src/environments.js';

// The page, as a browser shows it again after a reload: the samples, as they were left.

beforeAll(async () => {
  const saved = new Environments();
  saved.openOrActivate({ id: 'cerebro-status-bar', name: 'cerebro-status-bar', branch: 'x' });
  saved.active?.editor.open({ id: 'README.md', title: 'README.md' });
  saved.active?.editor.open({ id: 'untitled-1', title: 'untitled-1' });
  localStorage.setItem('cerebro.layout', JSON.stringify({ environments: saved.state() }));
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  await import('../src/main.js');
});

describe('the page after a reload', () => {
  it('opens the sample files left open, not the untitled ones, whose text isn’t kept', () => {
    const tabs = workspace.active?.editor.groups.flatMap((g) => g.tabs.map((t) => t.id));
    expect(tabs).toEqual(['README.md']);
  });
});
