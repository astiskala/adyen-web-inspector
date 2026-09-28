import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateHealthScore } from '../../../src/shared/health';
import type { CheckResult } from '../../../src/shared/types';

const ROOT = process.cwd();
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
]);

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
      return markdownFiles(path);
    }
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  });
}

const documents = markdownFiles(ROOT);

describe('repository documentation', () => {
  it('resolves local Markdown links relative to their source files', () => {
    const missing: string[] = [];

    for (const document of documents) {
      const markdown = readFileSync(document, 'utf8');
      for (const match of markdown.matchAll(/\]\(([^)\s]+)(?:\s[^)]*)?\)/g)) {
        const destination = match[1];
        if (
          destination === undefined ||
          destination.startsWith('#') ||
          destination.startsWith('//') ||
          /^[a-z][a-z\d+.-]*:/i.test(destination)
        ) {
          continue;
        }

        const path = destination.split(/[?#]/, 1)[0];
        if (
          path !== undefined &&
          !existsSync(resolve(dirname(document), decodeURIComponent(path)))
        ) {
          missing.push(`${relative(ROOT, document)}: ${destination}`);
        }
      }
    }

    expect(documents.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it('only documents pnpm commands that the project defines', () => {
    const { scripts } = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const builtins = new Set(['install', 'exec', 'run']);
    const unknown: string[] = [];

    for (const document of documents) {
      const markdown = readFileSync(document, 'utf8');
      for (const match of markdown.matchAll(/(?:`pnpm[ \t]+|^[ \t]*pnpm[ \t]+)([a-z][\w:-]*)/gm)) {
        const command = match[1];
        if (command !== undefined && !builtins.has(command) && !(command in scripts)) {
          unknown.push(`${relative(ROOT, document)}: pnpm ${command}`);
        }
      }
    }

    expect(unknown).toEqual([]);
  });

  it('keeps manifest, Sonar and package versions in sync', () => {
    const { version: packageVersion } = JSON.parse(
      readFileSync(resolve(ROOT, 'package.json'), 'utf8')
    ) as { version: string };
    const { version: manifestVersion } = JSON.parse(
      readFileSync(resolve(ROOT, 'public/manifest.json'), 'utf8')
    ) as { version: string };
    const sonarVersion = /^sonar\.projectVersion=(.+)$/m.exec(
      readFileSync(resolve(ROOT, 'sonar-project.properties'), 'utf8')
    )?.[1];

    expect(manifestVersion).toBe(packageVersion);
    expect(sonarVersion).toBe(packageVersion);
  });

  it('lists the health tiers actually produced by the scoring logic', () => {
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    const tierText = /health score with tiering \(([^)]+)\)/.exec(readme)?.[1] ?? '';
    const documented = [...tierText.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const actual = (['pass', 'warn', 'fail'] as const).map((severity) => {
      const check: CheckResult = {
        id: 'sdk-detected',
        category: 'sdk-identity',
        severity,
        title: 'Example',
      };
      return calculateHealthScore([check]).tier;
    });

    expect(documented).toEqual(actual);
  });
});
