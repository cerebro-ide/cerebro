// JSON-RPC 2.0 over lines of text: one message per line (JSON never contains a raw newline), the
// same over a child process's stdio, wsl.exe or ssh. Either side can send requests and
// notifications. A request can be cancelled with a `$/cancelRequest` notification, as in the
// Language Server Protocol; its handler sees the cancellation and the request fails with
// RequestCancelled.
//
// The connection is transport-neutral: it's given a function that sends a line, and is handed the
// lines received (LineReader splits a stream's chunks into them).

export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  /** The request was cancelled: LSP's code. */
  RequestCancelled: -32800,
  /** The connection closed before the response came. */
  ConnectionClosed: -32099,
} as const;

/** An error a request failed with, as sent between the two sides. */
export class ResponseError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ResponseError';
  }
}

/** Tells a request's handler that the request was cancelled. */
export interface CancellationToken {
  readonly cancelled: boolean;
  /** Calls `listener` when cancelled, right away if it already is. */
  onCancel(listener: () => void): void;
}

class Cancellation implements CancellationToken {
  cancelled = false;
  private readonly listeners: (() => void)[] = [];

  onCancel(listener: () => void): void {
    if (this.cancelled) listener();
    else this.listeners.push(listener);
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const listener of this.listeners.splice(0)) listener();
  }
}

export type RequestHandler = (params: unknown, token: CancellationToken) => unknown;
export type NotificationHandler = (params: unknown) => void;

/** What's needed to cancel a request already sent. */
export interface RequestOptions {
  /** Cancels the request when it resolves. */
  cancel?: Promise<unknown>;
}

type Id = number | string;

interface Pending {
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is Id {
  return typeof value === 'number' || typeof value === 'string';
}

export class Connection {
  private nextId = 1;
  private readonly pending = new Map<Id, Pending>();
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private readonly notificationHandlers = new Map<string, NotificationHandler>();
  /** Requests being handled, so they can be cancelled. */
  private readonly running = new Map<Id, Cancellation>();
  private closed = false;

  /** `send` writes one line to the other side. */
  constructor(private readonly send: (line: string) => void) {}

  /** Handles requests for `method`: what the handler returns (or resolves to) is the result. */
  onRequest(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  /** Sends a request; resolves with its result, or rejects with a ResponseError. */
  request(method: string, params?: unknown, options: RequestOptions = {}): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new ResponseError(ErrorCodes.ConnectionClosed, 'Connection closed'));
    }
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    void options.cancel?.then(() => {
      if (this.pending.has(id)) this.notify('$/cancelRequest', { id });
    });
    return result;
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  /** Handles one line received from the other side. */
  receive(line: string): void {
    if (line.trim() === '') return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.respondError(null, ErrorCodes.ParseError, 'Parse error');
      return;
    }
    if (!isRecord(message) || message['jsonrpc'] !== '2.0') {
      this.respondError(
        isRecord(message) && isId(message['id']) ? message['id'] : null,
        ErrorCodes.InvalidRequest,
        'Invalid request',
      );
      return;
    }
    const { id, method } = message;
    if (typeof method === 'string') {
      if (isId(id)) this.handleRequest(id, method, message['params']);
      else if (id === undefined) this.handleNotification(method, message['params']);
      else this.respondError(null, ErrorCodes.InvalidRequest, 'Invalid request');
    } else if (isId(id)) this.handleResponse(id, message);
    else this.respondError(null, ErrorCodes.InvalidRequest, 'Invalid request');
  }

  /** Ends the connection: requests still waiting fail with ConnectionClosed. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.reject(new ResponseError(ErrorCodes.ConnectionClosed, 'Connection closed'));
    }
    this.pending.clear();
    for (const cancellation of this.running.values()) cancellation.cancel();
  }

  private write(message: Record<string, unknown>): void {
    this.send(JSON.stringify(message));
  }

  private respondError(id: Id | null, code: number, message: string, data?: unknown): void {
    if (this.closed) return;
    this.write({
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    });
  }

  private handleRequest(id: Id, method: string, params: unknown): void {
    const handler = this.requestHandlers.get(method);
    if (!handler) {
      this.respondError(id, ErrorCodes.MethodNotFound, `Method not found: ${method}`);
      return;
    }
    const cancellation = new Cancellation();
    this.running.set(id, cancellation);
    const finish = (respond: () => void) => {
      this.running.delete(id);
      if (cancellation.cancelled) {
        this.respondError(id, ErrorCodes.RequestCancelled, 'Request cancelled');
      } else if (!this.closed) respond();
    };
    Promise.resolve()
      .then(() => handler(params, cancellation))
      .then(
        (result: unknown) => {
          finish(() => {
            this.write({ jsonrpc: '2.0', id, result: result ?? null });
          });
        },
        (error: unknown) => {
          finish(() => {
            if (error instanceof ResponseError) {
              this.respondError(id, error.code, error.message, error.data);
            } else {
              const message = error instanceof Error ? error.message : String(error);
              this.respondError(id, ErrorCodes.InternalError, message);
            }
          });
        },
      );
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === '$/cancelRequest') {
      const id = isRecord(params) ? params['id'] : undefined;
      if (isId(id)) this.running.get(id)?.cancel();
      return;
    }
    // Notifications get no answer, so an unknown one is ignored.
    this.notificationHandlers.get(method)?.(params);
  }

  private handleResponse(id: Id, message: Record<string, unknown>): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    const error = message['error'];
    if (isRecord(error)) {
      pending.reject(
        new ResponseError(
          typeof error['code'] === 'number' ? error['code'] : ErrorCodes.InternalError,
          typeof error['message'] === 'string' ? error['message'] : 'Unknown error',
          error['data'],
        ),
      );
    } else pending.resolve(message['result']);
  }
}

/** Splits a stream's text chunks into lines; a line split across chunks is joined. */
export class LineReader {
  private buffer = '';

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let end = this.buffer.indexOf('\n');
    while (end >= 0) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '');
      this.buffer = this.buffer.slice(end + 1);
      this.onLine(line);
      end = this.buffer.indexOf('\n');
    }
  }
}
