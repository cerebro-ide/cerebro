import { describe, expect, it } from 'vitest';
import { frame, FrameReader } from '../src/framing.js';

describe('LSP framing', () => {
  it('counts a message’s bytes, not its characters', () => {
    expect(frame('{"a":"é"}')).toBe('Content-Length: 10\r\n\r\n{"a":"é"}');
  });

  it('reads messages split across chunks, and several in one, line breaks and all', () => {
    const messages: string[] = [];
    const reader = new FrameReader((message) => messages.push(message));
    const both = Buffer.from(frame('{"a":\n"é"}') + frame('{"b":2}'));
    // Split inside the header, and inside the é's two bytes.
    const cut = both.indexOf('é') + 1;
    reader.push(both.subarray(0, 8));
    reader.push(both.subarray(8, cut));
    expect(messages).toEqual([]);
    reader.push(both.subarray(cut));
    expect(messages).toEqual(['{"a":\n"é"}', '{"b":2}']);
  });

  it('takes other headers, in any case, and skips what has no length', () => {
    const messages: string[] = [];
    const reader = new FrameReader((message) => messages.push(message));
    reader.push('Junk\r\n\r\n');
    reader.push('content-length: 2\r\nContent-Type: application/vscode-jsonrpc\r\n\r\n{}');
    expect(messages).toEqual(['{}']);
  });
});
