const path = require('node:path');

const recommendedStrict = require(
  path.join(__dirname, 'node_modules/dependency-cruiser/configs/recommended-strict.cjs')
);

const LAYER_BOUNDARY_RULES = [
  {
    name: 'shared-only-shared',
    comment: 'shared/ may only import from shared/',
    severity: 'error',
    from: { path: '^src/shared/' },
    to: { path: '^src/', pathNot: '^src/shared/' },
  },
  {
    name: 'popup-allowlist',
    comment: 'popup/ may only import from popup/ and shared/',
    severity: 'error',
    from: { path: '^src/popup/' },
    to: { path: '^src/', pathNot: '^src/(popup|shared)/' },
  },
  {
    name: 'devtools-allowlist',
    comment: 'devtools/ may only import from devtools/, shared/, and popup/components/',
    severity: 'error',
    from: { path: '^src/devtools/' },
    to: { path: '^src/', pathNot: '^src/(devtools|shared|popup/components)/' },
  },
  {
    name: 'content-allowlist',
    comment: 'content/ may only import from content/ and shared/',
    severity: 'error',
    from: { path: '^src/content/' },
    to: { path: '^src/', pathNot: '^src/(content|shared)/' },
  },
  {
    name: 'background-core-allowlist',
    comment: 'background/ (excluding checks/) may only import from background/ and shared/',
    severity: 'error',
    from: { path: '^src/background/', pathNot: '^src/background/checks/' },
    to: { path: '^src/', pathNot: '^src/(background|shared)/' },
  },
  {
    name: 'background-checks-allowlist',
    comment: 'background/checks/ may only import from background/checks/ and shared/',
    severity: 'error',
    from: { path: '^src/background/checks/' },
    to: { path: '^src/', pathNot: '^src/(background/checks|shared)/' },
  },
];

// Seams introduced by the architecture deepening (see AGENTS.md → Key Seams).
const SEAM_RULES = [
  {
    name: 'scan-through-browser-port',
    comment:
      'The Scan (orchestrator, assessment, frame merge, and captured traffic) reaches the browser only through the ScanBrowser port',
    severity: 'error',
    from: {
      path: '^src/background/(scan-orchestrator|scan-assessment|frame-merge|captured-traffic)\\.ts$',
    },
    to: {
      path: '^src/background/(chrome-[a-z-]+-browser|network-recorder|npm-registry|worker|tab-state)\\.ts$',
    },
  },
  {
    name: 'tab-state-through-port',
    comment:
      'The tab state reaches Chrome only through its port and receives the Scan as a function',
    severity: 'error',
    from: { path: '^src/background/tab-state\\.ts$' },
    to: {
      path: '^src/background/(chrome-[a-z-]+-browser|network-recorder|npm-registry|worker|scan-orchestrator|scan-assessment|captured-traffic)\\.ts$',
    },
  },
  {
    name: 'scan-port-types-only',
    comment: 'The ScanBrowser port declares types only and depends on shared types alone',
    severity: 'error',
    from: { path: '^src/background/scan-browser\\.ts$' },
    to: { path: '^src/', pathNot: '^src/shared/types\\.ts$' },
  },
  {
    name: 'chrome-adapter-wired-by-worker',
    comment:
      'Only the service worker selects the Chrome adapters for the ScanBrowser and tab state ports',
    severity: 'error',
    from: { path: '^src/', pathNot: '^src/background/worker\\.ts$' },
    to: { path: '^src/background/chrome-(scan|tab-state)-browser\\.ts$' },
  },
  {
    name: 'browser-io-behind-chrome-adapter',
    comment: 'Network recording and npm lookups are browser I/O owned by the Chrome adapter',
    severity: 'error',
    from: { path: '^src/', pathNot: '^src/background/chrome-scan-browser\\.ts$' },
    to: { path: '^src/background/(network-recorder|npm-registry)\\.ts$' },
  },
  {
    name: 'tab-state-client-wired-by-views',
    comment:
      'Only the popup and DevTools panel roots select the Chrome adapter for the tab state client; the scan lifecycle hook takes the client as an argument',
    severity: 'error',
    from: { path: '^src/', pathNot: '^src/(popup/PopupApp\\.tsx|devtools/panel/Panel\\.tsx)$' },
    to: { path: '^src/popup/components/chrome-tab-state-client\\.ts$' },
  },
  {
    name: 'config-schema-inline-safe',
    comment:
      'The config field schema is inlined into every content script, so it may depend on shared types only',
    severity: 'error',
    from: { path: '^src/shared/checkout-config-schema\\.ts$' },
    to: { path: '^src/', pathNot: '^src/shared/types\\.ts$' },
  },
  {
    name: 'adyen-endpoint-inline-safe',
    comment:
      'The Adyen endpoint reading is inlined into every content script, so it may depend on shared types only',
    severity: 'error',
    from: { path: '^src/shared/adyen-endpoint\\.ts$' },
    to: { path: '^src/', pathNot: '^src/shared/types\\.ts$' },
  },
  {
    name: 'evidence-inline-safe',
    comment:
      'Configuration evidence and SDK presence are inlined into the detector through the checkout signals, so they may depend on types and the Adyen endpoint reading only',
    severity: 'error',
    from: { path: '^src/shared/(scan-evidence|sdk-presence)\\.ts$' },
    to: { path: '^src/', pathNot: '^src/shared/(types|adyen-endpoint)\\.ts$' },
  },
  {
    name: 'checkout-capture-inline-safe',
    comment:
      'The capture record is inlined into the config interceptor and page extractor, so it may depend on types, the config field schema, and the Adyen endpoint reading only',
    severity: 'error',
    from: { path: '^src/shared/checkout-capture\\.ts$' },
    to: {
      path: '^src/',
      pathNot: '^src/shared/(types|checkout-config-schema|adyen-endpoint)\\.ts$',
    },
  },
  {
    name: 'checkout-signals-inline-safe',
    comment:
      'The checkout signals are inlined into the detector and page extractor, so they may depend on types, the Adyen endpoint reading, configuration evidence, and SDK presence only',
    severity: 'error',
    from: { path: '^src/shared/checkout-signals\\.ts$' },
    to: {
      path: '^src/',
      pathNot: '^src/shared/(types|adyen-endpoint|scan-evidence|sdk-presence)\\.ts$',
    },
  },
];

const strictRulesWithoutOrphans = recommendedStrict.forbidden.filter(
  (rule) => rule.name !== 'no-orphans'
);

const noOrphansRule = {
  ...recommendedStrict.forbidden.find((rule) => rule.name === 'no-orphans'),
  from: {
    orphan: true,
    pathNot:
      '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$|' +
      '\\.d\\.(c|m)?ts$|' +
      '(^|/)tsconfig\\.json$|' +
      '(^|/)(?:babel|webpack)\\.config\\.(?:js|cjs|mjs|ts|json)$',
  },
};

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [noOrphansRule, ...strictRulesWithoutOrphans, ...LAYER_BOUNDARY_RULES, ...SEAM_RULES],
  options: {
    ...recommendedStrict.options,
    doNotFollow: {
      ...recommendedStrict.options.doNotFollow,
      path: 'node_modules',
    },
    includeOnly: '^src/',
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: './tsconfig.json',
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
