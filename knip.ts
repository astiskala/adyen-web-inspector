import type { KnipConfig } from 'knip';

export default {
  entry: [
    'src/background/worker.ts!',
    'src/content/config-interceptor.ts!',
    'src/content/detector.ts!',
    'src/content/page-extractor.ts!',
    'src/popup/Popup.tsx!',
    'src/devtools/devtools.ts!',
    'src/devtools/panel/panelEntry.tsx!',
    'src/report/reportEntry.ts!',
  ],
  project: ['src/**/*.{ts,tsx,css}!', 'tests/**/*.{ts,tsx}'],
  compilers: {
    css: (source: string): string =>
      source
        .matchAll(/(?<=^@)import\s+['"][^'"]+['"]/gm)
        .map(([declaration]) => declaration)
        .toArray()
        .join(';\n'),
  },
  include: [
    'files',
    'dependencies',
    'devDependencies',
    'optionalPeerDependencies',
    'unlisted',
    'binaries',
    'unresolved',
    'exports',
    'nsExports',
    'types',
    'nsTypes',
    'duplicates',
    'catalog',
  ],
  includeEntryExports: true,
  treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
