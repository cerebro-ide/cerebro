// A git server over HTTP behind a login, for tests of asking for credentials (this package's, and
// the end-to-end tests'): `git http-backend` as CGI.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/** Whether git has its HTTP backend: MinGit, say, doesn't. */
export function hasHttpBackend(): boolean {
  const folder = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
  return ['git-http-backend', 'git-http-backend.exe'].some((name) =>
    existsSync(join(folder, name)),
  );
}

/**
 * A git server over HTTP, as a host's would be: `git http-backend` as CGI, behind Basic
 * authentication as `user` with `password`. `requests` has each one it was sent, with its answer's
 * status, for a test that failed to print.
 */
export async function gitServer(root: string, user: string, password: string) {
  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  const requests: string[] = [];
  const server: Server = createServer((request, response) => {
    response.on('finish', () => {
      requests.push(`${request.method ?? ''} ${request.url ?? ''} ${String(response.statusCode)}`);
    });
    if (request.headers.authorization !== expected) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' }).end();
      return;
    }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const header = (name: string) => {
      const value = request.headers[name];
      return typeof value === 'string' ? value : '';
    };
    const cgi = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method ?? 'GET',
        CONTENT_TYPE: header('content-type'),
        HTTP_CONTENT_ENCODING: header('content-encoding'),
        HTTP_GIT_PROTOCOL: header('git-protocol'),
        // Pushing over HTTP is for a user who logged in.
        REMOTE_USER: user,
        REMOTE_ADDR: '127.0.0.1',
      },
    });
    request.pipe(cgi.stdin);
    // CGI's output: headers (a `Status:` among them), a blank line, then the body.
    let head = Buffer.alloc(0);
    let body = false;
    cgi.stdout.on('data', (chunk: Buffer) => {
      if (body) {
        response.write(chunk);
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      let status = 200;
      for (const line of head.subarray(0, end).toString().split('\r\n')) {
        const colon = line.indexOf(':');
        const name = line.slice(0, colon);
        const value = line.slice(colon + 1).trim();
        if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10);
        else response.setHeader(name, value);
      }
      response.writeHead(status);
      body = true;
      response.write(head.subarray(end + 4));
    });
    cgi.stdout.on('end', () => response.end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${String(port)}`, server, requests };
}
