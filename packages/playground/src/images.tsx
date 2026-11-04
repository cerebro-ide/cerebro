// Images open in an image viewer (`ui-image`), as IntelliJ's image editor: its toolbar above them
// (Images.EditorToolbar: Transparency Chessboard and Grid, then Zoom In, Zoom Out, Actual Size and
// Fit Zoom to Window) and, at its right, the image's line ("800x600 PNG (32-bit color) 41.44 kB").
// Turning the chessboard or the grid on or off makes it the default for images opened after, as
// IntelliJ's toggles do; kept in the browser's storage.
//
// The files that open so: the formats the page can show (a claim: IntelliJ's are ImageIO's, and
// its SVG opens as text beside a preview; here SVG stays text).

import { formatSequence } from '@cerebro-ide/commands';
import { onCleanup } from '@cerebro-ide/jsx';
import { effect, signal } from '@cerebro-ide/reactive';
import { imageFormat, imageInfo, ImageView, ImageViewer } from '@cerebro-ide/ui-image';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { ToolbarButton } from '@cerebro-ide/ui-toolbar';
import { hostFor } from './environments.js';
import { icon } from './icons.js';
import { focusing } from './navigation.js';

/** The image files, by extension, and their media types. */
const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

const typeOf = (path: string) => TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()];

/** Whether a file opens in the image viewer. */
export const isImage = (path: string): boolean => typeOf(path) !== undefined;

/** The chessboard and grid for images opened next. */
const DEFAULTS_KEY = 'cerebro.images';

function readDefaults(): { chessboard: boolean; grid: boolean } {
  try {
    const stored = JSON.parse(localStorage.getItem(DEFAULTS_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    return { chessboard: stored.chessboard === true, grid: stored.grid === true };
  } catch {
    return { chessboard: false, grid: false };
  }
}

function saveDefaults(view: ImageView): void {
  try {
    localStorage.setItem(
      DEFAULTS_KEY,
      JSON.stringify({ chessboard: view.chessboard, grid: view.grid }),
    );
  } catch {
    // Not kept: images opened next start as before.
  }
}

/** Each viewer's view, by its element, for a shortcut pressed in it. */
const views = new WeakMap<Element, ImageView>();

/** The view a command acts on: its toolbar's, or the viewer with the keyboard's. */
function viewOf(context: unknown): ImageView | undefined {
  if (context instanceof ImageView) return context;
  const viewer = document.activeElement?.closest('.playground-image');
  return viewer ? views.get(viewer) : undefined;
}

/** The toolbar's commands, in its order. */
const COMMANDS: {
  id: string;
  label: string;
  icon: string;
  run: (view: ImageView) => void;
  enabled?: (view: ImageView) => boolean;
  checked?: (view: ImageView) => boolean;
  text?: (view: ImageView) => string;
}[] = [
  {
    id: 'image.toggleChessboard',
    label: 'Transparency Chessboard',
    icon: 'chessboard',
    run: (view) => {
      view.toggleChessboard();
      saveDefaults(view);
    },
    checked: (view) => view.chessboard,
    text: (view) => (view.chessboard ? 'Hide Chessboard' : 'Show Chessboard'),
  },
  {
    id: 'image.toggleGrid',
    label: 'Grid',
    icon: 'grid',
    run: (view) => {
      view.toggleGrid();
      saveDefaults(view);
    },
    checked: (view) => view.grid,
    text: (view) => (view.grid ? 'Hide Grid' : 'Show Grid'),
  },
  {
    id: 'image.zoomIn',
    label: 'Zoom In',
    icon: 'zoomIn',
    run: (view) => {
      view.zoomIn();
    },
    enabled: (view) => view.canZoomIn,
  },
  {
    id: 'image.zoomOut',
    label: 'Zoom Out',
    icon: 'zoomOut',
    run: (view) => {
      view.zoomOut();
    },
    enabled: (view) => view.canZoomOut,
  },
  {
    id: 'image.actualSize',
    label: 'Actual Size',
    icon: 'actualSize',
    run: (view) => {
      view.actualSize();
    },
    enabled: (view) => view.loaded && view.zoom !== 1,
  },
  {
    id: 'image.fit',
    label: 'Fit Zoom to Window',
    icon: 'fit',
    run: (view) => {
      view.fit();
    },
    enabled: (view) => view.loaded && view.zoomChanged,
  },
];

/** The image viewer's commands; their keys are the keymaps'. */
export function setupImages(services: MenuServices): void {
  for (const command of COMMANDS) {
    const { run, enabled, checked, text } = command;
    services.commands.register({
      id: command.id,
      label: command.label,
      icon: command.icon,
      run: (context) => {
        // Enabled: there's a view.
        run(viewOf(context) as ImageView);
      },
      enabled: (context) => {
        const view = viewOf(context);
        return view !== undefined && (enabled?.(view) ?? true);
      },
      ...(checked
        ? {
            checked: (context: unknown) => {
              const view = viewOf(context);
              return view !== undefined && checked(view);
            },
          }
        : {}),
      ...(text
        ? {
            text: (context: unknown) => {
              const view = viewOf(context);
              return view ? text(view) : command.label;
            },
          }
        : {}),
    });
  }
}

type Loaded = { src: string; info: (view: ImageView) => string } | { error: string };

/** An image file's tab: the toolbar, the image's line, and the image. */
export function ImageTab(props: { path: string; services: MenuServices }): Node {
  const { path, services } = props;
  const host = hostFor(path);
  if (!host) return <p class="playground-code__note">Images show in the desktop app.</p>;
  const loaded = signal<Loaded | undefined>(undefined);
  host.request('fs.readBytes', { path }).then(
    (result) => {
      const { data } = result as { data: string };
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const format = imageFormat(bytes);
      loaded.set({
        src: `data:${typeOf(path) as string};base64,${data}`,
        info: (view) => imageInfo(view, format, bytes.length),
      });
    },
    (error: unknown) => {
      loaded.set({ error: (error as Error).message });
    },
  );
  const view = new ImageView(readDefaults());
  const shortcut = (command: string) => () => {
    const keymap = services.keymap;
    const key = keymap?.shortcutsFor(command)[0];
    return key === undefined || !keymap ? undefined : formatSequence(key, keymap.platform);
  };
  const element = (
    <div class="playground-image">
      {() => {
        const state = loaded.get();
        if (!state) return <p class="playground-code__note">Loading…</p>;
        if ('error' in state) {
          return (
            <p class="playground-code__note">
              Can’t open {path}: {state.error}
            </p>
          );
        }
        return [
          <div
            class="playground-image__toolbar"
            role="toolbar"
            aria-label="Image"
            on:mousedown={(event) => {
              // The image keeps the keyboard, as IntelliJ gives it back from its toolbar.
              event.preventDefault();
            }}
          >
            {COMMANDS.map((command) => (
              <ToolbarButton
                commands={services.commands}
                command={command.id}
                icon={icon(command.icon)}
                shortcut={shortcut(command.id)}
                context={() => view}
              />
            ))}
            <span class="playground-image__info">
              {() => (view.loaded ? state.info(view) : '')}
            </span>
          </div>,
          <ImageViewer view={view} src={state.src} label={path.slice(path.lastIndexOf('/') + 1)} />,
        ];
      }}
    </div>
  ) as HTMLElement;
  views.set(element, view);
  // Opened from a list, it takes the keyboard, as a code editor does: once it's shown.
  const focus = effect(() => {
    if (focusing.get(path) === undefined || !loaded.get()) return undefined;
    // After the current task: a new tab isn't in the document yet.
    queueMicrotask(() => {
      element.querySelector<HTMLElement>('.cerebro-image')?.focus();
    });
    return undefined;
  });
  onCleanup(() => {
    focus.dispose();
  });
  return element;
}
