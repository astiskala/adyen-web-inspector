import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Validate that all documentation links referenced in check source files are reachable.
 * Note: These tests require internet access and may be slow.
 */

function collectDocsUrls(): Set<string> {
  const checksDir = resolve(__dirname, '../../../src/background/checks');
  const allUrls = new Set<string>();
  const urlPattern = /docsUrl:\s*['"`](https?:\/\/[^'"`]+)['"`]/g;

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

const urlsToTest = Array.from(collectDocsUrls()).filter(
  (url) =>
    url.includes('docs.adyen.com') ||
    url.includes('owasp.org') ||
    url.includes('github.com') ||
    url.includes('developer.mozilla.org') ||
    url.includes('w3.org')
);

describe('Link Validation', () => {
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
