import { defineConfig } from 'eslint/config';
import gts from 'gts';
import importX from 'eslint-plugin-import-x';
import jsdoc from 'eslint-plugin-jsdoc';
import react from 'eslint-plugin-react';
import regexp from 'eslint-plugin-regexp';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';

export default defineConfig([
  { ignores: ['dist/', 'coverage/', '*.cjs', 'vitest.integration.config.ts'] },
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
    rules: {
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

      // Import ordering and cycles
      'import-x/no-cycle': 'error',
      'import-x/no-duplicates': 'error',

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
      'react/jsx-child-element-spacing': 'error',

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

      // JSDoc
      'jsdoc/check-alignment': 'error',
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/check-values': 'error',
      'jsdoc/no-multi-asterisks': 'error',
      'jsdoc/no-types': 'error',
      'jsdoc/require-description': 'error',
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
      'no-extend-native': 'error',
      'no-nested-ternary': 'error',
      'no-negated-condition': 'error',
      'max-nested-callbacks': ['error', 4],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="String"]',
          message:
            'Avoid String() constructor. Use template literals for coercion, or explicit type guards for errors.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'fs', message: 'Use node:fs instead.' },
            { name: 'path', message: 'Use node:path instead.' },
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
    },
  },
]);
