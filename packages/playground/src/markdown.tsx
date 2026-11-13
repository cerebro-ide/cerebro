// A Markdown file's editor, as IntelliJ's (TextEditorWithPreview, MarkdownEditorWithPreview, read
// from their source): its text, its preview, or both, side by side or one above the other, picked
// from three buttons at the tab bar's end (IntelliJ's new UI puts them in the editor's tab). Each
// tab keeps its own layout; a new one takes the last chosen, Editor and Preview to start with.
// Choosing Editor and Preview again turns the split round, as IntelliJ's. Where the two meet is
// dragged, the share kept for every file, as IntelliJ's one proportion.

import type { CommandRegistry } from '@cerebro-ide/commands';
import { onCleanup } from '@cerebro-ide/jsx';
import { effect, ObservableMap, signal } from '@cerebro-ide/reactive';
import { MarkdownPreview } from '@cerebro-ide/ui-editor';
import { Splitter } from '@cerebro-ide/ui-layout';
import { ToolbarButton } from '@cerebro-ide/ui-toolbar';
import { tabPath } from './changes.js';
import type { TabContext } from './commands.js';
import { icon } from './icons.js';

/** What a Markdown file's editor shows: IntelliJ's SHOW_EDITOR, SHOW_EDITOR_AND_PREVIEW, SHOW_PREVIEW. */
export type MarkdownLayout = 'editor' | 'split' | 'preview';

/** The layouts, in the buttons' order, with IntelliJ's names (IdeBundle's `tab.title.*`). */
const LAYOUTS: readonly { layout: MarkdownLayout; label: string }[] = [
  { layout: 'editor', label: 'Editor' },
  { layout: 'split', label: 'Editor and Preview' },
  { layout: 'preview', label: 'Preview' },
];

/** Whether a file is Markdown, as the editor's languages say (`.md`). */
export function isMarkdown(path: string): boolean {
  return /\.md$/i.test(path);
}

/** Whether a tab is a Markdown file's own: not its diff's. */
export function isMarkdownTab(tabId: string): boolean {
  return isMarkdown(tabId) && tabPath(tabId) === tabId;
}

/** Where the last layout, the split's direction and its share are kept, one for every repository. */
const KEY = 'cerebro.markdown.editor';

interface Kept {
  layout: MarkdownLayout;
  /** One above the other, rather than side by side. */
  vertical: boolean;
  /** The text's share of the split. */
  share: number;
}

/** What's kept, or IntelliJ's defaults: Editor and Preview, side by side, halves. */
export function readKept(): Kept {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Kept>;
    const { layout, share } = stored;
    return {
      layout: LAYOUTS.some((l) => l.layout === layout) ? (layout as MarkdownLayout) : 'split',
      vertical: stored.vertical === true,
      share: typeof share === 'number' && share > 0 && share < 1 ? share : 0.5,
    };
  } catch {
    return { layout: 'split', vertical: false, share: 0.5 };
  }
}

const kept = readKept();
const last = signal(kept.layout);
const vertical = signal(kept.vertical);
const share = signal(kept.share);
/** Each tab's layout, by its file, once chosen there. */
const layouts = new ObservableMap<string, MarkdownLayout>();

function keep(): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ layout: last.peek(), vertical: vertical.peek(), share: share.peek() }),
    );
  } catch {
    // Not kept: it starts as it did.
  }
}

/** A file's layout: the one chosen in its tab, else the last chosen. Read reactively. */
export function layoutOf(path: string): MarkdownLayout {
  return layouts.get(path) ?? last.get();
}

/**
 * Shows a layout in a file's tab, kept for new ones; Editor and Preview, chosen again, turns the
 * split round (IntelliJ's ChangePreviewLayoutAction).
 */
export function chooseLayout(path: string, layout: MarkdownLayout): void {
  if (layout === 'split' && layoutOf(path) === 'split') vertical.set(!vertical.peek());
  layouts.set(path, layout);
  last.set(layout);
  keep();
}

/** The share a drag gives the text, kept clear of either end. */
function clamp(value: number): number {
  return Math.min(0.9, Math.max(0.1, value));
}

/** A Markdown file's text and its preview, as its layout says. */
export function MarkdownEditor(props: { path: string; editor: Node; text: () => string }): Node {
  const layout = () => layoutOf(props.path);
  const text = (
    <div class="playground-markdown__text" hidden={() => layout() === 'preview'}>
      {props.editor}
    </div>
  ) as HTMLElement;
  // The text's share, while both show; all the room otherwise.
  const sizing = effect(() => {
    text.style.flexBasis = layout() === 'split' ? `${String(share.get() * 100)}%` : '';
    return undefined;
  });
  onCleanup(() => {
    sizing.dispose();
  });
  return (
    <div
      class={() =>
        vertical.get() ? 'playground-markdown playground-markdown--vertical' : 'playground-markdown'
      }
      data-layout={layout}
    >
      {text}
      {() =>
        layout() === 'split' ? (
          <Splitter
            line={vertical.get() ? 'horizontal' : 'vertical'}
            start={() => {
              const whole = (text.parentElement as HTMLElement).getBoundingClientRect();
              const part = text.getBoundingClientRect();
              return vertical.peek()
                ? { part: part.height, whole: whole.height }
                : { part: part.width, whole: whole.width };
            }}
            onDrag={(start, delta) => {
              share.set(clamp((start.part + delta) / start.whole));
            }}
            onResizing={(active) => {
              if (!active) keep();
            }}
          />
        ) : null
      }
      {() => (layout() === 'editor' ? null : <MarkdownPreview text={props.text} />)}
    </div>
  );
}

/** The layouts' commands, for a tab, or the active one (VS Code's keymaps have keys for two). */
export function setupMarkdown(commands: CommandRegistry, active: () => string | undefined): void {
  const pathOf = (context: unknown) => (context as TabContext | undefined)?.tab ?? active();
  for (const { layout, label } of LAYOUTS) {
    commands.register({
      id: `markdown.layout.${layout}`,
      label,
      enabled: (context) => {
        const path = pathOf(context);
        return path !== undefined && isMarkdownTab(path);
      },
      checked: (context) => {
        const path = pathOf(context);
        return path !== undefined && layoutOf(path) === layout;
      },
      run: (context) => {
        const path = pathOf(context);
        if (path !== undefined) chooseLayout(path, layout);
      },
    });
  }
}

/** The layouts' buttons, for a Markdown file's tab. */
export function markdownActions(commands: CommandRegistry, context: TabContext): Node[] {
  const icons: Record<MarkdownLayout, () => string> = {
    editor: () => 'layoutEditor',
    split: () => (vertical.get() ? 'layoutEditorPreviewVertical' : 'layoutEditorPreview'),
    preview: () => 'layoutPreview',
  };
  return LAYOUTS.map(({ layout }) => (
    <ToolbarButton
      commands={commands}
      command={`markdown.layout.${layout}`}
      icon={() => icon(icons[layout]())}
      context={() => context}
    />
  ));
}
