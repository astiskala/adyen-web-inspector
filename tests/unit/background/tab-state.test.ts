import { beforeEach, describe, expect, it } from 'vitest';
import { createTabState } from '../../../src/background/tab-state';
import { STATUS_COLORS } from '../../../src/shared/constants';
import type { TabSnapshot } from '../../../src/shared/messages';
import type { ScanResult } from '../../../src/shared/types';
import { makeScanPayload, makeScanResult } from '../../fixtures/makeScanPayload';
import {
  createFakeTabStateBrowser,
  type FakeTabStateBrowser,
} from '../../fixtures/fakeTabStateBrowser';

const TAB = 7;

interface PendingScan {
  resolve: (result: ScanResult) => void;
  reject: (error: Error) => void;
}

const harness = {} as {
  browser: FakeTabStateBrowser;
  pending: PendingScan[];
  tabState: ReturnType<typeof createTabState>;
};

function scoredResult(score: number, tier: ScanResult['health']['tier']): ScanResult {
  return makeScanResult({
    tabId: TAB,
    health: { score, passing: 1, failing: 0, warnings: 0, total: 1, tier },
  });
}

/**
Scan states of the snapshots published so far, in order.
*/
function publishedScans(): string[] {
  return harness.browser.messages.map((message) => message.snapshot.scan.state);
}

function lastPublished(): TabSnapshot | undefined {
  return harness.browser.messages.at(-1)?.snapshot;
}

/**
Lets queued transitions and the settled Scan finish.
*/
async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

beforeEach(() => {
  harness.browser = createFakeTabStateBrowser();
  harness.pending = [];
  harness.tabState = createTabState(
    harness.browser,
    () =>
      new Promise<ScanResult>((resolve, reject) => {
        harness.pending.push({ resolve, reject });
      })
  );
});

describe('tab state checkout activity', () => {
  it('records detector activity and version, publishes it, and shows the activity badge', async () => {
    await harness.tabState.checkoutActivityDetected(TAB, '6.31.0');

    const expected: TabSnapshot = {
      result: null,
      checkoutActivity: { detected: true, version: '6.31.0' },
      scan: { state: 'idle' },
    };
    await expect(harness.tabState.read(TAB)).resolves.toEqual(expected);
    expect(harness.browser.messages).toEqual([
      { type: 'TAB_STATE_CHANGED', tabId: TAB, snapshot: expected },
    ]);
    expect(harness.browser.badges.get(TAB)).toEqual({ text: '✓', color: STATUS_COLORS.pass });

    await harness.tabState.checkoutActivityDetected(8);
    await expect(harness.tabState.read(8)).resolves.toMatchObject({
      checkoutActivity: { detected: true },
    });
  });

  it('clears activity and its badge when the detector no longer sees checkout', async () => {
    await harness.tabState.checkoutActivityDetected(TAB, '6.31.0');
    await harness.tabState.checkoutActivityCleared(TAB);

    await expect(harness.tabState.read(TAB)).resolves.toEqual({
      result: null,
      checkoutActivity: { detected: false },
      scan: { state: 'idle' },
    });
    expect(lastPublished()?.checkoutActivity).toEqual({ detected: false });
    expect(harness.browser.badges.has(TAB)).toBe(false);
  });
});

describe('tab state Scan lifecycle', () => {
  it('publishes the running Scan, then stores the result and shows its health score', async () => {
    const scan = harness.tabState.requestScan(TAB);
    await settle();
    expect(harness.browser.badges.get(TAB)?.text).toBe('…');
    expect(publishedScans()).toEqual(['running']);
    await expect(harness.tabState.read(TAB)).resolves.toMatchObject({ scan: { state: 'running' } });

    const result = scoredResult(82, 'issues');
    harness.pending[0]?.resolve(result);
    await scan;

    expect(publishedScans()).toEqual(['running', 'idle']);
    expect(lastPublished()?.result).toEqual(result);
    await expect(harness.tabState.read(TAB)).resolves.toMatchObject({
      result,
      scan: { state: 'idle' },
    });
    expect(harness.browser.badges.get(TAB)).toEqual({ text: '82', color: STATUS_COLORS.warn });
  });

  it.each([
    ['excellent', STATUS_COLORS.pass],
    ['critical', STATUS_COLORS.fail],
  ] as const)('colours a %s health badge', async (tier, color) => {
    const scan = harness.tabState.requestScan(TAB);
    await settle();
    harness.pending[0]?.resolve(scoredResult(50, tier));
    await scan;

    expect(harness.browser.badges.get(TAB)?.color).toBe(color);
  });

  it('clears the badge when the Scan finds no SDK, even with checkout activity', async () => {
    await harness.tabState.checkoutActivityDetected(TAB);
    const scan = harness.tabState.requestScan(TAB);
    await settle();
    harness.pending[0]?.resolve(makeScanResult({ payload: makeScanPayload({ tabId: TAB }) }));
    await scan;

    expect(harness.browser.badges.has(TAB)).toBe(false);
  });

  it('ignores a second request while a Scan of the page is running', async () => {
    const first = harness.tabState.requestScan(TAB);
    await settle();
    await harness.tabState.requestScan(TAB);

    expect(harness.pending).toHaveLength(1);
    expect(publishedScans()).toEqual(['running']);
    harness.pending[0]?.resolve(scoredResult(90, 'excellent'));
    await first;
  });

  it('keeps the running Scan in activity snapshots and badges', async () => {
    const scan = harness.tabState.requestScan(TAB);
    await settle();
    await harness.tabState.checkoutActivityDetected(TAB);
    expect(harness.browser.badges.get(TAB)?.text).toBe('…');
    expect(lastPublished()).toMatchObject({
      checkoutActivity: { detected: true },
      scan: { state: 'running' },
    });

    harness.pending[0]?.resolve(scoredResult(70, 'issues'));
    await scan;
    await harness.tabState.checkoutActivityDetected(TAB, '6.31.0');
    expect(harness.browser.badges.get(TAB)?.text).toBe('70');
  });

  it('publishes a failed Scan until the next one starts, and falls back to the activity badge', async () => {
    await harness.tabState.checkoutActivityDetected(TAB);
    const scan = harness.tabState.requestScan(TAB);
    await settle();
    harness.pending[0]?.reject(new Error('Tab 7 did not finish loading'));
    await scan;

    const failed = { state: 'failed', error: 'Tab 7 did not finish loading' };
    expect(lastPublished()?.scan).toEqual(failed);
    await expect(harness.tabState.read(TAB)).resolves.toMatchObject({ scan: failed });
    expect(harness.browser.badges.get(TAB)?.text).toBe('✓');

    const retry = harness.tabState.requestScan(TAB);
    await settle();
    expect(harness.pending).toHaveLength(2);
    expect(lastPublished()?.scan).toEqual({ state: 'running' });
    harness.pending[1]?.resolve(scoredResult(90, 'excellent'));
    await retry;
  });

  it('reports a Scan whose result cannot be stored as failed', async () => {
    const scan = harness.tabState.requestScan(TAB);
    await settle();
    harness.browser.failWrites = true;
    harness.pending[0]?.resolve(scoredResult(90, 'excellent'));
    await scan;

    expect(lastPublished()?.scan).toEqual({ state: 'failed', error: 'Storage quota exceeded' });
    await expect(harness.tabState.read(TAB)).resolves.toMatchObject({ result: null });
  });

  it('still starts the Scan when storage cannot be read to publish it', async () => {
    harness.browser.failReads = true;
    const scan = harness.tabState.requestScan(TAB);
    await settle();

    expect(harness.pending).toHaveLength(1);
    expect(harness.browser.messages).toHaveLength(0);
    harness.browser.failReads = false;
    harness.pending[0]?.resolve(scoredResult(90, 'excellent'));
    await scan;
    expect(publishedScans()).toEqual(['idle']);
  });
});

describe('tab state navigation', () => {
  it('clears stored state and the badge, and publishes an empty snapshot', async () => {
    await harness.tabState.checkoutActivityDetected(TAB, '6.31.0');
    const scan = harness.tabState.requestScan(TAB);
    await settle();
    harness.pending[0]?.resolve(scoredResult(90, 'excellent'));
    await scan;

    await harness.tabState.navigated(TAB);

    expect(harness.browser.storage.size).toBe(0);
    expect(harness.browser.badges.has(TAB)).toBe(false);
    expect(lastPublished()).toEqual({
      result: null,
      checkoutActivity: { detected: false },
      scan: { state: 'idle' },
    });
  });

  it('discards a Scan that finishes after the tab navigated', async () => {
    const stale = harness.tabState.requestScan(TAB);
    await settle();
    await harness.tabState.navigated(TAB);
    await harness.tabState.checkoutActivityDetected(TAB);

    harness.pending[0]?.resolve(scoredResult(40, 'critical'));
    await stale;

    expect(publishedScans()).toEqual(['running', 'idle', 'idle']);
    await expect(harness.tabState.read(TAB)).resolves.toEqual({
      result: null,
      checkoutActivity: { detected: true },
      scan: { state: 'idle' },
    });
    expect(harness.browser.badges.get(TAB)?.text).toBe('✓');
  });

  it('lets the new page be scanned while a stale Scan is still running', async () => {
    const stale = harness.tabState.requestScan(TAB);
    await settle();
    await harness.tabState.navigated(TAB);
    const current = harness.tabState.requestScan(TAB);
    await settle();
    expect(harness.pending).toHaveLength(2);

    const fresh = scoredResult(95, 'excellent');
    harness.pending[1]?.resolve(fresh);
    await current;
    harness.pending[0]?.reject(new Error('Frame was removed'));
    await stale;

    expect(publishedScans()).toEqual(['running', 'idle', 'running', 'idle']);
    await expect(harness.tabState.read(TAB)).resolves.toMatchObject({ result: fresh });
    expect(harness.browser.badges.get(TAB)?.text).toBe('95');
  });

  it('forgets a closed tab without storing its pending Scan', async () => {
    await harness.tabState.checkoutActivityDetected(TAB);
    const scan = harness.tabState.requestScan(TAB);
    await settle();
    await harness.tabState.removed(TAB);

    harness.pending[0]?.resolve(scoredResult(90, 'excellent'));
    await scan;

    expect(harness.browser.storage.size).toBe(0);
    expect(publishedScans()).toEqual(['idle', 'running']);
  });

  it('still resets open views when clearing storage fails', async () => {
    const failing = {
      ...harness.browser,
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
