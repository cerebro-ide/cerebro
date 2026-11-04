import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects } from '../src/environments.js';
import { ImageTab, isImage, setupImages } from '../src/images.js';
import { focusing } from '../src/navigation.js';
import { FakeHost, project } from './fakes.js';

/** A 100x50 PNG, in base64, as the host gives a file's bytes. */
const PNG = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = 100;
  canvas.height = 50;
  return canvas.toDataURL('image/png').split(',')[1] as string;
})();
const PNG_SIZE = atob(PNG).length;

const host = new FakeHost({
  'fs.readBytes': ({ path }: { path: string }) => {
    if (path.endsWith('bad.png')) throw new Error('it’s gone');
    return { data: PNG };
  },
});
const commands = new CommandRegistry();
const services: MenuServices = { commands, menus: new MenuRegistry(), keymap: new Keymap('other') };

beforeAll(() => {
  setupImages(services);
  useProjects([project('/r', host), project('/s', undefined)]);
});

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  localStorage.removeItem('cerebro.images');
  vi.restoreAllMocks();
});

function mount(path = '/r/a.png', withServices = services) {
  const box = document.createElement('div');
  box.style.height = '400px';
  box.style.width = '600px';
  document.body.append(box);
  const handle = render(() => <ImageTab path={path} services={withServices} />, box);
  dispose = () => {
    handle.dispose();
  };
}

const button = (command: string) =>
  document.querySelector(`[data-command="${command}"]`) as HTMLButtonElement;
const info = () => document.querySelector('.playground-image__info')?.textContent;
const img = () => document.querySelector('.cerebro-image__img') as HTMLImageElement;
const viewer = () => document.querySelector('.cerebro-image') as HTMLElement;
const loaded = () => expect.poll(info).toBe(`100x50 PNG (32-bit color) ${String(PNG_SIZE)} B`);

describe('images', () => {
  it('are the files the page can show, by extension; SVG stays text', () => {
    expect(isImage('/r/a.PNG')).toBe(true);
    expect(isImage('/r/photo.jpeg')).toBe(true);
    expect(isImage('/r/icon.svg')).toBe(false);
    expect(isImage('/r/png')).toBe(false);
  });
});

describe('an image’s tab', () => {
  it('shows the image, fitted, with its line at the toolbar’s right', async () => {
    mount();
    expect(document.querySelector('.playground-code__note')?.textContent).toBe('Loading…');
    await loaded();
    // Small: enlarged to about 128 pixels, as IntelliJ's.
    expect(img().width).toBe(200);
    expect(host.params('fs.readBytes')).toContainEqual({ path: '/r/a.png' });
  });

  it('zooms from its toolbar, which leaves the keyboard with the image', async () => {
    mount();
    await loaded();
    viewer().focus();
    expect(button('image.fit').disabled).toBe(true);
    await userEvent.click(button('image.zoomOut'));
    expect(img().width).toBe(100);
    expect(document.activeElement).toBe(viewer());
    await userEvent.click(button('image.zoomIn'));
    await userEvent.click(button('image.zoomIn'));
    expect(img().width).toBe(400);
    await userEvent.click(button('image.actualSize'));
    expect(img().width).toBe(100);
    expect(button('image.actualSize').disabled).toBe(true);
    await userEvent.click(button('image.fit'));
    expect(img().width).toBe(200);
  });

  it('runs its commands for the image with the keyboard, and none without', async () => {
    mount();
    await loaded();
    expect(commands.isEnabled('image.zoomIn')).toBe(false);
    expect(commands.isChecked('image.toggleGrid')).toBe(false);
    expect(commands.get('image.toggleGrid')?.text?.(undefined)).toBe('Grid');
    viewer().focus();
    commands.execute('image.zoomIn');
    expect(img().width).toBe(400);
    commands.execute('image.toggleGrid');
    expect(commands.isChecked('image.toggleGrid')).toBe(true);
    expect(commands.get('image.toggleGrid')?.text?.(undefined)).toBe('Hide Grid');
    expect(document.querySelector('.cerebro-image__grid')).not.toBeNull();
  });

  it('makes the chessboard and grid the default for images opened next', async () => {
    mount();
    await loaded();
    const chessboard = button('image.toggleChessboard');
    expect(chessboard.getAttribute('aria-label')).toBe('Show Chessboard');
    await userEvent.click(chessboard);
    expect(chessboard.getAttribute('aria-pressed')).toBe('true');
    expect(chessboard.getAttribute('aria-label')).toBe('Hide Chessboard');
    dispose?.();
    document.body.replaceChildren();
    mount('/r/b.png');
    await loaded();
    expect(button('image.toggleChessboard').getAttribute('aria-pressed')).toBe('true');
    expect(button('image.toggleGrid').getAttribute('aria-pressed')).toBe('false');
  });

  it('starts without them, as IntelliJ, when the defaults can’t be read or kept', async () => {
    localStorage.setItem('cerebro.images', 'not JSON');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    mount();
    await loaded();
    await userEvent.click(button('image.toggleGrid'));
    expect(button('image.toggleGrid').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows each command’s shortcut in its tooltip, from the keymap', async () => {
    const keymap = new Keymap('other');
    keymap.bindDefault("Ctrl+'", 'image.toggleGrid');
    mount('/r/a.png', { ...services, keymap });
    await loaded();
    await userEvent.hover(button('image.toggleGrid'));
    await expect
      .poll(() => document.querySelector('.cerebro-tooltip__shortcut')?.textContent)
      .toBe("Ctrl+'");
  });

  it('takes the keyboard when opened from a list', async () => {
    mount();
    focusing.set('/r/a.png', {});
    await loaded();
    await expect.poll(() => document.activeElement).toBe(viewer());
    focusing.delete('/r/a.png');
  });

  it('says why an image can’t be read, and that it shows in the app alone', async () => {
    mount('/r/bad.png');
    await expect
      .poll(() => document.querySelector('.playground-code__note')?.textContent)
      .toBe('Can’t open /r/bad.png: it’s gone');
    // Nothing to give the keyboard to.
    focusing.set('/r/bad.png', {});
    dispose?.();
    focusing.delete('/r/bad.png');
    mount('/s/a.png');
    expect(document.querySelector('.playground-code__note')?.textContent).toBe(
      'Images show in the desktop app.',
    );
  });
});
