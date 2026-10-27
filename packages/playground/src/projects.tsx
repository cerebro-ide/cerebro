// Projects, in the desktop app: the folders this window shows, as tabs, opening another (File →
// Open… with the system's folder picker, or a recent one), and closing one. As IntelliJ's, opening a
// project while one is open asks whether it joins this window or gets a new one, unless the "Open
// project in" setting says. The app keeps the windows and the recent projects
// (packages/app/src/projects.ts).

import type { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import type { OpenIn, Project, RecentProject } from './bridge.js';
import { globalSettings, save } from './settings.js';

let opened: Project[] = [];

/** Reads which projects this window shows, in the order they were opened. */
export async function loadProjects(): Promise<Project[]> {
  opened = (await window.cerebro?.project.current()) ?? [];
  return opened;
}

/** The projects this window shows: none in a browser, or in the Welcome window. */
export function windowProjects(): readonly Project[] {
  return opened;
}

/** A project joined this window. */
export function projectAdded(project: Project): void {
  opened = [...opened.filter((p) => p.path !== project.path), project];
}

/** A project left this window. */
export function projectRemoved(path: string): void {
  opened = opened.filter((p) => p.path !== path);
}

/** Shows why something failed, in a dialog. */
function showError(title: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  openDialog({ title, content: () => <p class="cerebro-selectable">{message}</p> });
}

/** Asks where a project goes, as IntelliJ's Open Project dialog; undefined if cancelled. */
async function askWhere(): Promise<OpenIn | undefined> {
  const remember = signal(false);
  const where = await openDialog<OpenIn>({
    title: 'Open Project',
    ok: { label: 'This Window', accept: () => 'this' },
    choices: [{ label: 'New Window', accept: () => 'new' }],
    content: () => (
      <div class="playground-open-project">
        <p>Where would you like to open the project?</p>
        <label class="playground-checkbox">
          <input
            type="checkbox"
            checked={() => remember.get()}
            on:change={(event) => {
              remember.set((event.currentTarget as HTMLInputElement).checked);
            }}
          />
          Remember, don’t ask again
        </label>
      </div>
    ),
  }).result;
  if (where && remember.peek()) {
    globalSettings.layers.global.set('project.openIn', where);
    save(globalSettings, ['global']);
  }
  return where;
}

/**
 * Opens a project: from the Welcome window, in a new window that replaces it; from a project's
 * window, where the setting says, asking if it says to. One open already is shown.
 */
export async function openProject(path: string): Promise<void> {
  const bridge = window.cerebro?.project;
  if (!bridge) return;
  let where: OpenIn | undefined = 'new';
  if (opened.length > 0 && !opened.some((p) => p.path === path)) {
    const setting = globalSettings.get('project.openIn');
    where = setting === 'this' || setting === 'new' ? setting : await askWhere();
  }
  if (!where) return;
  try {
    await bridge.open(path, where);
  } catch (error) {
    showError('Couldn’t Open the Project', error);
  }
}

/** Asks for a folder with the system's dialog, then opens it. */
export async function openFolder(): Promise<void> {
  const path = await window.cerebro?.project.pick();
  if (path) await openProject(path);
}

/** How a recent project shows in a menu: its name, and its folder for telling two apart. */
export function recentLabel(recent: RecentProject): string {
  return `${recent.name} [${recent.path}]`.replaceAll('&', '&&');
}

/** Closes one of this window's projects, saying if it can't. */
export async function closeProject(path: string): Promise<void> {
  try {
    await window.cerebro?.project.close(path);
  } catch (error) {
    showError('Couldn’t Close the Project', error);
  }
}

/**
 * File → Open… opens a folder, Open Recent lists the recent projects, Close Project closes the
 * active one (`close`).
 */
export async function setupProjects(
  commands: CommandRegistry,
  menus: MenuRegistry,
  close: () => Promise<void>,
): Promise<void> {
  const bridge = window.cerebro?.project;
  if (!bridge) return;
  commands.register({ id: 'project.close', label: 'Close Pro&ject', run: close });
  menus.contribute({ menu: 'main/file', item: { command: 'project.close' }, group: 'b' });
  const recent = await bridge.recent();
  recent
    .filter((r) => r.exists && !opened.some((p) => p.path === r.path))
    .forEach((r, i) => {
      const id = `project.recent.${String(i)}`;
      commands.register({ id, label: recentLabel(r), run: () => openProject(r.path) });
      menus.contribute({ menu: 'main/file/recent', item: { command: id } });
    });
}
