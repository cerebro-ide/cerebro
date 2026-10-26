// A sample plugin, written as a third party would: through the plugin API alone, in plain DOM (no
// Cerebro JSX), so it shows the boundary. A Notes tool window, a command that clears it, in the
// View menu with a shortcut.

import type { Plugin } from '@cerebro-ide/plugin-api';

export const notesPlugin: Plugin = {
  id: 'cerebro.notes',
  name: 'Notes',
  activate(context) {
    const notes: string[] = [];
    let list: HTMLUListElement | undefined;
    const draw = () => {
      if (!list) return;
      list.replaceChildren(
        ...notes.map((text) => {
          const item = document.createElement('li');
          item.textContent = text;
          return item;
        }),
      );
    };
    context.registerView({
      id: 'notes',
      title: 'Notes',
      anchor: 'right',
      icon: 'note',
      mount(container) {
        const input = document.createElement('input');
        input.className = 'playground-notes__input';
        input.placeholder = 'Add a note and press Enter';
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' || input.value.trim() === '') return;
          notes.push(input.value.trim());
          input.value = '';
          draw();
        });
        list = document.createElement('ul');
        list.className = 'playground-list';
        container.append(input, list);
        draw();
        return () => {
          list = undefined;
        };
      },
    });
    context.registerCommand({
      id: 'notes.clear',
      label: 'Clear &Notes',
      run: () => {
        notes.length = 0;
        draw();
      },
    });
    context.contributeMenu({ menu: 'main/view', item: { command: 'notes.clear' }, group: 'z' });
    // Not Ctrl+Alt+Shift+N: that's Go to Symbol, as in IntelliJ.
    context.bindKey('Mod+Alt+Shift+K', 'notes.clear');
  },
};
