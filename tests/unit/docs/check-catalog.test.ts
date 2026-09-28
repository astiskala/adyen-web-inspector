import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_CHECKS } from '../../../src/background/checks/index';
import type { Severity } from '../../../src/shared/types';
import { makeAdyenPayload, makePageExtract, makeScanPayload } from '../../fixtures/makeScanPayload';

interface CatalogEntry {
  readonly category: string;
  readonly id: string;
  readonly goal: string;
  readonly possibleSeverities: readonly string[];
}

const CATALOG_PATH = resolve(process.cwd(), 'docs/architecture/check-catalog.md');

function byText(a: string, b: string): number {
  return a.localeCompare(b);
}

function parseCatalogEntries(markdown: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const rowPattern = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|([^|]+)\|([^|]+)\|/gm;

  let match = rowPattern.exec(markdown);
  while (match !== null) {
    const category = match[1];
    const id = match[2];
    const goal = match[3];
    const severities = match[4];
    if (
      category !== undefined &&
      id !== undefined &&
      goal !== undefined &&
      severities !== undefined
    ) {
      entries.push({
        category,
        id,
        goal: goal.trim(),
        possibleSeverities: severities.split(',').map((item) => item.trim().replaceAll('`', '')),
      });
    }
    match = rowPattern.exec(markdown);
  }

  return entries;
}

function listIds(section: string): string[] {
  return [...section.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1] ?? '');
}

describe('check catalog documentation', () => {
  it('keeps category and total counts aligned with the registry', () => {
    const markdown = readFileSync(CATALOG_PATH, 'utf8');
    const totals = markdown.split('## Totals\n')[1]?.split('\n## ')[0] ?? '';
    const categoryCounts = new Map(
      [...totals.matchAll(/^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|/gm)].map((match) => [
        match[1] ?? '',
        Number(match[2]),
      ])
    );
    const categories = [...new Set(ALL_CHECKS.map((check) => check.category))];

    expect([...categoryCounts.keys()].toSorted(byText)).toEqual(categories.toSorted(byText));
    for (const category of categories) {
      expect(categoryCounts.get(category)).toBe(
        ALL_CHECKS.filter((check) => check.category === category).length
      );
    }
    expect(Number(/\|\s*\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*/.exec(totals)?.[1])).toBe(
      ALL_CHECKS.length
    );
  });

  it('provides a goal and valid, unique severities for every check', () => {
    const entries = parseCatalogEntries(readFileSync(CATALOG_PATH, 'utf8'));
    const severities: readonly Severity[] = ['pass', 'warn', 'fail', 'notice', 'info', 'skip'];

    for (const entry of entries) {
      expect(entry.goal.length, entry.id).toBeGreaterThan(0);
      expect(entry.possibleSeverities.length, entry.id).toBeGreaterThan(0);
      expect(new Set(entry.possibleSeverities).size, entry.id).toBe(
        entry.possibleSeverities.length
      );
      for (const severity of entry.possibleSeverities) {
        expect(severities, entry.id).toContain(severity);
      }
    }
  });

  it('partitions notice-producing checks into low-impact or manual-review lists', () => {
    const markdown = readFileSync(CATALOG_PATH, 'utf8');
    const entries = parseCatalogEntries(markdown);
    const lowSection =
      markdown
        .split('Current low-impact notice checks:\n')[1]
        ?.split('Current manual-review notice checks:')[0] ?? '';
    const manualSection =
      markdown.split('Current manual-review notice checks:\n')[1]?.split('## Check Index')[0] ?? '';
    const listed = [...listIds(lowSection), ...listIds(manualSection)];
    const noticeIds = entries
      .filter((entry) => entry.possibleSeverities.includes('notice'))
      .map((entry) => entry.id);

    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.toSorted(byText)).toEqual(noticeIds.toSorted(byText));

    const lowIds = new Set(listIds(lowSection));
    for (const payload of [makeScanPayload(), makeAdyenPayload()]) {
      for (const check of ALL_CHECKS) {
        const outcome = check.run(payload);
        if (outcome.severity === 'notice') {
          expect(lowIds.has(check.id), check.id).toBe(outcome.impact === 'low');
        }
      }
    }
  });

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
