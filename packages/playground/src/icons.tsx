// Simple line icons for the playground's sample tool windows. Drawn on a 16-unit grid; the view box
// crops the margins so the glyph fills the size the theme gives it, as IntelliJ's icons do.

const PATHS: Record<string, string> = {
  folder:
    'M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z',
  commit: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM1.5 8h4M10.5 8h4',
  push: 'M8 13.5V3M4.5 6.5L8 3l3.5 3.5',
  // Push's arrow, down: IntelliJ's Update Project.
  update: 'M8 2.5V13M4.5 9.5L8 13l3.5-3.5',
  // Update's arrow over a line: fetched, not yet in the branch (a claim: not IntelliJ's drawing).
  fetch: 'M8 2.5V10M4.5 6.5L8 10l3.5-3.5M3 13.5h10',
  structure: 'M3 3h4v3H3zM9 10h4v3H9zM5 6v5.5h4M9 4.5h4',
  bookmark: 'M4.5 2.5h7v11L8 10.5l-3.5 3z',
  note: 'M3.5 2.5h9v11h-9zM5.5 5.5h5M5.5 8h5M5.5 10.5h3',
  terminal: 'M2.5 3.5h11v9h-11zM5 6.5l2 1.5-2 1.5M8.5 10h2.5',
  problems: 'M8 2.5l6 10.5H2zM8 6.5v3M8 11.2v.3',
  // A light bulb: a context action, as IntelliJ's.
  bulb: 'M8 2a4 4 0 0 0-2.5 7.1v1.9h5V9.1A4 4 0 0 0 8 2zM6 13.5h4',
  // Two cherries on their stems: IntelliJ's Cherry-Pick (a claim: not IntelliJ's drawing).
  cherryPick:
    'M5 9.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM11 8.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5 9.5L9 2.5l2 6M9 2.5h3.5',
  git: 'M5 3v10M5 9c0-2 6-1 6-4M11 5a1.5 1.5 0 1 0 0-.01M5 13a1.5 1.5 0 1 0 0-.01',
  bell: 'M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 14h3',
  // With a dot: notifications not seen yet (a claim: IntelliJ's dot is coloured).
  bellNew: 'M4 11V7a4 4 0 0 1 6.2-3.3M12 7.5V11l1 1.5H3M6.5 14h3M12.5 4a1 1 0 1 0 0 .01',
  database:
    'M3 4c0-1 2.2-1.5 5-1.5s5 .5 5 1.5v8c0 1-2.2 1.5-5 1.5S3 13 3 12zM3 4c0 1 2.2 1.5 5 1.5S13 5 13 4M3 8c0 1 2.2 1.5 5 1.5S13 9 13 8',
  search: 'M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 10l3.5 3.5',
  // A search field's clear button.
  clear: 'M5 5l6 6M11 5l-6 6',
  file: 'M4 2.5h5l3 3v8H4zM9 2.5v3h3',
  check: 'M3.5 8.5l3 3 6-7',
  agent: 'M8 2v12M2 8h12M3.8 3.8l8.4 8.4M3.8 12.2l8.4-8.4',
  refresh: 'M12.5 8a4.5 4.5 0 1 1-1.3-3.2M11.5 2.5v2.5H9',
  rollback: 'M3 6.5h7a3 3 0 0 1 0 6H6M5.5 4L3 6.5 5.5 9',
  diff: 'M2.5 3.5h4.5v9H2.5zM9 3.5h4.5v9H9zM4 6.5h1.5M10.5 9.5H12',
  eye: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  // IntelliJ's ⋮ (moreVertical), for a tool window's Options.
  more: 'M7.4 3.5a.6.6 0 1 0 1.2 0a.6.6 0 1 0-1.2 0zM7.4 8a.6.6 0 1 0 1.2 0a.6.6 0 1 0-1.2 0zM7.4 12.5a.6.6 0 1 0 1.2 0a.6.6 0 1 0-1.2 0z',
  locate: 'M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3',
  expandAll: 'M5 5.5l3-3 3 3M5 10.5l3 3 3-3',
  collapseAll: 'M5 2.5l3 3 3-3M5 13.5l3-3 3 3',
  // A box with its lid: the shelf; a stack: the stash.
  shelf: 'M2.5 6.5h11v6.5h-11zM2 3.5h12v3H2zM6.5 9h3',
  stash: 'M3 3.5h10v3H3zM3 6.5h10v3H3zM3 9.5h10v3H3z',
  // A picture: an image file's tab.
  image: 'M2.5 3.5h11v9h-11zM2.5 10.5l3-3 2.5 2.5 2-2 3.5 3.5M10.5 6a.75.75 0 1 0 0 .01',
  // The image viewer's toolbar, as IntelliJ's: the chessboard, the grid, zoom, 1:1 and fit.
  chessboard: 'M2.5 2.5h11v11h-11zM8 2.5v11M2.5 8h11M4 4h2.5v2.5H4zM9.5 9.5H12V12H9.5z',
  grid: 'M2.5 2.5h11v11h-11zM6.17 2.5v11M9.83 2.5v11M2.5 6.17h11M2.5 9.83h11',
  zoomIn: 'M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 10l3.5 3.5M5 7h4M7 5v4',
  zoomOut: 'M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 10l3.5 3.5M5 7h4',
  actualSize: 'M2.5 3.5h11v9h-11zM5.5 6v4M10.5 6v4M8 6.8v.2M8 9.2v.2',
  fit: 'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3M5.5 5.5h5v5h-5z',
  // A diff's toolbar, as IntelliJ's: Previous and Next Difference (its previousOccurence and
  // nextOccurence arrows), and its Settings gear (a claim: not IntelliJ's drawing).
  previousDiff: 'M8 13V3M4.5 6.5L8 3l3.5 3.5',
  nextDiff: 'M8 3v10M4.5 9.5L8 13l3.5-3.5',
  // A diff window's Jump to Source (IntelliJ's editSource pencil) and Compare Previous and Next
  // File (its back and forward arrows): a claim, not IntelliJ's drawing.
  editSource: 'M3 13l.5-2.5 7-7 2 2-7 7zM9 5l2 2',
  previousFile: 'M13 8H3M6.5 4.5L3 8l3.5 3.5',
  nextFile: 'M3 8h10M9.5 4.5L13 8l-3.5 3.5',
  // A list's Add and Remove, as IntelliJ's toolbar over a table (a claim: not IntelliJ's drawing).
  add: 'M8 3v10M3 8h10',
  remove: 'M3 8h10',
  // The diff's viewers: two panes, side by side, or one with its lines (a claim: not IntelliJ's
  // drawing).
  sideBySide: 'M2.5 3.5h11v9h-11zM8 3.5v9',
  unified: 'M2.5 3.5h11v9h-11zM5 6.5h6M5 9.5h6',
  settings:
    'M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6.9 2.5h2.2l.4 1.6 1.4.8 1.6-.5 1.1 1.9-1.2 1.1v1.2l1.2 1.1-1.1 1.9-1.6-.5-1.4.8-.4 1.6H6.9l-.4-1.6-1.4-.8-1.6.5-1.1-1.9 1.2-1.1V7.4L2.4 6.3l1.1-1.9 1.6.5 1.4-.8z',
  services:
    'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
};

export function icon(name: string): Node {
  return (
    <svg viewBox="1.5 1.5 13 13" width="16" height="16" aria-hidden="true">
      <path
        d={PATHS[name] ?? 'M4 4h8v8H4z'}
        fill="none"
        stroke="currentColor"
        stroke-width="0.95"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/**
 * The letter on a symbol's icon, by its LSP kind, as IntelliJ's nodes: C for a class, m for a
 * method... (a claim: IntelliJ's are coloured badges, these are outlines in the text's colour).
 */
const SYMBOL_LETTERS: Record<string, string> = {
  class: 'C',
  interface: 'I',
  enum: 'E',
  struct: 'S',
  module: 'M',
  namespace: 'N',
  package: 'P',
  typeParameter: 'T',
  method: 'm',
  constructor: 'm',
  function: 'f',
  field: 'f',
  property: 'p',
  key: 'p',
  variable: 'v',
  constant: 'c',
  enumMember: 'e',
  event: 'e',
  operator: 'o',
};

/** A symbol's icon, by its LSP kind: its letter in a circle; the structure's icon for another. */
export function symbolIcon(kind: string | undefined): Node {
  const letter = kind === undefined ? undefined : SYMBOL_LETTERS[kind];
  if (letter === undefined) return icon('structure');
  return (
    <svg viewBox="1.5 1.5 13 13" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" stroke-width="0.95" />
      <text
        x="8"
        y="8"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="8"
        fill="currentColor"
      >
        {letter}
      </text>
    </svg>
  );
}
