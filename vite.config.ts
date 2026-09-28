import { build, defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const root = import.meta.dirname;
const OUT_DIR = resolve(root, 'dist');

/** Fails the build if a content script would need ESM loading, which Chrome does not provide. */
async function assertClassicScript(file: string): Promise<void> {
  const code = await readFile(file, 'utf8');
  if (/^(?:import|export)\b/m.test(code)) {
    throw new Error(
      `${relative(root, file)} must be a self-contained classic script, but it contains ESM import/export statements.`
    );
  }
}

/** Scripts Chrome runs as classic scripts: manifest content scripts and executeScript files. */
const CONTENT_SCRIPTS = {
  'config-interceptor': 'src/content/config-interceptor.ts',
  detector: 'src/content/detector.ts',
  'page-extractor': 'src/content/page-extractor.ts',
} as const;

/**
 * Builds each content script as its own self-contained IIFE after the main
 * build. A multi-entry build would move shared modules into chunks and emit
 * ESM imports, which classic scripts cannot load. The IIFE scope also keeps
 * repeated executeScript injections free of redeclared top-level bindings.
 */
function buildContentScripts(): Plugin {
  return {
    name: 'build-content-scripts',
    apply: 'build',
    async buildStart(): Promise<void> {
      for (const directory of ['src/content', 'src/shared']) {
        const entries = await readdir(resolve(root, directory));
        for (const entry of entries.filter((name) => name.endsWith('.ts'))) {
          this.addWatchFile(resolve(root, directory, entry));
        }
      }
    },
    async closeBundle(): Promise<void> {
      for (const [name, entry] of Object.entries(CONTENT_SCRIPTS)) {
        await build({
          configFile: false,
          logLevel: 'warn',
          build: {
            outDir: OUT_DIR,
            emptyOutDir: false,
            copyPublicDir: false,
            sourcemap: false,
            minify: false,
            modulePreload: false,
            rollupOptions: {
              input: resolve(root, entry),
              output: { format: 'iife', entryFileNames: `${name}.js` },
            },
          },
        });
        await assertClassicScript(resolve(OUT_DIR, `${name}.js`));
      }
    },
  };
}

/**
 * Moves HTML outputs from dist/src/… to dist/… to match manifest paths such as
 * popup/index.html, and adjusts relative asset references for the new depth.
 */
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
  plugins: [preact(), buildContentScripts(), chromeExtensionHtmlFlatten()],
  base: '',
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    rollupOptions: {
      input: {
        worker: resolve(root, 'src/background/worker.ts'),
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
});
