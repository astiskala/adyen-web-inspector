import { beforeEach, describe, expect, it } from 'vitest';
import { createTabState } from '../../../src/background/tab-state';
import { STATUS_COLORS } from '../../../src/shared/constants';
import type { TabSnapshot } from '../../../src/shared/messages';
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

/** Scan states of the snapshots published so far, in order. */
function publishedScans(): string[] {
  return browser.messages.map((message) => message.snapshot.scan.state);
}

function lastPublished(): TabSnapshot | undefined {
  return browser.messages.at(-1)?.snapshot;
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
  it('records detector activity and version, publishes it, and shows the activity badge', async () => {
    await tabState.checkoutActivityDetected(TAB, '6.31.0');

    const expected: TabSnapshot = {
      result: null,
      checkoutActivity: { detected: true, version: '6.31.0' },
      scan: { state: 'idle' },
    };
    await expect(tabState.read(TAB)).resolves.toEqual(expected);
    expect(browser.messages).toEqual([
      { type: 'TAB_STATE_CHANGED', tabId: TAB, snapshot: expected },
    ]);
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
      scan: { state: 'idle' },
    });
    expect(lastPublished()?.checkoutActivity).toEqual({ detected: false });
    expect(browser.badges.has(TAB)).toBe(false);
  });
});

describe('tab state Scan lifecycle', () => {
  it('publishes the running Scan, then stores the result and shows its health score', async () => {
    const scan = tabState.requestScan(TAB);
    await settle();
    expect(browser.badges.get(TAB)?.text).toBe('…');
    expect(publishedScans()).toEqual(['running']);
    await expect(tabState.read(TAB)).resolves.toMatchObject({ scan: { state: 'running' } });

    const result = scoredResult(82, 'issues');
    pending[0]?.resolve(result);
    await scan;

    expect(publishedScans()).toEqual(['running', 'idle']);
    expect(lastPublished()?.result).toEqual(result);
    await expect(tabState.read(TAB)).resolves.toMatchObject({ result, scan: { state: 'idle' } });
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
    expect(publishedScans()).toEqual(['running']);
    pending[0]?.resolve(scoredResult(90, 'excellent'));
    await first;
  });

  it('keeps the running Scan in activity snapshots and badges', async () => {
    const scan = tabState.requestScan(TAB);
    await settle();
    await tabState.checkoutActivityDetected(TAB);
    expect(browser.badges.get(TAB)?.text).toBe('…');
    expect(lastPublished()).toMatchObject({
      checkoutActivity: { detected: true },
      scan: { state: 'running' },
    });

    pending[0]?.resolve(scoredResult(70, 'issues'));
    await scan;
    await tabState.checkoutActivityDetected(TAB, '6.31.0');
    expect(browser.badges.get(TAB)?.text).toBe('70');
  });

  it('publishes a failed Scan until the next one starts, and falls back to the activity badge', async () => {
    await tabState.checkoutActivityDetected(TAB);
    const scan = tabState.requestScan(TAB);
    await settle();
    pending[0]?.reject(new Error('Tab 7 did not finish loading'));
    await scan;

    const failed = { state: 'failed', error: 'Tab 7 did not finish loading' };
    expect(lastPublished()?.scan).toEqual(failed);
    await expect(tabState.read(TAB)).resolves.toMatchObject({ scan: failed });
    expect(browser.badges.get(TAB)?.text).toBe('✓');

    const retry = tabState.requestScan(TAB);
    await settle();
    expect(pending).toHaveLength(2);
    expect(lastPublished()?.scan).toEqual({ state: 'running' });
    pending[1]?.resolve(scoredResult(90, 'excellent'));
    await retry;
  });

  it('reports a Scan whose result cannot be stored as failed', async () => {
    const scan = tabState.requestScan(TAB);
    await settle();
    browser.failWrites = true;
    pending[0]?.resolve(scoredResult(90, 'excellent'));
    await scan;

    expect(lastPublished()?.scan).toEqual({ state: 'failed', error: 'Storage quota exceeded' });
    await expect(tabState.read(TAB)).resolves.toMatchObject({ result: null });
  });

  it('still starts the Scan when storage cannot be read to publish it', async () => {
    browser.failReads = true;
    const scan = tabState.requestScan(TAB);
    await settle();

    expect(pending).toHaveLength(1);
    expect(browser.messages).toHaveLength(0);
    browser.failReads = false;
    pending[0]?.resolve(scoredResult(90, 'excellent'));
    await scan;
    expect(publishedScans()).toEqual(['idle']);
  });
});

describe('tab state navigation', () => {
  it('clears stored state and the badge, and publishes an empty snapshot', async () => {
    await tabState.checkoutActivityDetected(TAB, '6.31.0');
    const scan = tabState.requestScan(TAB);
    await settle();
    pending[0]?.resolve(scoredResult(90, 'excellent'));
    await scan;

    await tabState.navigated(TAB);

    expect(browser.storage.size).toBe(0);
    expect(browser.badges.has(TAB)).toBe(false);
    expect(lastPublished()).toEqual({
      result: null,
      checkoutActivity: { detected: false },
      scan: { state: 'idle' },
    });
  });

  it('discards a Scan that finishes after the tab navigated', async () => {
    const stale = tabState.requestScan(TAB);
    await settle();
    await tabState.navigated(TAB);
    await tabState.checkoutActivityDetected(TAB);

    pending[0]?.resolve(scoredResult(40, 'critical'));
    await stale;

    expect(publishedScans()).toEqual(['running', 'idle', 'idle']);
    await expect(tabState.read(TAB)).resolves.toEqual({
      result: null,
      checkoutActivity: { detected: true },
      scan: { state: 'idle' },
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

    expect(publishedScans()).toEqual(['running', 'idle', 'running', 'idle']);
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
    expect(publishedScans()).toEqual(['idle', 'running']);
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
    expect(lastPublished()).toEqual({
      result: null,
      checkoutActivity: { detected: false },
      scan: { state: 'idle' },
    });
  });
});
