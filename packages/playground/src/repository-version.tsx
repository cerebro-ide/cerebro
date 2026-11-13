import { signal } from '@cerebro-ide/reactive';
import { CodeEditor, type AskAnnotation } from '@cerebro-ide/ui-editor';
import type { Host } from './environments.js';

/** What the host gives for a file at a commit: its text, that it's binary, or null if not there. */
type FileAt = { text: string } | { binary: true } | null;

/**
 * A file as it was at a commit, read-only, as IntelliJ's Open Repository Version opens it
 * (`ContentRevisionVirtualFile`, which isn't writable): at a line, if given, as Annotate Revision
 * opens it, and annotated while it's asked to be.
 */
export function RepositoryVersion(props: {
  host: Host | undefined;
  worktree: string;
  path: string;
  hash: string;
  fontSize: () => number;
  tabSize: () => number;
  /** The line it opens at, zero-based. */
  line?: number | undefined;
  /** What asks for its annotations while it's annotated. */
  annotate: () => AskAnnotation | undefined;
  /** A right-click in it: its gutter's menu (Annotate with Git Blame). */
  onContextMenu: (event: MouseEvent) => void;
}) {
  const { host } = props;
  if (!host) {
    return <p class="playground-code__note">Repository versions show in the desktop app.</p>;
  }
  // Revealed once, as each object is.
  const at = props.line === undefined ? undefined : { line: props.line, column: 0 };
  const loaded = signal<FileAt | { error: string } | undefined>(undefined);
  host.request('git.fileAt', { path: props.worktree, hash: props.hash, file: props.path }).then(
    (result) => {
      loaded.set(result as FileAt);
    },
    (error: unknown) => {
      loaded.set({ error: (error as Error).message });
    },
  );
  return (
    <div class="playground-code" on:contextmenu={props.onContextMenu}>
      {() => {
        const state = loaded.get();
        if (state === undefined) return <p class="playground-code__note">Loading…</p>;
        if (state === null) {
          return (
            <p class="playground-code__note">
              {props.path} isn’t in {props.hash}.
            </p>
          );
        }
        if ('error' in state) {
          return (
            <p class="playground-code__note">
              Can’t open {props.path}: {state.error}
            </p>
          );
        }
        if ('binary' in state) {
          return <p class="playground-code__note">{props.path} is binary.</p>;
        }
        return (
          <CodeEditor
            path={props.path}
            text={state.text}
            fontSize={props.fontSize}
            tabSize={props.tabSize}
            reveal={() => at}
            annotate={props.annotate}
          />
        );
      }}
    </div>
  );
}
