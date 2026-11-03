// The browser commands the playground's tests add (vitest.config.ts).

declare module 'vitest/browser' {
  interface BrowserCommands {
    colorScheme: (scheme: 'dark' | 'light') => Promise<void>;
  }
}

export {};
