// Requests from the page to the main process. Electron puts its own words in front of an error
// thrown in an `ipcMain.handle` handler ("Error invoking remote method '<channel>': Error: …"), and
// the page shows errors' messages: so a handler's failure goes back as a value, and the preload
// (preload.cts, `invoke`) throws it again with its message alone.

import { ipcMain, type IpcMainInvokeEvent } from 'electron';

/** What a handler gives the page: its result, or the message of what it threw. */
export type Answer = { result: unknown } | { error: string };

/** Answers the page's requests on `channel` with `handler`, as an `Answer`. */
export function handle(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<Answer> => {
    try {
      return { result: await handler(event, ...args) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  });
}
