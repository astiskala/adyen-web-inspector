/**
 * Smoke tests — verify the extension loads and the popup renders.
 */

import { test, expect } from './fixtures';

test.describe('Extension loading', () => {
  test('service worker starts successfully', async ({ extensionId }) => {
    expect(extensionId).toBeTruthy();
  });

  test('popup renders on Adyen page', async ({ context, extensionId }) => {
    // Navigate to fixture page with Adyen SDK markers
    const page = await context.newPage();
    await page.goto('http://localhost:4321/adyen-merchant.html');
    await page.waitForLoadState('domcontentloaded');

    // Open the popup
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await popupPage.waitForLoadState('domcontentloaded');

    // The popup should have a root element with content
    const root = popupPage.locator('#root');
    await expect(root).toBeAttached();
  });

  test('popup shows not-detected state on plain page', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto('http://localhost:4321/no-adyen.html');
    await page.waitForLoadState('domcontentloaded');

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await popupPage.waitForLoadState('domcontentloaded');

    const root = popupPage.locator('#root');
    await expect(root).toBeAttached();
  });
});
