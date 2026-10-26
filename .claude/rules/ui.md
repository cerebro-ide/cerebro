---
paths:
  - "packages/jsx/**"
  - "packages/reactive/**"
  - "packages/layout/**"
  - "packages/theme/**"
  - "packages/ui-*/**"
  - "packages/playground/**"
---

# The UI

- **No UI framework.** The UI is TypeScript and DOM, with Cerebro's own JSX runtime (`jsx`, which
  builds DOM nodes directly) and reactive core (`reactive`: `signal`, `computed`, `effect`,
  `ObservableMap`, `makeObservable`). A function child is reactive: it's run again when what it
  read changes. Clean up with `onCleanup`. See decisions "No UI framework", "The MobX-style API" and
  "JSX that builds DOM directly".
- **The page's Content-Security-Policy** (`packages/playground/vite.config.ts`) allows no inline
  styles: no `style="..."` attributes, no `<style>` elements, no `cssText`. Set styles through an
  element's style object (`element.style.height = ...`), or with constructable stylesheets.
  CodeMirror injects `<style>`, so editors live in a shadow root, given to CodeMirror as `root`.
- **Colours are theme tokens** (`--cerebro-*` in `packages/theme`), defined for both themes. A new
  colour that wasn't measured from IntelliJ or WebStorm is marked so in the decision that adds it.
- **IntelliJ (WebStorm's Islands theme) is the reference** for look and behaviour: when unsure how
  something should look or act, it's how IntelliJ does it. The UI behaves like a desktop
  application, not a website (decision "Desktop conventions in the UI").
- **The playground is the app's page** (`packages/playground`): it assembles the packages. It talks
  to the host through `currentHost()`, which is undefined in a plain browser: views say what shows
  in the desktop app instead.
- Packages are usable on their own (decision "Modular means usable in isolation"): a `ui-*`
  package doesn't import the playground, and takes what it needs as props.
