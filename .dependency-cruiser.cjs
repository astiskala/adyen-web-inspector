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
  forbidden: [noOrphansRule, ...strictRulesWithoutOrphans, ...LAYER_BOUNDARY_RULES],
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
