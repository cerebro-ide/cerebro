import { describe, expect, it } from 'vitest';
import {
  chordFromMouse,
  CommandRegistry,
  DRAG_DISTANCE,
  Keymap,
  MouseDispatcher,
  type MouseEventLike,
} from '../src/index.js';

const mouse = (overrides: Partial<MouseEventLike> = {}): MouseEventLike => ({
  button: 0,
  detail: 1,
  clientX: 10,
  clientY: 10,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...overrides,
});

describe('a mouse chord', () => {
  it('is the button’s click, once or twice, with the modifiers held', () => {
    expect(chordFromMouse(mouse({ ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+Click');
    expect(chordFromMouse(mouse({ button: 1, shiftKey: true, metaKey: true }))).toBe(
      'Shift+Meta+MiddleClick',
    );
    expect(chordFromMouse(mouse({ button: 2, detail: 2 }))).toBe('DoubleRightClick');
    // A press the DOM counts as no click yet: one.
    expect(chordFromMouse(mouse({ detail: 0 }))).toBe('Click');
  });

  it('is a single click past the third button, none for a third click or another button', () => {
    expect(chordFromMouse(mouse({ button: 3, detail: 2 }))).toBe('Button4Click');
    expect(chordFromMouse(mouse({ button: 4 }))).toBe('Button5Click');
    expect(chordFromMouse(mouse({ detail: 3 }))).toBeUndefined();
    expect(chordFromMouse(mouse({ button: 5 }))).toBeUndefined();
  });
});

describe('the mouse dispatcher', () => {
  function setup() {
    const keymap = new Keymap('other');
    const commands = new CommandRegistry();
    const ran: [string, unknown][] = [];
    for (const id of ['back', 'goTo', 'off', 'doc']) {
      commands.register({
        id,
        label: id,
        enabled: () => id !== 'off',
        run: (context) => ran.push([id, context]),
      });
    }
    keymap.bindDefault('Button4Click', 'back');
    keymap.bindDefault('Ctrl+Click', 'off');
    keymap.bindDefault('Ctrl+Click', 'goTo');
    keymap.bindDefault('Alt+MiddleClick', 'doc');
    return { dispatcher: new MouseDispatcher(keymap, commands), ran };
  }

  it('runs a back or forward button’s as it’s pressed, its release taken with it', () => {
    const { dispatcher, ran } = setup();
    expect(dispatcher.press(mouse({ button: 3 }), 'here')).toBe(true);
    expect(ran).toEqual([['back', 'here']]);
    // Its release is its own, once.
    expect(dispatcher.release(mouse({ button: 3 }))).toBe(true);
    expect(dispatcher.release(mouse({ button: 3 }))).toBe(false);
    expect(dispatcher.press(mouse({ button: 4 }))).toBe(false);
    expect(dispatcher.release(mouse({ button: 4 }))).toBe(false);
    expect(ran).toHaveLength(1);
  });

  it('runs the first three’s as they’re let go, the first enabled, with the modifiers pressed with', () => {
    const { dispatcher, ran } = setup();
    expect(dispatcher.press(mouse({ ctrlKey: true }))).toBe(false);
    expect(ran).toEqual([]);
    // Ctrl let go before the button: the click is still Ctrl's.
    expect(dispatcher.release(mouse(), 'at')).toBe(true);
    expect(ran).toEqual([['goTo', 'at']]);
    dispatcher.press(mouse({ button: 1, altKey: true }));
    expect(dispatcher.release(mouse({ button: 1 }))).toBe(true);
    expect(ran.at(-1)).toEqual(['doc', undefined]);
    // A click nothing's bound to.
    dispatcher.press(mouse());
    expect(dispatcher.release(mouse())).toBe(false);
  });

  it('reads an event whose fields are getters, as a DOM event’s', () => {
    const { dispatcher, ran } = setup();
    class Pressed {
      constructor(private readonly init: MouseEventLike) {}
      get button() {
        return this.init.button;
      }
      get detail() {
        return this.init.detail;
      }
      get clientX() {
        return this.init.clientX;
      }
      get clientY() {
        return this.init.clientY;
      }
      get ctrlKey() {
        return this.init.ctrlKey;
      }
      get altKey() {
        return this.init.altKey;
      }
      get shiftKey() {
        return this.init.shiftKey;
      }
      get metaKey() {
        return this.init.metaKey;
      }
    }
    dispatcher.press(new Pressed(mouse({ ctrlKey: true })));
    expect(dispatcher.release(new Pressed(mouse({ ctrlKey: true })))).toBe(true);
    expect(ran).toEqual([['goTo', undefined]]);
  });

  it('runs none for a drag, or a release whose press it didn’t see', () => {
    const { dispatcher, ran } = setup();
    dispatcher.press(mouse({ ctrlKey: true }));
    expect(dispatcher.release(mouse({ clientX: 10 + DRAG_DISTANCE + 1 }))).toBe(false);
    expect(dispatcher.release(mouse({ ctrlKey: true }))).toBe(false);
    // Within the distance: a click.
    dispatcher.press(mouse({ ctrlKey: true }));
    expect(dispatcher.release(mouse({ clientY: 10 + DRAG_DISTANCE }))).toBe(true);
    expect(ran).toEqual([['goTo', undefined]]);
  });
});
