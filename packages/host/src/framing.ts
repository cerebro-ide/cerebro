// The Language Server Protocol's framing: each message after a `Content-Length` header counting
// its bytes in UTF-8, so a message can hold line breaks. Cerebro's own protocol is one message per
// line instead (LineReader); a Connection works over either.

const SEPARATOR = Buffer.from('\r\n\r\n');

/** A message framed for the Language Server Protocol. */
export function frame(message: string): string {
  return `Content-Length: ${String(Buffer.byteLength(message))}\r\n\r\n${message}`;
}

/** Splits a stream's chunks into framed messages; one split across chunks is joined. */
export class FrameReader {
  private buffer = Buffer.alloc(0);

  constructor(private readonly onMessage: (message: string) => void) {}

  push(chunk: Buffer | string): void {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    for (;;) {
      const end = this.buffer.indexOf(SEPARATOR);
      if (end < 0) return;
      const header = this.buffer.subarray(0, end).toString('ascii');
      const length = /Content-Length:\s*(\d+)/i.exec(header)?.[1];
      const start = end + SEPARATOR.length;
      if (length === undefined) {
        // Not a header: skipped, so what follows can still be read.
        this.buffer = this.buffer.subarray(start);
        continue;
      }
      if (this.buffer.length < start + Number(length)) return;
      const body = this.buffer.subarray(start, start + Number(length)).toString('utf8');
      this.buffer = this.buffer.subarray(start + Number(length));
      this.onMessage(body);
    }
  }
}
