// Simple line icons for the playground's sample tool windows. Drawn on a 16-unit grid; the view box
// crops the margins so the glyph fills the size the theme gives it, as IntelliJ's icons do.

const PATHS: Record<string, string> = {
  folder:
    'M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z',
  commit: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM1.5 8h4M10.5 8h4',
  structure: 'M3 3h4v3H3zM9 10h4v3H9zM5 6v5.5h4M9 4.5h4',
  bookmark: 'M4.5 2.5h7v11L8 10.5l-3.5 3z',
  note: 'M3.5 2.5h9v11h-9zM5.5 5.5h5M5.5 8h5M5.5 10.5h3',
  terminal: 'M2.5 3.5h11v9h-11zM5 6.5l2 1.5-2 1.5M8.5 10h2.5',
  problems: 'M8 2.5l6 10.5H2zM8 6.5v3M8 11.2v.3',
  git: 'M5 3v10M5 9c0-2 6-1 6-4M11 5a1.5 1.5 0 1 0 0-.01M5 13a1.5 1.5 0 1 0 0-.01',
  bell: 'M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 14h3',
  database:
    'M3 4c0-1 2.2-1.5 5-1.5s5 .5 5 1.5v8c0 1-2.2 1.5-5 1.5S3 13 3 12zM3 4c0 1 2.2 1.5 5 1.5S13 5 13 4M3 8c0 1 2.2 1.5 5 1.5S13 9 13 8',
  search: 'M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 10l3.5 3.5',
  file: 'M4 2.5h5l3 3v8H4zM9 2.5v3h3',
  check: 'M3.5 8.5l3 3 6-7',
  agent: 'M8 2v12M2 8h12M3.8 3.8l8.4 8.4M3.8 12.2l8.4-8.4',
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
