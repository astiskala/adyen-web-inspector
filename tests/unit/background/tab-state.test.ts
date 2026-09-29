import { beforeEach, describe, expect, it } from 'vitest';
import { createTabState } from '../../../src/background/tab-state';
import { STATUS_COLORS } from '../../../src/shared/constants';
import type { ScanResult } from '../../../src/shared/types';
import { makeScanResult } from '../../fixtures/makeScanPayload';
import {
  createFakeTabStateBrowser,
  type FakeTabStateBrowser,
} from '../../fixtures/fakeTabStateBrowser';

const TAB = 7;

interface PendingScan {
  resolve(result: ScanResult): void;
  reject(error: Error): void;
}

let browser: FakeTabStateBrowser;
let pending: PendingScan[];
let tabState: ReturnType<typeof createTabState>;

function scoredResult(score: number, tier: ScanResult['health']['tier']): ScanResult {
  return makeScanResult({
    tabId: TAB,
    health: { score, passing: 1, failing: 0, warnings: 0, total: 1, tier },
  });
}

function messageTypes(): string[] {
  return browser.messages.map((message) => message.type);
}

/** Lets queued transitions and the settled Scan finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

beforeEach(() => {
  browser = createFakeTabStateBrowser();
  pending = [];
  tabState = createTabState(
    browser,
    () =>
      new Promise<ScanResult>((resolve, reject) => {
        pending.push({ resolve, reject });
      })
  );
});

describe('tab state checkout activity', () => {
  it('records detector activity and version, and shows the activity badge', async () => {
    await tabState.checkoutActivityDetected(TAB, '6.31.0');

    await expect(tabState.read(TAB)).resolves.toEqual({
      result: null,
      checkoutActivity: { detected: true, version: '6.31.0' },
    });
    expect(browser.badges.get(TAB)).toEqual({ text: '✓', color: STATUS_COLORS.pass });

    await tabState.checkoutActivityDetected(8);
    await expect(tabState.read(8)).resolves.toMatchObject({
      checkoutActivity: { detected: true },
    });
  });

  it('clears activity and its badge when the detector no longer sees checkout', async () => {
    await tabState.checkoutActivityDetected(TAB, '6.31.0');
    await tabState.checkoutActivityCleared(TAB);

    await expect(tabState.read(TAB)).resolves.toEqual({
      result: null,
      checkoutActivity: { detected: false },
    });
    expect(browser.badges.has(TAB)).toBe(false);
  });
});

describe('tab state Scan lifecycle', () => {
  it('shows progress, then stores the result and shows its health score', async () => {
    const scan = tabState.requestScan(TAB);
    await settle();
    expect(browser.badges.get(TAB)?.text).toBe('…');
    expect(messageTypes()).toEqual(['SCAN_STARTED']);

    const result = scoredResult(82, 'issues');
    pending[0]?.resolve(result);
    await scan;

    expect(messageTypes()).toEqual(['SCAN_STARTED', 'SCAN_COMPLETE']);
    await expect(tabState.read(TAB)).resolves.toMatchObject({ result });
    expect(browser.badges.get(TAB)).toEqual({ text: '82', color: STATUS_COLORS.warn });
  });

  it.each([
    ['excellent', STATUS_COLORS.pass],
    ['critical', STATUS_COLORS.fail],
  ] as const)('colours a %s health badge', async (tier, color) => {
    const scan = tabState.requestScan(TAB);
    await settle();
    pending[0]?.resolve(scoredResult(50, tier));
    await scan;

    expect(browser.badges.get(TAB)?.color).toBe(color);
  });

  it('clears the badge when the Scan finds no SDK, even with checkout activity', async () => {
    await tabState.checkoutActivityDetected(TAB);
    const scan = tabState.requestScan(TAB);
    await settle();
    pending[0]?.resolve(
      makeScanResult({ tabId: TAB, sdkPresence: { detected: false, source: 'none' } })
    );
    await scan;

    expect(browser.badges.has(TAB)).toBe(false);
  });

  it('ignores a second request while a Scan of the page is running', async () => {
    const first = tabState.requestScan(TAB);
    await settle();
    await tabState.requestScan(TAB);

    expect(pending).toHaveLength(1);
    expect(messageTypes()).toEqual(['SCAN_STARTED']);
    pending[0]?.resolve(scoredResult(90, 'excellent'));
    await first;
  });

  it('keeps the progress and score badges when the detector reports activity', async () => {
    const scan = tabState.requestScan(TAB);
    await settle();
    await tabState.checkoutActivityDetected(TAB);
    expect(browser.badges.get(TAB)?.text).toBe('…');

    pending[0]?.resolve(scoredResult(70, 'issues'));
    await scan;
    await tabState.checkoutActivityDetected(TAB, '6.31.0');
    expect(browser.badges.get(TAB)?.text).toBe('70');
  });

  it('reports a failed Scan and falls back to the activity badge', async () => {
    await tabState.checkoutActivityDetected(TAB);
    const scan = tabState.requestScan(TAB);
    await settle();
    pending[0]?.reject(new Error('Tab 7 did not finish loading'));
    await scan;

    expect(browser.messages.at(-1)).toEqual({
      type: 'SCAN_ERROR',
      tabId: TAB,
      error: 'Tab 7 did not finish loading',
    });
    expect(browser.badges.get(TAB)?.text).toBe('✓');

    const retry = tabState.requestScan(TAB);
    await settle();
    expect(pending).toHaveLength(2);
    pending[1]?.resolve(scoredResult(90, 'excellent'));
    await retry;
  });

  it('reports a Scan whose result cannot be stored as failed', async () => {
    const scan = tabState.requestScan(TAB);
    await settle();
    browser.failWrites = true;
    pending[0]?.resolve(scoredResult(90, 'excellent'));
    await scan;

    expect(browser.messages.at(-1)).toMatchObject({
      type: 'SCAN_ERROR',
      error: 'Storage quota exceeded',
    });
    await expect(tabState.read(TAB)).resolves.toMatchObject({ result: null });
  });
});

describe('tab state navigation', () => {
  it('clears stored state and the badge, and resets open views', async () => {
    await tabState.checkoutActivityDetected(TAB, '6.31.0');
    const scan = tabState.requestScan(TAB);
    await settle();
    pending[0]?.resolve(scoredResult(90, 'excellent'));
    await scan;

    await tabState.navigated(TAB);

    expect(browser.storage.size).toBe(0);
    expect(browser.badges.has(TAB)).toBe(false);
    expect(browser.messages.at(-1)).toEqual({ type: 'SCAN_RESET', tabId: TAB });
  });

  it('discards a Scan that finishes after the tab navigated', async () => {
    const stale = tabState.requestScan(TAB);
    await settle();
    await tabState.navigated(TAB);
    await tabState.checkoutActivityDetected(TAB);

    pending[0]?.resolve(scoredResult(40, 'critical'));
    await stale;

    expect(messageTypes()).toEqual(['SCAN_STARTED', 'SCAN_RESET']);
    await expect(tabState.read(TAB)).resolves.toEqual({
      result: null,
      checkoutActivity: { detected: true },
    });
    expect(browser.badges.get(TAB)?.text).toBe('✓');
  });

  it('lets the new page be scanned while a stale Scan is still running', async () => {
    const stale = tabState.requestScan(TAB);
    await settle();
    await tabState.navigated(TAB);
    const current = tabState.requestScan(TAB);
    await settle();
    expect(pending).toHaveLength(2);

    const fresh = scoredResult(95, 'excellent');
    pending[1]?.resolve(fresh);
    await current;
    pending[0]?.reject(new Error('Frame was removed'));
    await stale;

    expect(messageTypes()).toEqual(['SCAN_STARTED', 'SCAN_RESET', 'SCAN_STARTED', 'SCAN_COMPLETE']);
    await expect(tabState.read(TAB)).resolves.toMatchObject({ result: fresh });
    expect(browser.badges.get(TAB)?.text).toBe('95');
  });

  it('forgets a closed tab without storing its pending Scan', async () => {
    await tabState.checkoutActivityDetected(TAB);
    const scan = tabState.requestScan(TAB);
    await settle();
    await tabState.removed(TAB);

    pending[0]?.resolve(scoredResult(90, 'excellent'));
    await scan;

    expect(browser.storage.size).toBe(0);
    expect(messageTypes()).toEqual(['SCAN_STARTED']);
  });

  it('still resets open views when clearing storage fails', async () => {
    const failing = {
      ...browser,
      remove: async (): Promise<void> => {
        throw new Error('x');
      },
    };
    const state = createTabState(failing, async () => scoredResult(1, 'critical'));

    await expect(state.navigated(TAB)).rejects.toThrow('x');
    expect(browser.messages.at(-1)).toEqual({ type: 'SCAN_RESET', tabId: TAB });
  });
});
