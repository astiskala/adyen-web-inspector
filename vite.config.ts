import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const root = import.meta.dirname;

/**
 * Vite plugin that moves HTML outputs from dist/src/… to dist/… so that
 * file paths match what manifest.json expects (e.g. popup/index.html).
 * Also adjusts relative asset references to account for the new depth.
 */
/**
 * Wraps MAIN-world scripts in a block scope so that re-injection via
 * chrome.scripting.executeScript doesn't cause "Identifier already declared"
 * errors from top-level const/let declarations.
 *
 * Uses a bare block `{ … }` rather than an IIFE because executeScript
 * captures the script's *completion value*. A block preserves that (the
 * value of the last expression statement), whereas an IIFE without an
 * explicit `return` would yield `undefined`.
 */
function wrapMainWorldScriptsInBlock(): Plugin {
  const targetFiles = new Set(['page-extractor.js']);
  return {
    name: 'wrap-main-world-block-scope',
    enforce: 'post',
    generateBundle(_options, bundle): void {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (!targetFiles.has(fileName)) continue;
        if (chunk.type === 'chunk' && typeof chunk.code === 'string') {
          chunk.code = `{\n${chunk.code}\n}\n`;
        }
      }
    },
  };
}

function chromeExtensionHtmlFlatten(): Plugin {
  return {
    name: 'chrome-extension-html-flatten',
    enforce: 'post',
    async writeBundle(options): Promise<void> {
      const outputDirectory = options.dir;
      if (outputDirectory === undefined) {
        return;
      }

      const htmlRoot = resolve(outputDirectory, 'src');
      const htmlFiles = await collectHtmlFiles(htmlRoot);

      for (const htmlFile of htmlFiles) {
        const relativePath = relative(htmlRoot, htmlFile);
        const targetPath = resolve(outputDirectory, relativePath);
        const htmlSource = await readFile(htmlFile, 'utf8');

        // Removing one directory level from the path means every relative
        // reference needs one fewer "../" prefix.
        const flattenedHtml = htmlSource.replaceAll(
          /(['"(])((?:\.\.\/)+)/g,
          (_match: string, quote: string, dots: string) => {
            const levels = dots.length / 3;
            return levels > 1 ? quote + '../'.repeat(levels - 1) : quote + './';
          }
        );

        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, flattenedHtml);
        await rm(htmlFile);
      }

      await rm(htmlRoot, { recursive: true, force: true });
    },
  };
}

async function collectHtmlFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = resolve(directory, entry.name);

        if (entry.isDirectory()) {
          return collectHtmlFiles(entryPath);
        }

        return entry.isFile() && entry.name.endsWith('.html') ? [entryPath] : [];
      })
    );

    return files.flat();
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

export default defineConfig({
  plugins: [preact(), wrapMainWorldScriptsInBlock(), chromeExtensionHtmlFlatten()],
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
        report: resolve(root, 'src/report/report.html'),
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
