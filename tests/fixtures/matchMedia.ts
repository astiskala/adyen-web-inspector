// jsdom does not implement media queries. Extension views start in light mode.
Object.defineProperty(globalThis, 'matchMedia', {
  configurable: true,
  writable: true,
  value: () => Object.assign(new EventTarget(), { matches: false }),
});
