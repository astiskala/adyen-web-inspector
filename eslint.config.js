import { defineConfig } from 'eslint/config';
import gts from 'gts';
import importX, { createNodeResolver } from 'eslint-plugin-import-x';
import jsdoc from 'eslint-plugin-jsdoc';
import react from 'eslint-plugin-react';
import regexp from 'eslint-plugin-regexp';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';

const typescriptEslint = gts.map((config) => config.plugins?.['@typescript-eslint']).find(Boolean);
const presetRules = (configs) => Object.assign({}, ...configs.map((config) => config.rules ?? {}));

const BASE_RESTRICTED_SYNTAX = [
  {
    selector: 'CallExpression[callee.name="String"]',
    message:
      'Avoid String() constructor. Use template literals for coercion, or explicit type guards for errors.',
  },
  {
    selector:
      'CallExpression[callee.object.name=/^(it|test|describe)$/][callee.property.name="only"]',
    message: 'Focused tests must not be committed. Remove .only before merging.',
  },
  {
    selector: 'CallExpression[callee.object.name="document"][callee.property.name=/^write(ln)?$/]',
    message: 'Avoid document.write(). Use iframe.srcdoc or DOM APIs instead.',
  },
  {
    selector:
      'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression)',
    message: 'Export functions as function declarations.',
  },
];

const SOURCE_RESTRICTED_SYNTAX = [
  ...BASE_RESTRICTED_SYNTAX,
  {
    selector:
      ':matches(ImportDeclaration, ExportAllDeclaration, ExportNamedDeclaration)[source.value=/^\\.{1,2}\\/(?!.*\\.(?:js|css)$)/]',
    message: 'Relative imports in src/ include the .js extension (.css for stylesheets).',
  },
];

const BASE_RESTRICTED_IMPORT_PATHS = [
  { name: 'fs', message: 'Use node:fs instead.' },
  { name: 'path', message: 'Use node:path instead.' },
];

// ─── Architecture seams (see AGENTS.md → Key Seams) ─────────────────────────

const RAW_CONFIG_SLOT = '/^(capturedConfig|componentConfig|inferredConfig|pageJsonConfig)$/';
const RAW_CONFIG_MESSAGE =
  'Read checkout configuration through shared/scan-evidence.ts (readCheckoutField(), checkoutConfigSources()); it owns source precedence, the absence rule, and what page JSON may show.';
const RAW_CONFIG_RULES = [
  { selector: `MemberExpression[property.name=${RAW_CONFIG_SLOT}]`, message: RAW_CONFIG_MESSAGE },
  {
    selector: `ObjectPattern > Property[key.name=${RAW_CONFIG_SLOT}]`,
    message: RAW_CONFIG_MESSAGE,
  },
];
const DOCUMENT_HEADERS_RULE = {
  selector: "MemberExpression[property.name='documentHeaders']",
  message:
    'Read response headers through readDocumentHeader() or readPagePolicy() in checks/page-policy.ts; they tell unavailable headers from absent ones.',
};
const PURE_CHECK_MESSAGE = 'Checks are pure: no chrome.* APIs, network, or clock.';
const SCAN_PORT_MESSAGE =
  'The Scan and tab state reach the browser, network, and clock only through their ports.';
const SDK_PRESENCE_MESSAGE =
  'Read ScanResult.sdkPresence instead of inferring SDK presence from the sdk-detected check.';
const TAB_STATE_CLIENT_MESSAGE =
  'The scan lifecycle hook reaches the tab state only through its TabStateClient argument.';

const restrictGlobals = (names, message) => ['error', ...names.map((name) => ({ name, message }))];

export default defineConfig([
  {
    ignores: ['dist/', 'coverage/', '*.cjs'],
  },
  ...gts,
  {
    files: ['eslint.config.js'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
    plugins: {
      'import-x': importX,
      jsdoc,
      react,
      regexp,
      security,
      sonarjs,
      unicorn,
    },
    settings: {
      // Use the modern resolver interface; the legacy auto-detected `node`
      // resolver fails to load under ESLint 10's jiti config loader.
      'import-x/resolver-next': [createNodeResolver()],
      react: { version: '18.3' },
    },
    rules: {
      ...presetRules(typescriptEslint.configs['flat/strict-type-checked']),
      ...presetRules(typescriptEslint.configs['flat/stylistic-type-checked']),
      ...unicorn.configs.recommended.rules,
      ...regexp.configs['flat/recommended'].rules,
      ...sonarjs.configs.recommended.rules,

      // TypeScript safety
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-dynamic-delete': 'error',
      '@typescript-eslint/no-extraneous-class': 'error',
      '@typescript-eslint/no-invalid-void-type': 'error',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-literal-enum-member': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowBoolean: true,
          allowNullish: true,
        },
      ],
      '@typescript-eslint/unified-signatures': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-check': true,
          'ts-expect-error': true,
          'ts-ignore': true,
          'ts-nocheck': true,
        },
      ],
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',

      // Import ordering and cycles
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-cycle': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-mutable-exports': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',

      // Security
      'security/detect-bidi-characters': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-non-literal-require': 'error',
      'security/detect-pseudoRandomBytes': 'error',

      // React
      'react/jsx-boolean-value': 'error',
      'react/jsx-child-element-spacing': 'error',
      'react/jsx-key': 'error',
      'react/jsx-no-comment-textnodes': 'error',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-script-url': 'error',
      'react/jsx-no-target-blank': 'error',
      'react/jsx-no-useless-fragment': 'error',
      'react/no-array-index-key': 'error',
      'react/no-children-prop': 'error',
      'react/no-danger': 'error',
      'react/no-unstable-nested-components': 'error',
      'react/self-closing-comp': 'error',
      'react/void-dom-elements-no-children': 'error',

      // Regexp
      'regexp/prefer-d': 'error',

      // Sonar
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/deprecation': 'error',
      'sonarjs/function-return-type': 'error',
      'sonarjs/no-nested-functions': 'error',
      'sonarjs/no-redundant-assignments': 'error',
      'sonarjs/prefer-regexp-exec': 'error',
      'sonarjs/slow-regex': 'error',

      // Unicorn
      'unicorn/consistent-function-scoping': 'error',
      'unicorn/no-object-as-default-parameter': 'error',
      'unicorn/prefer-top-level-await': 'error',
      'unicorn/empty-brace-spaces': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/import-style': 'off',
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/no-nested-ternary': 'off',
      'unicorn/no-null': 'off',
      'unicorn/no-useless-undefined': 'off',
      'unicorn/number-literal-case': 'off',
      'unicorn/prefer-split-limit': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/template-indent': 'off',

      // JSDoc
      'jsdoc/check-alignment': 'error',
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/check-values': 'error',
      'jsdoc/no-multi-asterisks': 'error',
      'jsdoc/no-types': 'error',
      'jsdoc/require-description': 'error',
      'jsdoc/require-description-complete-sentence': 'error',
      'jsdoc/require-jsdoc': [
        'error',
        {
          enableFixer: false,
          publicOnly: true,
        },
      ],
      'jsdoc/tag-lines': 'error',

      // Core JavaScript
      eqeqeq: 'error',
      'no-console': 'error',
      'no-void': 'error',
      'no-extend-native': 'error',
      'no-nested-ternary': 'error',
      'no-negated-condition': 'error',
      'max-nested-callbacks': ['error', 4],
      'no-restricted-syntax': ['error', ...BASE_RESTRICTED_SYNTAX],
      'no-restricted-imports': ['error', { paths: BASE_RESTRICTED_IMPORT_PATHS }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...SOURCE_RESTRICTED_SYNTAX],
    },
  },
  {
    files: ['src/background/checks/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...SOURCE_RESTRICTED_SYNTAX,
        ...RAW_CONFIG_RULES,
        DOCUMENT_HEADERS_RULE,
      ],
      'no-restricted-globals': restrictGlobals(
        ['chrome', 'fetch', 'setTimeout'],
        PURE_CHECK_MESSAGE
      ),
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: PURE_CHECK_MESSAGE },
        { object: 'globalThis', property: 'chrome', message: PURE_CHECK_MESSAGE },
        { object: 'globalThis', property: 'fetch', message: PURE_CHECK_MESSAGE },
      ],
    },
  },
  {
    files: ['src/background/checks/page-policy.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...SOURCE_RESTRICTED_SYNTAX, ...RAW_CONFIG_RULES],
    },
  },
  {
    files: ['src/shared/implementation-attributes.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...SOURCE_RESTRICTED_SYNTAX, ...RAW_CONFIG_RULES],
    },
  },
  {
    files: ['src/popup/components/useScanLifecycle.ts'],
    rules: {
      'no-restricted-globals': restrictGlobals(['chrome'], TAB_STATE_CLIENT_MESSAGE),
      'no-restricted-properties': [
        'error',
        { object: 'globalThis', property: 'chrome', message: TAB_STATE_CLIENT_MESSAGE },
      ],
    },
  },
  {
    files: ['src/background/checks/**/*.ts'],
    ignores: ['src/background/checks/page-policy.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: BASE_RESTRICTED_IMPORT_PATHS,
          patterns: [
            {
              group: ['**/shared/utils.js', '**/shared/csp-utils.js'],
              importNames: ['parseCsp', 'cspAllowsUrl', 'getEffectiveCspSources'],
              message:
                'Read the Content-Security-Policy through readPagePolicy() in checks/page-policy.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/background/scan-orchestrator.ts',
      'src/background/scan-assessment.ts',
      'src/background/frame-merge.ts',
      'src/background/captured-traffic.ts',
      'src/background/tab-state.ts',
    ],
    rules: {
      'no-restricted-globals': restrictGlobals(
        ['chrome', 'fetch', 'setTimeout'],
        SCAN_PORT_MESSAGE
      ),
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: SCAN_PORT_MESSAGE },
        { object: 'globalThis', property: 'chrome', message: SCAN_PORT_MESSAGE },
        { object: 'globalThis', property: 'fetch', message: SCAN_PORT_MESSAGE },
        { object: 'globalThis', property: 'setTimeout', message: SCAN_PORT_MESSAGE },
      ],
    },
  },
  {
    files: ['src/content/config-interceptor.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      'unicorn/no-this-outside-of-class': 'off',
    },
  },
  {
    files: ['vite.config.ts'],
    rules: {
      'unicorn/no-this-outside-of-class': 'off',
    },
  },
  {
    files: ['src/popup/**/*.{ts,tsx}', 'src/devtools/**/*.{ts,tsx}', 'src/background/worker.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...SOURCE_RESTRICTED_SYNTAX,
        { selector: "Literal[value='sdk-detected']", message: SDK_PRESENCE_MESSAGE },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: BASE_RESTRICTED_IMPORT_PATHS,
          patterns: [
            {
              group: ['**/shared/implementation-attributes.js'],
              message:
                'Read ScanResult.attributes (summarizeImplementation() for display values) instead of re-deriving them.',
            },
            {
              group: ['**/shared/results.js'],
              message:
                'Render issue rows from the finding projection (shared/export-report.ts); it owns grouping and wording.',
            },
            {
              group: ['**/shared/constants.js'],
              importNamePattern: '^STORAGE_',
              message:
                'The tab state owns the storage key scheme; read a tab through MSG_GET_TAB_STATE.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    linterOptions: {
      noInlineConfig: false,
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-check': true,
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
        },
      ],
      '@typescript-eslint/require-await': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      'unicorn/prefer-https': 'off',
    },
  },
  {
    files: ['tests/e2e/**/*.ts'],
    rules: {
      'sonarjs/assertions-in-tests': 'off',
    },
  },
]);
