// A dialog asking for one line of text, in place of the browser's prompt(): a labelled field, OK
// enabled once the text is valid, and the reason shown under the field while it isn't.

import { signal } from '@cerebro-ide/reactive';
import { openDialog } from './dialog.js';

export interface PromptOptions {
  title: string;
  /** The field's label. */
  label: string;
  /** The text it starts with, selected. */
  value?: string;
  /** Default: OK. */
  ok?: string;
  /** Why the text can't be accepted, or undefined when it can. Blank text never can. */
  validate?: (text: string) => string | undefined;
  platform?: 'mac' | 'other';
}

/** Asks for a line of text: resolves with it, trimmed, or undefined if cancelled. */
export function prompt(options: PromptOptions): Promise<string | undefined> {
  const text = signal(options.value ?? '');
  const error = () => options.validate?.(text.get().trim());
  const valid = () => text.get().trim() !== '' && error() === undefined;
  return openDialog<string>({
    title: options.title,
    width: 400,
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ok: {
      ...(options.ok === undefined ? {} : { label: options.ok }),
      enabled: valid,
      accept: () => text.get().trim(),
    },
    content: () => (
      <label class="cerebro-dialog-field">
        <span class="cerebro-dialog-field__label">{options.label}</span>
        <input
          class={() =>
            error() === undefined
              ? 'cerebro-dialog-field__input'
              : 'cerebro-dialog-field__input cerebro-dialog-field__input--invalid'
          }
          type="text"
          spellcheck={false}
          value={text.get()}
          aria-invalid={() => String(error() !== undefined)}
          ref={(input) => {
            queueMicrotask(() => {
              input.select();
            });
          }}
          on:input={(event) => {
            text.set((event.currentTarget as HTMLInputElement).value);
          }}
        />
        <span class="cerebro-dialog-field__error" role="alert">
          {() => error() ?? ''}
        </span>
      </label>
    ),
  }).result;
}
