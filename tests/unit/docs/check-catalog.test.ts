import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_CHECKS } from '../../../src/background/checks/index';
import { makeAdyenPayload, makePageExtract, makeScanPayload } from '../../fixtures/makeScanPayload';

interface CatalogEntry {
  readonly category: string;
  readonly id: string;
  readonly possibleSeverities: readonly string[];
}

const CATALOG_PATH = resolve(process.cwd(), 'docs/architecture/check-catalog.md');

function parseCatalogEntries(markdown: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const rowPattern = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|[^|]*\|\s*([^|]+)\|/gm;

  let match = rowPattern.exec(markdown);
  while (match !== null) {
    const category = match[1];
    const id = match[2];
    const severities = match[3];
    if (category !== undefined && id !== undefined && severities !== undefined) {
      entries.push({
        category,
        id,
        possibleSeverities: severities.split(',').map((item) => item.trim().replaceAll('`', '')),
      });
    }
    match = rowPattern.exec(markdown);
  }

  return entries;
}

describe('check catalog documentation', () => {
  it('documents every registered check exactly once with the correct category', () => {
    const markdown = readFileSync(CATALOG_PATH, 'utf8');
    const entries = parseCatalogEntries(markdown);

    const documentedById = new Map<string, string>();
    const duplicateIds: string[] = [];

    for (const entry of entries) {
      if (documentedById.has(entry.id)) {
        duplicateIds.push(entry.id);
        continue;
      }
      documentedById.set(entry.id, entry.category);
    }

    expect(duplicateIds).toEqual([]);
    expect(documentedById.size).toBe(ALL_CHECKS.length);

    for (const check of ALL_CHECKS) {
      expect(documentedById.get(check.id)).toBe(check.category);
    }

    const runtimeIds = new Set<string>(ALL_CHECKS.map((check) => check.id));
    const extraDocumentedIds = [...documentedById.keys()].filter((id) => !runtimeIds.has(id));
    expect(extraDocumentedIds).toEqual([]);
  });

  it('lists severities produced by representative scan evidence', () => {
    const markdown = readFileSync(CATALOG_PATH, 'utf8');
    const entries = new Map(parseCatalogEntries(markdown).map((entry) => [entry.id, entry]));
    const payloads = [
      makeScanPayload(),
      makeAdyenPayload(),
      makeScanPayload({
        page: makePageExtract({ inferredConfig: { countryCode: 'NL', locale: 'nl-NL' } }),
        mainDocumentHeadersAvailable: false,
      }),
    ];

    for (const payload of payloads) {
      for (const check of ALL_CHECKS) {
        expect(entries.get(check.id)?.possibleSeverities).toContain(check.run(payload).severity);
      }
    }
  });
});
