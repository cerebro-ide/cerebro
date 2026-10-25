import { EditorArea } from './editor-area.js';
import { ToolWindows } from './tool-windows.js';

/** The whole window's layout: tool windows around the editor area. */
export class Layout {
  readonly toolWindows = new ToolWindows();
  readonly editor = new EditorArea();
}
