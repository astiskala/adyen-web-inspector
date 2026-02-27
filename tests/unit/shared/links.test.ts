import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Validate that all documentation links referenced in check source files are reachable.
 *
 * These tests make live HTTP requests and are skipped by default.
 * Run with: RUN_LINK_CHECKS=1 pnpm test
 */

function collectDocsUrls(): Set<string> {
  const checksDir = resolve(__dirname, '../../../src/background/checks');
  const allUrls = new Set<string>();
  // Match URLs in docsUrl properties and string constant assignments.
  const urlPattern = /['"`](https?:\/\/[^'"`\s]+)['"`]/g;

  for (const file of readdirSync(checksDir)) {
    if (!file.endsWith('.ts')) continue;
    const content = readFileSync(resolve(checksDir, file), 'utf-8');
    for (const match of content.matchAll(urlPattern)) {
      const url = match[1];
      if (url !== undefined && url !== '') {
        allUrls.add(url);
      }
    }
  }

  return allUrls;
}

const allowedDocHosts = [
  'docs.adyen.com',
  'owasp.org',
  'github.com',
  'developer.mozilla.org',
  'w3.org',
];

function isAllowedHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return allowedDocHosts.some((allowedHost) => {
      return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);
    });
  } catch {
    // Ignore invalid URLs
    return false;
  }
}

const urlsToTest = Array.from(collectDocsUrls()).filter((url) => isAllowedHost(url));

describe.skipIf(process.env['RUN_LINK_CHECKS'] === undefined)('Link Validation', () => {
  describe('Referenced Documentation Links', () => {
    urlsToTest.forEach((url) => {
      it.concurrent(
        `should be reachable: ${url}`,
        async () => {
          const response = await fetch(url, { method: 'HEAD' });
          // Some sites might return 405 for HEAD, so we retry with GET if needed
          if (response.status === 405) {
            const getResponse = await fetch(url, { method: 'GET' });
            expect(getResponse.status).toBeLessThan(400);
          } else {
            expect(response.status).toBeLessThan(400);
          }
        },
        10000
      );
    });
  });
});
