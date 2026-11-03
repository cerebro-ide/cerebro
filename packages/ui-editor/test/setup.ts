// Before each test file: the page's wall clock runs on its monotonic one. Under WSL the wall clock
// steps back by about 2.4 s every 30 s (measured), and CodeMirror times a pointer's rest and its
// completion list's first moments with `Date.now()`: a step back held a hover or an Enter up past
// a test's wait.
const origin = Date.now() - performance.now();
Date.now = () => Math.floor(origin + performance.now());
