import { describe, expect, it, vi } from 'vitest';
import { Connection, ErrorCodes, LineReader, ResponseError } from '../src/index.js';

/** Two connections talking to each other, with every line each one sent. */
function pair() {
  const sent = { a: [] as string[], b: [] as string[] };
  // eslint-disable-next-line prefer-const -- the two refer to each other
  let b: Connection;
  const a = new Connection((line) => {
    sent.a.push(line);
    b.receive(line);
  });
  b = new Connection((line) => {
    sent.b.push(line);
    a.receive(line);
  });
  return { a, b, sent };
}

/** A connection whose replies are collected, to feed it raw lines. */
function raw() {
  const replies: unknown[] = [];
  const connection = new Connection((line) => replies.push(JSON.parse(line)));
  return { connection, replies };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('Connection', () => {
  it('answers requests with what the handler returns or resolves to', async () => {
    const { a, b } = pair();
    b.onRequest('add', (params) => {
      const [x, y] = params as [number, number];
      return x + y;
    });
    b.onRequest('later', async () => {
      await settle();
      return 'done';
    });
    b.onRequest('nothing', () => undefined);
    expect(await a.request('add', [2, 3])).toBe(5);
    expect(await a.request('later')).toBe('done');
    expect(await a.request('nothing')).toBeNull();
  });

  it('sends JSON-RPC 2.0, one message per line', async () => {
    const { a, b, sent } = pair();
    b.onRequest('echo', (params) => params);
    await a.request('echo', { text: 'two\nlines' });
    a.notify('hello');
    expect(sent.a.map((line) => JSON.parse(line) as unknown)).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'echo', params: { text: 'two\nlines' } },
      { jsonrpc: '2.0', method: 'hello' },
    ]);
    expect(sent.a.every((line) => !line.includes('\n'))).toBe(true);
    expect(JSON.parse(sent.b[0] as string)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { text: 'two\nlines' },
    });
  });

  it('works both ways, with notifications', async () => {
    const { a, b } = pair();
    const seen = vi.fn();
    a.onNotification('progress', seen);
    a.onRequest('who', () => 'a');
    b.onRequest('ask', () => b.request('who'));
    b.notify('progress', 0.5);
    b.notify('unknown');
    expect(seen).toHaveBeenCalledWith(0.5);
    expect(await a.request('ask')).toBe('a');
  });

  it('fails a request with the error its handler throws', async () => {
    const { a, b } = pair();
    b.onRequest('typed', () => {
      throw new ResponseError(ErrorCodes.InvalidParams, 'Bad params', { field: 'x' });
    });
    b.onRequest('plain', () => {
      throw new Error('boom');
    });
    b.onRequest('odd', () => Promise.reject(new Error('rejected')));
    b.onRequest('value', () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- what a careless handler does
      throw 'just a string';
    });
    await expect(a.request('typed')).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
      message: 'Bad params',
      data: { field: 'x' },
    });
    await expect(a.request('plain')).rejects.toMatchObject({
      code: ErrorCodes.InternalError,
      message: 'boom',
    });
    await expect(a.request('odd')).rejects.toMatchObject({ message: 'rejected' });
    await expect(a.request('value')).rejects.toMatchObject({ message: 'just a string' });
    await expect(a.request('missing')).rejects.toMatchObject({
      code: ErrorCodes.MethodNotFound,
      message: 'Method not found: missing',
    });
  });

  it('cancels a request: the handler sees it, and the request fails', async () => {
    const { a, b } = pair();
    const cancelled = vi.fn();
    let finish: () => void = () => undefined;
    b.onRequest('slow', (_params, token) => {
      token.onCancel(cancelled);
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    let cancel: () => void = () => undefined;
    const request = a.request('slow', undefined, {
      cancel: new Promise<void>((resolve) => {
        cancel = resolve;
      }),
    });
    await settle();
    cancel();
    await settle();
    expect(cancelled).toHaveBeenCalledOnce();
    finish();
    await expect(request).rejects.toMatchObject({ code: ErrorCodes.RequestCancelled });
  });

  it('doesn’t cancel a request that has already been answered', async () => {
    const { a, b, sent } = pair();
    b.onRequest('quick', () => 1);
    let cancel: () => void = () => undefined;
    const result = await a.request('quick', undefined, {
      cancel: new Promise<void>((resolve) => {
        cancel = resolve;
      }),
    });
    cancel();
    await settle();
    expect(result).toBe(1);
    expect(sent.a.some((line) => line.includes('$/cancelRequest'))).toBe(false);
  });

  it('tells a handler cancelled already, and ignores cancelling unknown requests', () => {
    const { connection } = raw();
    const order: string[] = [];
    connection.onRequest('slow', (_params, token) => {
      order.push(`cancelled: ${String(token.cancelled)}`);
      return new Promise(() => undefined);
    });
    connection.receive('{"jsonrpc":"2.0","id":1,"method":"slow"}');
    connection.receive('{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":99}}');
    connection.receive('{"jsonrpc":"2.0","method":"$/cancelRequest","params":"x"}');
    return settle().then(() => {
      expect(order).toEqual(['cancelled: false']);
      // Cancelled twice is cancelled once; a listener added after hears at once.
      connection.receive('{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":1}}');
      connection.receive('{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":1}}');
    });
  });

  it('tells a handler that runs after its request was cancelled', async () => {
    const { connection, replies } = raw();
    const seen: string[] = [];
    connection.onRequest('slow', (_params, token) => {
      seen.push(`cancelled: ${String(token.cancelled)}`);
      token.onCancel(() => seen.push('heard at once'));
      return 'ignored';
    });
    // The cancellation arrives before the handler has had a chance to run.
    connection.receive('{"jsonrpc":"2.0","id":1,"method":"slow"}');
    connection.receive('{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":1}}');
    await settle();
    expect(seen).toEqual(['cancelled: true', 'heard at once']);
    expect(replies).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: { code: ErrorCodes.RequestCancelled, message: 'Request cancelled' },
      },
    ]);
  });

  it('answers nothing to a request that comes after it closed', async () => {
    const { connection, replies } = raw();
    connection.onRequest('x', () => 1);
    connection.close();
    connection.receive('{"jsonrpc":"2.0","id":1,"method":"x"}');
    await settle();
    expect(replies).toEqual([]);
  });

  it('answers malformed messages with JSON-RPC errors', () => {
    const { connection, replies } = raw();
    connection.receive('not json');
    connection.receive('[1, 2]');
    connection.receive('{"jsonrpc":"1.0","id":4,"method":"x"}');
    connection.receive('{"jsonrpc":"2.0","id":{},"method":"x"}');
    connection.receive('{"jsonrpc":"2.0","result":1}');
    connection.receive('   ');
    expect(replies).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: ErrorCodes.ParseError, message: 'Parse error' } },
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: ErrorCodes.InvalidRequest, message: 'Invalid request' },
      },
      {
        jsonrpc: '2.0',
        id: 4,
        error: { code: ErrorCodes.InvalidRequest, message: 'Invalid request' },
      },
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: ErrorCodes.InvalidRequest, message: 'Invalid request' },
      },
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: ErrorCodes.InvalidRequest, message: 'Invalid request' },
      },
    ]);
  });

  it('ignores responses it didn’t ask for, and reads odd error responses', async () => {
    const { connection } = raw();
    connection.receive('{"jsonrpc":"2.0","id":42,"result":1}');
    const request = connection.request('x');
    connection.receive('{"jsonrpc":"2.0","id":1,"error":{}}');
    await expect(request).rejects.toMatchObject({
      code: ErrorCodes.InternalError,
      message: 'Unknown error',
    });
  });

  it('fails waiting requests on close, and sends nothing after', async () => {
    const { connection, replies } = raw();
    const waiting = connection.request('x');
    let stopped = false;
    connection.onRequest('long', (_params, token) => {
      token.onCancel(() => {
        stopped = true;
      });
      return new Promise(() => undefined);
    });
    connection.receive('{"jsonrpc":"2.0","id":7,"method":"long"}');
    connection.onRequest('late', async () => {
      await settle();
      return 1;
    });
    connection.receive('{"jsonrpc":"2.0","id":8,"method":"late"}');
    await settle();
    connection.close();
    connection.close();
    await expect(waiting).rejects.toMatchObject({ code: ErrorCodes.ConnectionClosed });
    await expect(connection.request('y')).rejects.toMatchObject({
      code: ErrorCodes.ConnectionClosed,
    });
    connection.notify('z');
    connection.receive('not json');
    await settle();
    await settle();
    expect(stopped).toBe(true);
    // Only the first request went out; nothing after the close.
    expect(replies).toHaveLength(1);
  });
});

describe('LineReader', () => {
  it('splits chunks into lines, joining a line split across chunks', () => {
    const lines: string[] = [];
    const reader = new LineReader((line) => lines.push(line));
    reader.push('{"a":1}\n{"b"');
    reader.push(':2}\r\n\n{"c"');
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '']);
    reader.push(':3}\n');
    expect(lines.at(-1)).toBe('{"c":3}');
  });
});
