// A terminal view: a process the host runs on a pseudo-terminal, emulated by xterm.js's headless
// terminal (the parser and the screen's state) and drawn by Cerebro: one element per line in view,
// in the theme's monospace font, so it follows the theme's colours and the page's
// Content-Security-Policy. The view starts the process once it's on the page and has a size, sends
// it the keys typed, and fits it to its element as that resizes. The process is the host's, under
// a key: a view made again for the same key (after a reload, say) shows the running process with
// its recent output.

import { Terminal, type IBufferCell, type IBufferLine } from '@xterm/headless';
import { encodeKey } from './keys.js';
import { encodeMouse, type MouseReport } from './mouse.js';
import { drawRuns, keyOf, runsOf, type Span } from './rows.js';

/** What the view needs from the host. */
export interface TerminalBackend {
  open(options: {
    key: string;
    cwd: string;
    command?: string;
    args?: string[];
    /** An agent: the host runs it with its hooks, to hear its status. */
    agent?: boolean;
    cols: number;
    rows: number;
  }): Promise<{ id: number; buffer: string; exitCode?: number }>;
  write(id: number, data: string): void;
  resize(id: number, cols: number, rows: number): void;
  close(id: number): void;
  /** Listens to every terminal's output; returns a function that stops listening. */
  onData(listener: (id: number, data: string) => void): () => void;
  onExit(listener: (id: number, exitCode: number) => void): () => void;
}

export interface TerminalOptions {
  /** The host keeps one process per key. */
  key: string;
  cwd: string;
  /** The program to run, else the user's shell. */
  command?: string;
  /** Read each time the process starts: they may change between runs. */
  args?: string[] | (() => string[]);
  /** An agent (Claude Code), which the host runs with its hooks. */
  agent?: boolean;
  /** The process ended. */
  onExit?: (exitCode: number) => void;
  /** Default: 13. */
  fontSize?: number;
  /** Lines kept above the screen. Default: 10,000. */
  scrollback?: number;
  /** On macOS: Cmd copies and pastes, and Option types characters rather than being Meta. */
  mac?: boolean;
  /** Keys the app keeps (its shortcuts): the terminal lets them through. */
  passKey?: (event: KeyboardEvent) => boolean;
  /** Default: the system clipboard. */
  copy?: (text: string) => void;
}

/** Lines are this many times the font size apart, rounded to whole pixels. */
const LINE_HEIGHT = 1.2;

interface Position {
  line: number;
  col: number;
}

interface Row {
  element: HTMLElement;
  key: string;
}

const WORD = /[\w.\-/~:@+%#=]/;

export class TerminalView {
  /** Put this on the page; the terminal fills it. */
  readonly element: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly lines: HTMLElement;
  private readonly cursor: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly measure: HTMLElement;
  private readonly terminal: Terminal;
  private readonly cell: IBufferCell;
  private readonly observer: ResizeObserver;
  private readonly stops: (() => void)[] = [];
  private readonly rows = new Map<number, Row>();
  private readonly fontSize: number;
  private fontReady: Promise<unknown> | undefined;
  private cellWidth = 0;
  private rowHeight = 0;
  private frame: number | undefined;
  private lastDrawn = 0;
  /** Keeps the newest output in view, until the user scrolls up. */
  private follow = true;
  private focused = false;
  private cursorVisible = true;
  private sgrMouse = false;
  private selection: { anchor: Position; focus: Position } | undefined;
  private id: number | undefined;
  private starting = false;
  private exited = false;
  /** Keys typed before the process started. */
  private queued = '';
  private disposed = false;

  constructor(
    private readonly backend: TerminalBackend,
    private readonly options: TerminalOptions,
  ) {
    this.fontSize = options.fontSize ?? 13;
    this.element = document.createElement('div');
    this.element.className = 'cerebro-terminal';
    this.element.style.fontSize = `${String(this.fontSize)}px`;
    this.viewport = document.createElement('div');
    this.viewport.className = 'cerebro-terminal__viewport';
    this.lines = document.createElement('div');
    this.lines.className = 'cerebro-terminal__lines';
    this.cursor = document.createElement('div');
    this.cursor.className = 'cerebro-terminal__cursor';
    this.cursor.hidden = true;
    this.input = document.createElement('textarea');
    this.input.className = 'cerebro-terminal__input';
    this.input.setAttribute('aria-label', 'Terminal input');
    this.input.autocapitalize = 'off';
    this.input.spellcheck = false;
    this.measure = document.createElement('span');
    this.measure.className = 'cerebro-terminal__measure';
    this.measure.textContent = '0'.repeat(100);
    this.lines.append(this.cursor);
    this.viewport.append(this.lines);
    this.element.append(this.viewport, this.input, this.measure);

    this.terminal = new Terminal({
      cols: 80,
      rows: 24,
      scrollback: options.scrollback ?? 10_000,
      allowProposedApi: true,
    });
    this.cell = this.terminal.buffer.active.getNullCell();
    // Modes the headless terminal doesn't expose: the cursor's visibility, and SGR mouse reports.
    for (const [final, on] of [
      ['h', true],
      ['l', false],
    ] as const) {
      this.terminal.parser.registerCsiHandler({ prefix: '?', final }, (params) => {
        for (const param of params) {
          if (param === 25) this.cursorVisible = on;
          if (param === 1006) this.sgrMouse = on;
        }
        // Handled by the terminal too.
        return false;
      });
    }
    this.terminal.onWriteParsed(() => {
      this.schedule();
    });
    this.terminal.onData((data) => {
      this.send(data);
    });
    this.stops.push(
      backend.onData((id, data) => {
        if (id === this.id) this.terminal.write(data);
      }),
      backend.onExit((id, exitCode) => {
        if (id === this.id) this.ended(exitCode);
      }),
    );
    this.listen();
    this.observer = new ResizeObserver(() => {
      this.layout();
    });
    this.observer.observe(this.element);
  }

  focus(): void {
    this.input.focus();
  }

  /** The text of every line, scrollback included: for tests, and for reading what's shown. */
  text(): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < buffer.length; y++) lines.push(this.line(y).translateToString(true));
    return lines.join('\n').trimEnd();
  }

  /** The selected text, if any. */
  selectedText(): string {
    const range = this.range();
    if (!range) return '';
    let text = '';
    for (let y = range.start.line; y <= range.end.line; y++) {
      const span = this.spanOn(y) as Span;
      if (y > range.start.line && !this.line(y).isWrapped) text += '\n';
      text += this.line(y).translateToString(true, span.start, span.end);
    }
    return text;
  }

  /** Removes the view; the process keeps running in the host, for a view made again. */
  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    for (const stop of this.stops) stop();
    this.terminal.dispose();
  }

  /** Ends the process too. */
  close(): void {
    if (this.id !== undefined && !this.exited) this.backend.close(this.id);
    this.dispose();
  }

  private line(y: number): IBufferLine {
    return this.terminal.buffer.active.getLine(y) as IBufferLine;
  }

  // Size

  private layout(): void {
    if (this.disposed || this.element.clientWidth === 0 || this.element.clientHeight === 0) return;
    if (this.cellWidth === 0) {
      // The font must be loaded before it's measured.
      this.fontReady ??= document.fonts
        .load(`${String(this.fontSize)}px "JetBrains Mono"`)
        .catch(() => undefined)
        .then(() => {
          this.cellWidth = this.measure.getBoundingClientRect().width / 100;
          this.rowHeight = Math.round(this.fontSize * LINE_HEIGHT);
          this.element.style.setProperty('--cerebro-terminal-row', `${String(this.rowHeight)}px`);
          this.layout();
        });
      return;
    }
    const style = getComputedStyle(this.viewport);
    const width = this.viewport.clientWidth - parseFloat(style.paddingLeft);
    const height = this.viewport.clientHeight - parseFloat(style.paddingTop);
    const cols = Math.max(2, Math.floor(width / this.cellWidth));
    const rows = Math.max(1, Math.floor(height / this.rowHeight));
    if (cols !== this.terminal.cols || rows !== this.terminal.rows) {
      this.terminal.resize(cols, rows);
      if (this.id !== undefined && !this.exited) this.backend.resize(this.id, cols, rows);
    }
    if (this.id === undefined && !this.starting && !this.exited) this.begin();
    this.schedule();
  }

  // Drawing

  private schedule(): void {
    if (this.frame !== undefined || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.draw();
    });
  }

  private draw(): void {
    if (this.rowHeight === 0) return;
    // A program updating the screen in one go asks for nothing to be drawn until it's done; for
    // at most a second, as xterm.
    if (this.terminal.modes.synchronizedOutputMode && performance.now() - this.lastDrawn < 1000) {
      this.schedule();
      return;
    }
    this.lastDrawn = performance.now();
    const buffer = this.terminal.buffer.active;
    const total = buffer.length;
    this.lines.style.height = `${String(total * this.rowHeight)}px`;
    this.lines.style.width = `${String(this.terminal.cols)}ch`;
    if (this.follow) this.viewport.scrollTop = this.viewport.scrollHeight;
    const first = Math.min(
      Math.floor(this.viewport.scrollTop / this.rowHeight),
      Math.max(0, total - this.terminal.rows),
    );
    const last = Math.min(total, first + this.terminal.rows + 1);
    for (const [y, row] of this.rows) {
      if (y < first || y >= last) {
        row.element.remove();
        this.rows.delete(y);
      }
    }
    for (let y = first; y < last; y++) {
      const runs = runsOf(this.line(y), this.terminal.cols, this.cell, this.spanOn(y));
      const key = keyOf(runs);
      let row = this.rows.get(y);
      if (!row) {
        const element = document.createElement('div');
        element.className = 'cerebro-terminal__row';
        element.style.top = `${String(y * this.rowHeight)}px`;
        this.lines.append(element);
        row = { element, key: '' };
        this.rows.set(y, row);
      }
      if (row.key !== key) {
        drawRuns(row.element, runs);
        row.key = key;
      }
    }
    this.drawCursor(first, last);
  }

  private drawCursor(first: number, last: number): void {
    const buffer = this.terminal.buffer.active;
    const y = buffer.baseY + buffer.cursorY;
    const shown = this.cursorVisible && !this.exited && y >= first && y < last;
    this.cursor.hidden = !shown;
    if (!shown) return;
    const top = `${String(y * this.rowHeight)}px`;
    const left = `${String(buffer.cursorX)}ch`;
    const moved = this.cursor.style.top !== top || this.cursor.style.left !== left;
    this.cursor.style.top = top;
    this.cursor.style.left = left;
    this.cursor.classList.toggle('cerebro-terminal__cursor--focused', this.focused);
    // A cursor that moves shows at once: its blink starts again.
    if (moved) for (const blink of this.cursor.getAnimations()) blink.currentTime = 0;
  }

  // The process

  /** Starts the process; if the host can't, says why, and Enter tries again. */
  private begin(): void {
    this.start().catch((error: unknown) => {
      this.starting = false;
      this.exited = true;
      this.queued = '';
      const message = error instanceof Error ? error.message : String(error);
      this.terminal.write(
        `\x1b[2mCouldn’t start: ${message}\r\nPress Enter to try again.\x1b[0m\r\n`,
      );
    });
  }

  private async start(): Promise<void> {
    this.starting = true;
    this.exited = false;
    const { key, cwd, command, agent } = this.options;
    const args = typeof this.options.args === 'function' ? this.options.args() : this.options.args;
    const opened = await this.backend.open({
      key,
      cwd,
      ...(command === undefined ? {} : { command }),
      ...(args === undefined ? {} : { args }),
      ...(agent === true ? { agent } : {}),
      cols: this.terminal.cols,
      rows: this.terminal.rows,
    });
    this.id = opened.id;
    this.starting = false;
    if (opened.buffer !== '') this.terminal.write(opened.buffer);
    if (opened.exitCode !== undefined) this.ended(opened.exitCode);
    else if (this.queued !== '') {
      this.backend.write(opened.id, this.queued);
      this.queued = '';
    }
  }

  /** Sends what's typed (or a report the terminal makes) to the process. */
  private send(data: string): void {
    if (this.exited) {
      // Enter starts it again.
      if (data === '\r') {
        if (this.id !== undefined) this.backend.close(this.id);
        this.id = undefined;
        this.terminal.reset();
        this.cursorVisible = true;
        this.sgrMouse = false;
        this.begin();
      }
      return;
    }
    if (this.id === undefined) this.queued += data;
    else this.backend.write(this.id, data);
  }

  private type(data: string): void {
    this.selection = undefined;
    this.follow = true;
    this.send(data);
    this.schedule();
  }

  private ended(exitCode: number): void {
    this.exited = true;
    this.options.onExit?.(exitCode);
    this.terminal.write(
      `\r\n\x1b[2mProcess ended with code ${String(exitCode)}. Press Enter to start it again.\x1b[0m\r\n`,
    );
  }

  // Input

  private listen(): void {
    const { input, viewport } = this;
    input.addEventListener('keydown', (event) => {
      this.key(event);
    });
    input.addEventListener('input', (event) => {
      if (event.isComposing) return;
      const text = input.value;
      input.value = '';
      if (text !== '') this.type(text);
    });
    input.addEventListener('compositionend', (event) => {
      input.value = '';
      if (event.data !== '') this.type(event.data);
    });
    input.addEventListener('paste', (event) => {
      event.preventDefault();
      const text = (event.clipboardData?.getData('text/plain') ?? '').replace(/\r?\n/g, '\r');
      if (text === '') return;
      this.type(this.terminal.modes.bracketedPasteMode ? `\x1b[200~${text}\x1b[201~` : text);
    });
    input.addEventListener('focus', () => {
      this.focusChanged(true);
    });
    input.addEventListener('blur', () => {
      this.focusChanged(false);
    });
    viewport.addEventListener('scroll', () => {
      this.follow =
        viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - this.rowHeight / 2;
      this.schedule();
    });
    viewport.addEventListener('pointerdown', (event) => {
      this.pointerDown(event);
    });
    viewport.addEventListener('pointermove', (event) => {
      if (event.buttons === 0) this.report(event, 'move', -1);
    });
    viewport.addEventListener('wheel', (event) => {
      this.wheel(event);
    });
    viewport.addEventListener('contextmenu', (event) => {
      if (this.tracking()) event.preventDefault();
    });
  }

  private focusChanged(focused: boolean): void {
    this.focused = focused;
    if (this.terminal.modes.sendFocusMode) this.send(focused ? '\x1b[I' : '\x1b[O');
    this.schedule();
  }

  private key(event: KeyboardEvent): void {
    if (event.isComposing || this.options.passKey?.(event)) return;
    const mac = this.options.mac ?? false;
    const ctrl = mac ? event.metaKey : event.ctrlKey;
    const letter = event.key.toLowerCase();
    // Copy: Cmd+C on macOS; elsewhere Ctrl+Shift+C, or Ctrl+C while there's a selection.
    if (ctrl && letter === 'c' && (mac || event.shiftKey || this.selection)) {
      event.preventDefault();
      event.stopPropagation();
      const text = this.selectedText();
      if (text !== '') {
        (this.options.copy ?? systemCopy)(text);
      }
      this.selection = undefined;
      this.schedule();
      return;
    }
    // Paste: the text field's own paste event brings the text.
    if (ctrl && letter === 'v') {
      event.stopPropagation();
      return;
    }
    const data = encodeKey(event, {
      applicationCursorKeys: this.terminal.modes.applicationCursorKeysMode,
      mac,
    });
    if (data !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      this.type(data);
    } else if (!event.ctrlKey && !event.metaKey) {
      // Text: typed into the text field, which sends it.
      event.stopPropagation();
    }
  }

  // The mouse

  private tracking(): boolean {
    return this.terminal.modes.mouseTrackingMode !== 'none';
  }

  /** The cell under the pointer, in the buffer. */
  private positionAt(event: MouseEvent): Position {
    const rect = this.lines.getBoundingClientRect();
    return {
      line: clamp(
        Math.floor((event.clientY - rect.top) / this.rowHeight),
        0,
        this.terminal.buffer.active.length - 1,
      ),
      col: clamp(
        Math.floor((event.clientX - rect.left) / this.cellWidth),
        0,
        this.terminal.cols - 1,
      ),
    };
  }

  /** Reports a mouse event to a program that asked for them; false if it didn't. */
  private report(event: MouseEvent, kind: MouseReport['kind'], button: number): boolean {
    if (!this.tracking() || event.shiftKey || this.rowHeight === 0) return false;
    const at = this.positionAt(event);
    const row = at.line - this.terminal.buffer.active.baseY;
    const data = encodeMouse(
      { kind, button, col: at.col, row, shift: false, alt: event.altKey, ctrl: event.ctrlKey },
      this.terminal.modes.mouseTrackingMode,
      this.sgrMouse,
    );
    if (data !== undefined && row >= 0) this.send(data);
    return true;
  }

  private pointerDown(event: PointerEvent): void {
    // The view keeps the focus in its text field, and draws its own selection.
    event.preventDefault();
    this.input.focus();
    if (this.rowHeight === 0) return;
    if (this.report(event, 'press', event.button)) {
      this.trackPointer(
        (move) => {
          this.report(move, 'move', event.button);
        },
        (up) => {
          this.report(up, 'release', event.button);
        },
      );
      return;
    }
    if (event.button !== 0) return;
    const anchor = this.positionAt(event);
    if (event.detail === 2) {
      this.selectWord(anchor);
      return;
    }
    this.selection = { anchor, focus: anchor };
    this.schedule();
    this.trackPointer(
      (move) => {
        if (this.selection) this.selection.focus = this.positionAt(move);
        this.schedule();
      },
      () => {
        const s = this.selection;
        if (s && s.anchor.line === s.focus.line && s.anchor.col === s.focus.col) {
          this.selection = undefined;
          this.schedule();
        }
      },
    );
  }

  private trackPointer(move: (event: PointerEvent) => void, up: (event: PointerEvent) => void) {
    const onMove = (event: PointerEvent) => {
      move(event);
    };
    const onUp = (event: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      up(event);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  private selectWord(at: Position): void {
    const text = this.line(at.line).translateToString(false);
    if (!WORD.test(text.charAt(at.col))) return;
    let start = at.col;
    let end = at.col;
    while (start > 0 && WORD.test(text.charAt(start - 1))) start--;
    while (end < text.length - 1 && WORD.test(text.charAt(end + 1))) end++;
    this.selection = { anchor: { line: at.line, col: start }, focus: { line: at.line, col: end } };
    this.schedule();
  }

  private wheel(event: WheelEvent): void {
    if (event.deltaY === 0) return;
    const up = event.deltaY < 0;
    if (this.report(event, up ? 'wheel-up' : 'wheel-down', 0)) {
      event.preventDefault();
      return;
    }
    // A full-screen program without the mouse scrolls with the arrow keys, as in xterm.
    if (this.terminal.buffer.active.type === 'alternate') {
      event.preventDefault();
      const arrow = this.terminal.modes.applicationCursorKeysMode ? '\x1bO' : '\x1b[';
      this.send((arrow + (up ? 'A' : 'B')).repeat(3));
    }
  }

  // Selection

  private range(): { start: Position; end: Position } | undefined {
    const s = this.selection;
    if (!s) return undefined;
    const before =
      s.anchor.line < s.focus.line ||
      (s.anchor.line === s.focus.line && s.anchor.col <= s.focus.col);
    return before ? { start: s.anchor, end: s.focus } : { start: s.focus, end: s.anchor };
  }

  /** The selected columns of a line, if it has any. */
  private spanOn(y: number): Span | undefined {
    const range = this.range();
    if (!range || y < range.start.line || y > range.end.line) return undefined;
    return {
      start: y === range.start.line ? range.start.col : 0,
      end: y === range.end.line ? range.end.col + 1 : this.terminal.cols,
    };
  }
}

/** Copies to the system clipboard; a refusal (no permission) loses only the copy. */
function systemCopy(text: string): void {
  navigator.clipboard.writeText(text).catch((error: unknown) => {
    console.warn('Copying failed', error);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
