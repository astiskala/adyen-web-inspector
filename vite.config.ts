import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

const root = import.meta.dirname;

/**
 * Vite plugin that moves HTML outputs from dist/src/… to dist/… so that
 * file paths match what manifest.json expects (e.g. popup/index.html).
 * Also adjusts relative asset references to account for the new depth.
 */
function chromeExtensionHtmlFlatten(): Plugin {
  return {
    name: 'chrome-extension-html-flatten',
    enforce: 'post',
    generateBundle(_options, bundle): void {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (!fileName.startsWith('src/') || !fileName.endsWith('.html')) {
          continue;
        }
        const newPath = fileName.replace(/^src\//, '');

        if (chunk.type === 'asset' && typeof chunk.source === 'string') {
          // Removing one directory level from the path means every
          // relative reference needs one fewer "../" prefix.
          chunk.source = chunk.source.replaceAll(
            /(['"(])((?:\.\.\/)+)/g,
            (_match: string, quote: string, dots: string) => {
              const levels = dots.length / 3;
              return levels > 1 ? quote + '../'.repeat(levels - 1) : quote + './';
            }
          );
        }

        chunk.fileName = newPath;
        // Eslint: avoid dynamic delete by reassigning
        bundle[newPath] = chunk;
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete bundle[fileName];
      }
    },
  };
}

export default defineConfig({
  plugins: [preact(), chromeExtensionHtmlFlatten()],
  base: '',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    rollupOptions: {
      input: {
        worker: resolve(root, 'src/background/worker.ts'),
        detector: resolve(root, 'src/content/detector.ts'),
        'config-interceptor': resolve(root, 'src/content/config-interceptor.ts'),
        'page-extractor': resolve(root, 'src/content/page-extractor.ts'),
        popup: resolve(root, 'src/popup/index.html'),
        devtools: resolve(root, 'src/devtools/devtools.html'),
        panel: resolve(root, 'src/devtools/panel/panel.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  resolve: {
    alias: {
      '~shared': resolve(root, 'src/shared'),
    },
  },
});
