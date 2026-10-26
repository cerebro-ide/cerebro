// A terminal view: xterm.js showing a process the host runs on a pseudo-terminal. The view starts
// the process once it's on the page and has a size, sends it the keys typed, and fits it to its
// element as that resizes. The process is the host's, under a key: a view made again for the same
// key (after a reload, say) shows the running process with its recent output.
//
// Drawn with WebGL: xterm's DOM renderer adds <style> elements, which the page's
// Content-Security-Policy (`style-src 'self'`) blocks.

import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type IBufferLine, type ITerminalAddon, type ITheme } from '@xterm/xterm';

/** What the view needs from the host. */
export interface TerminalBackend {
  open(options: {
    key: string;
    cwd: string;
    command?: string;
    args?: string[];
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
  args?: string[];
  /** Default: 13. */
  fontSize?: number;
  /** Makes the WebGL renderer; tests replace it. */
  webgl?: () => ITerminalAddon;
}

/** The theme variables a terminal's colours come from. */
function theme(element: Element): ITheme {
  const style = getComputedStyle(element);
  const variable = (name: string) => style.getPropertyValue(`--cerebro-${name}`).trim();
  return {
    background: variable('background'),
    foreground: variable('text'),
    cursor: variable('text'),
    selectionBackground: variable('editor-selection'),
  };
}

export class TerminalView {
  /** Put this on the page; the terminal fills it. */
  readonly element: HTMLElement;
  private readonly terminal: Terminal;
  private readonly fit = new FitAddon();
  private readonly observer: ResizeObserver;
  private readonly stops: (() => void)[] = [];
  private id: number | undefined;
  private starting = false;
  private exited = false;
  /** Keys typed before the process started. */
  private queued = '';

  constructor(
    private readonly backend: TerminalBackend,
    private readonly options: TerminalOptions,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'cerebro-terminal';
    this.terminal = new Terminal({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: options.fontSize ?? 13,
      lineHeight: 1.2,
      scrollback: 10_000,
      allowProposedApi: true,
    });
    this.terminal.loadAddon(this.fit);
    this.terminal.onData((data) => {
      this.input(data);
    });
    this.terminal.onResize(({ cols, rows }) => {
      if (this.id !== undefined) this.backend.resize(this.id, cols, rows);
    });
    this.stops.push(
      backend.onData((id, data) => {
        if (id === this.id) this.terminal.write(data);
      }),
      backend.onExit((id, exitCode) => {
        if (id === this.id) this.ended(exitCode);
      }),
    );
    this.observer = new ResizeObserver(() => {
      this.layout();
    });
    this.observer.observe(this.element);
  }

  /** Re-reads the colours from the theme variables, as after switching dark and light. */
  refreshTheme(): void {
    this.terminal.options.theme = theme(this.element);
  }

  focus(): void {
    this.terminal.focus();
  }

  /** The text on screen, top to bottom: for tests and for reading what an agent shows. */
  text(): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      lines.push((buffer.getLine(i) as IBufferLine).translateToString(true));
    }
    return lines.join('\n').trimEnd();
  }

  /** Removes the view; the process keeps running in the host, for a view made again. */
  dispose(): void {
    this.observer.disconnect();
    for (const stop of this.stops) stop();
    this.terminal.dispose();
  }

  /** Ends the process too. */
  close(): void {
    if (this.id !== undefined && !this.exited) this.backend.close(this.id);
    this.dispose();
  }

  private layout(): void {
    if (this.element.clientWidth === 0 || this.element.clientHeight === 0) return;
    if (!this.terminal.element) {
      this.terminal.open(this.element);
      try {
        const webgl = (this.options.webgl ?? (() => new WebglAddon()))();
        this.terminal.loadAddon(webgl);
      } catch (error) {
        console.warn('No WebGL for the terminal: it may draw wrongly', error);
      }
      this.refreshTheme();
    }
    this.fit.fit();
    if (this.id === undefined && !this.starting) void this.start();
  }

  private async start(): Promise<void> {
    this.starting = true;
    this.exited = false;
    const { key, cwd, command, args } = this.options;
    const opened = await this.backend.open({
      key,
      cwd,
      ...(command === undefined ? {} : { command }),
      ...(args === undefined ? {} : { args }),
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

  private input(data: string): void {
    if (this.exited) {
      // Enter starts it again.
      if (data === '\r') {
        this.backend.close(this.id as number);
        this.id = undefined;
        this.terminal.reset();
        void this.start();
      }
      return;
    }
    if (this.id === undefined) this.queued += data;
    else this.backend.write(this.id, data);
  }

  private ended(exitCode: number): void {
    this.exited = true;
    this.terminal.write(
      `\r\n\x1b[2mProcess ended with code ${String(exitCode)}. Press Enter to start it again.\x1b[0m\r\n`,
    );
  }
}
