import { defaultClientConditions, defineConfig } from 'vite';

/**
 * What the built page may load: only its own files (images and fonts also as data: URLs). No
 * inline scripts or styles, no eval, no network. Only in the build: the dev server injects inline
 * styles for hot reloading.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export default defineConfig({
  plugins: [
    {
      name: 'cerebro-csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
        ),
    },
  ],
  // Relative URLs, so the built page also loads from files in the desktop app.
  base: './',
  resolve: { conditions: ['cerebro-source', ...defaultClientConditions] },
  oxc: { jsx: { runtime: 'automatic', importSource: '@cerebro-ide/jsx' } },
});
