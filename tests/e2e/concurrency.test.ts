/**
Concurrency — Scans of several tabs run at once, and each result must describe its own tab.
*/

import type { ScanResult } from '../../src/shared/types';
import {
  test,
  expect,
  getStoredScanResult,
  openFixture,
  openPopupFor,
  requireCheck,
} from './fixtures';

const SCAN_TIMEOUT_MS = 20_000;

test('scans two tabs at the same time and keeps each result with its own tab', async ({
  context,
  extensionId,
}) => {
  const sessions = await openFixture(context, 'dummy-merchant.html?scenario=sessions-dropin');
  const advanced = await openFixture(context, 'dummy-merchant.html?scenario=advanced-server-card');
  const popup = await openPopupFor(context, extensionId, sessions);

  const tabIds = await popup.evaluate(
    async (urls) => {
      const tabs = await chrome.tabs.query({});
      return urls.map((url) => tabs.find((tab) => tab.url === url)?.id);
    },
    [sessions.url(), advanced.url()]
  );
  // Both requests are sent before either Scan finishes.
  await popup.evaluate(async (ids) => {
    await Promise.all(
      ids.map((tabId) => chrome.runtime.sendMessage({ type: 'SCAN_REQUEST', tabId }))
    );
  }, tabIds);

  const resultFor = async (page: typeof sessions): Promise<ScanResult> => {
    await expect
      .poll(
        async () => {
          const stored = await getStoredScanResult(context, extensionId, page);
          return stored?.pageUrl;
        },
        { timeout: SCAN_TIMEOUT_MS }
      )
      .toBe(page.url());
    const result = await getStoredScanResult(context, extensionId, page);
    if (result === null) throw new Error(`No stored result for ${page.url()}`);
    return result;
  };
  const [sessionsResult, advancedResult] = await Promise.all([
    resultFor(sessions),
    resultFor(advanced),
  ]);

  expect(sessionsResult.tabId).toBe(tabIds[0]);
  expect(advancedResult.tabId).toBe(tabIds[1]);
  expect(requireCheck(sessionsResult, 'flow-type').title).toContain('Sessions');
  expect(requireCheck(advancedResult, 'flow-type').title).toContain('Advanced');
});
