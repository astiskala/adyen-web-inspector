/**
 * Smoke tests — verify the extension loads and scans an embedded checkout.
 */

import { test, expect, scanFixture } from './fixtures';

test.describe('Extension loading', () => {
  test('service worker starts successfully', async ({ extensionId }) => {
    expect(extensionId).toBeTruthy();
  });

  test('scan detects checkout embedded in a merchant iframe', async ({ context, extensionId }) => {
    const result = await scanFixture(context, extensionId, 'adyen-iframe-merchant.html');

    expect(result.payload.page.isInsideIframe).toBe(true);
    expect(result.checks.find((check) => check.id === 'env-not-iframe')?.severity).toBe('warn');
  });
});
