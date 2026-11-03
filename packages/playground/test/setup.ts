// Before each test file: the page's styles, as the app has them, so what's laid out is where it is
// there (a dialog over a popup, not moved by its closing).
import '@cerebro-ide/theme/fonts.css';
import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/theme/base.css';
import '@cerebro-ide/ui-menu/styles.css';
import '@cerebro-ide/ui-dialog/styles.css';
import '@cerebro-ide/ui-popup/styles.css';
import '@cerebro-ide/ui-settings/styles.css';
import '@cerebro-ide/ui-keymap/styles.css';
import '@cerebro-ide/ui-tooltip/styles.css';
import '@cerebro-ide/ui-scrollbar/styles.css';
import '@cerebro-ide/ui-statusbar/styles.css';
import '@cerebro-ide/ui-tree/styles.css';
import '@cerebro-ide/ui-editor/styles.css';
import '@cerebro-ide/ui-toolbar/styles.css';
import '@cerebro-ide/ui-layout/styles.css';
import '@cerebro-ide/ui-terminal/styles.css';
import '../src/playground.css';

// And the browser's storage keeps what an earlier file saved (a layout,
// settings), which the playground's modules read as they load.
localStorage.clear();

// The page's wall clock runs on its monotonic one, as in ui-editor's tests (its setup says why).
const origin = Date.now() - performance.now();
Date.now = () => Math.floor(origin + performance.now());
