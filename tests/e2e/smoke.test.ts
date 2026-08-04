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

  test('scan detects checkout embedded in a merchant iframe', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto('http://localhost:4321/adyen-iframe-merchant.html');
    await page.waitForLoadState('load');

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`);

    let tabId: number | undefined;
    await expect
      .poll(async () => {
        tabId = await popupPage.evaluate(async () => {
          const tabs = await chrome.tabs.query({});
          return tabs.find((tab) => tab.url?.endsWith('/adyen-iframe-merchant.html') === true)?.id;
        });
        return tabId;
      })
      .not.toBeUndefined();
    if (tabId === undefined) {
      throw new Error('Embedded checkout fixture tab not found.');
    }

    const outcome = await popupPage.evaluate((targetTabId) => {
      return new Promise<{
        type: string;
        error?: string;
        result?: { checks?: { id: string; severity: string }[] };
      }>((resolve) => {
        const listener = (message: {
          type?: string;
          tabId?: number;
          error?: string;
          result?: { checks?: { id: string; severity: string }[] };
        }): void => {
          if (
            message.tabId === targetTabId &&
            (message.type === 'SCAN_COMPLETE' || message.type === 'SCAN_ERROR')
          ) {
            chrome.runtime.onMessage.removeListener(listener);
            resolve({
              type: message.type,
              ...(message.error === undefined ? {} : { error: message.error }),
              ...(message.result === undefined ? {} : { result: message.result }),
            });
          }
        };

        chrome.runtime.onMessage.addListener(listener);
        chrome.runtime
          .sendMessage({
            type: 'SCAN_REQUEST',
            tabId: targetTabId,
            source: 'popup',
          })
          .catch((error: unknown) => {
            chrome.runtime.onMessage.removeListener(listener);
            let errorMessage = 'Unknown runtime messaging error.';
            if (error instanceof Error) {
              errorMessage = error.message;
            } else if (typeof error === 'string') {
              errorMessage = error;
            }
            resolve({ type: 'SEND_ERROR', error: errorMessage });
          });
      });
    }, tabId);

    const frameDiagnostics = await Promise.all(
      page.frames().map(async (frame) => {
        return frame.evaluate(() => {
          const extractionGlobal = globalThis as typeof globalThis & {
            __adyenWebInspectorPageExtractResultJson?: string;
          };
          return {
            url: globalThis.location.href,
            resultLength: extractionGlobal.__adyenWebInspectorPageExtractResultJson?.length ?? 0,
          };
        });
      })
    );

    expect(outcome.type, `${outcome.error ?? ''} ${JSON.stringify(frameDiagnostics)}`).toBe(
      'SCAN_COMPLETE'
    );
    expect(outcome.result?.checks?.find((check) => check.id === 'env-not-iframe')?.severity).toBe(
      'warn'
    );
  });
});
