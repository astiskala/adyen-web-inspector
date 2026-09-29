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
      'The Scan (orchestrator, assessment, and frame merge) reaches the browser only through the ScanBrowser port',
    severity: 'error',
    from: { path: '^src/background/(scan-orchestrator|scan-assessment|frame-merge)\\.ts$' },
    to: {
      path: '^src/background/(chrome-[a-z-]+-browser|header-collector|npm-registry|worker|tab-state)\\.ts$',
    },
  },
  {
    name: 'tab-state-through-port',
    comment:
      'The tab state reaches Chrome only through its port and receives the Scan as a function',
    severity: 'error',
    from: { path: '^src/background/tab-state\\.ts$' },
    to: {
      path: '^src/background/(chrome-[a-z-]+-browser|header-collector|npm-registry|worker|scan-orchestrator|scan-assessment)\\.ts$',
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
    comment: 'Network capture and npm lookups are browser I/O owned by the Chrome adapter',
    severity: 'error',
    from: { path: '^src/', pathNot: '^src/background/chrome-scan-browser\\.ts$' },
    to: { path: '^src/background/(header-collector|npm-registry)\\.ts$' },
  },
  {
    name: 'config-schema-inline-safe',
    comment:
      'The config field schema is inlined into every content script, so it may depend on shared types only',
    severity: 'error',
    from: { path: '^src/shared/checkout-config-schema\\.ts$' },
    to: { path: '^src/', pathNot: '^src/shared/types\\.ts$' },
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
