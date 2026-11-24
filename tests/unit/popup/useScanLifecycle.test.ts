import { h, render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTabState } from '../../../src/background/tab-state';
import {
  useScanLifecycle,
  type TabStateClient,
} from '../../../src/popup/components/useScanLifecycle';
import type { ScanResult } from '../../../src/shared/types';
import {
  createFakeTabStateBrowser,
  type FakeTabStateBrowser,
} from '../../fixtures/fakeTabStateBrowser';
import { connectTabStateClient } from '../../fixtures/inMemoryTabStateClient';
import { makeScanResult } from '../../fixtures/makeScanPayload';

type ScanSession = ReturnType<typeof useScanLifecycle>;
type TabTarget = Parameters<typeof useScanLifecycle>[0];

const TAB = 3;

interface PendingScan {
  resolve: (result: ScanResult) => void;
  reject: (error: Error) => void;
}

const harness = {} as {
  host: HTMLDivElement;
  session: ScanSession;
  browser: FakeTabStateBrowser;
  tabState: ReturnType<typeof createTabState>;
  client: TabStateClient;
  pending: PendingScan[];
};

function TestView({
  target,
  tabClient,
}: {
  readonly target: TabTarget;
  readonly tabClient: TabStateClient;
}): JSX.Element | null {
  harness.session = useScanLifecycle(target, tabClient);
  return null;
}

/**
Lets queued tab state transitions and view updates finish.
 */
async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });
}

const INSPECTED_TAB: TabTarget = { getTabId: () => TAB };

async function mount(target = INSPECTED_TAB, tabClient = harness.client): Promise<void> {
  await act(async () => {
    render(h(TestView, { target, tabClient }), harness.host);
  });
  await settle();
}

async function startScan(): Promise<void> {
  await act(async () => {
    harness.session.scan();
  });
  await settle();
}

beforeEach(() => {
  harness.host = document.createElement('div');
  document.body.append(harness.host);
  harness.browser = createFakeTabStateBrowser();
  harness.pending = [];
  harness.tabState = createTabState(
    harness.browser,
    () =>
      new Promise<ScanResult>((resolve, reject) => {
        harness.pending.push({ resolve, reject });
      })
  );
  harness.client = connectTabStateClient(harness.tabState, harness.browser);
});

afterEach(() => {
  render(null, harness.host);
  harness.host.remove();
});

describe('useScanLifecycle', () => {
  it('loads the tab snapshot, then follows a Scan to its stored result', async () => {
    await harness.tabState.checkoutActivityDetected(TAB, '6.31.0');
    await mount();

    expect(harness.session).toMatchObject({
      result: null,
      checkoutActivity: { detected: true, version: '6.31.0' },
      scanning: false,
      loading: false,
      error: null,
    });

    await startScan();
    expect(harness.session.scanning).toBe(true);
    expect(harness.pending).toHaveLength(1);

    const result = makeScanResult({ tabId: TAB });
    harness.pending[0]?.resolve(result);
    await settle();
    expect(harness.session).toMatchObject({ result, scanning: false, error: null });
  });

  it('shows a Scan that was already running when the view opened', async () => {
    void harness.tabState.requestScan(TAB).catch(() => {});
    await settle();
    await mount();

    expect(harness.session.scanning).toBe(true);
  });

  it('shows checkout activity the detector reports while the view is open', async () => {
    await mount();
    expect(harness.session.checkoutActivity).toEqual({ detected: false });

    await harness.tabState.checkoutActivityDetected(TAB, '6.31.0');
    await settle();
    expect(harness.session.checkoutActivity).toEqual({ detected: true, version: '6.31.0' });
  });

  it('clears the view when the tab navigates', async () => {
    await harness.tabState.checkoutActivityDetected(TAB);
    await mount();
    await startScan();
    harness.pending[0]?.resolve(makeScanResult({ tabId: TAB }));
    await settle();
    expect(harness.session.result).not.toBeNull();

    await harness.tabState.navigated(TAB);
    await settle();
    expect(harness.session).toMatchObject({
      result: null,
      checkoutActivity: { detected: false },
      scanning: false,
    });
  });

  it('ignores snapshots published for other tabs', async () => {
    await mount({ getTabId: async () => TAB });
    await harness.tabState.checkoutActivityDetected(TAB + 1);
    void harness.tabState.requestScan(TAB + 1).catch(() => {});
    await settle();

    expect(harness.session).toMatchObject({
      scanning: false,
      checkoutActivity: { detected: false },
    });
  });

  it('shows a failed Scan and clears the failure when a retry starts', async () => {
    await mount();
    await startScan();
    harness.pending[0]?.reject(new Error('Blocked page'));
    await settle();
    expect(harness.session).toMatchObject({
      scanning: false,
      error: { kind: 'scan', message: 'Blocked page' },
    });

    await startScan();
    expect(harness.session).toMatchObject({ scanning: true, error: null });
  });

  it('surfaces a scan request that cannot be sent', async () => {
    const cause = new Error('Extension context invalidated');
    await mount(undefined, {
      ...harness.client,
      requestScan: async () => {
        throw cause;
      },
    });
    await startScan();

    expect(harness.session).toMatchObject({ scanning: false, error: { kind: 'request', cause } });
  });

  it('reports a view without an inspectable tab', async () => {
    await mount({ getTabId: () => undefined });
    expect(harness.session).toMatchObject({ loading: false, error: null, result: null });

    await startScan();
    expect(harness.session).toMatchObject({ scanning: false, error: { kind: 'tab' } });
  });

  it('reports a runtime failure when the tab cannot be resolved or read', async () => {
    const cause = new Error('Extension context invalidated');
    await mount({
      getTabId: () => {
        throw cause;
      },
    });
    expect(harness.session).toMatchObject({ loading: false, error: { kind: 'runtime', cause } });

    await startScan();
    expect(harness.session.error).toEqual({ kind: 'runtime', cause });

    render(null, harness.host);
    await mount(undefined, {
      ...harness.client,
      read: async () => {
        throw cause;
      },
    });
    expect(harness.session.error).toEqual({ kind: 'runtime', cause });
  });

  it('stops following the tab after unmounting', async () => {
    await mount();
    render(null, harness.host);
    const before = harness.session;

    await harness.tabState.checkoutActivityDetected(TAB);
    await settle();
    expect(harness.session).toBe(before);
  });
});

describe('useScanLifecycle after the view closes', () => {
  it('stops following a tab whose id resolves after the view closed', async () => {
    const tab = Promise.withResolvers<number>();
    const target: TabTarget = { getTabId: () => tab.promise };
    let reads = 0;
    const counting: TabStateClient = {
      ...harness.client,
      read: async (tabId) => {
        reads += 1;
        return harness.client.read(tabId);
      },
    };
    await mount(target, counting);

    await act(async () => {
      render(null, harness.host);
    });
    tab.resolve(TAB);
    await settle();

    expect(reads).toBe(0);
  });

  it('ignores a snapshot that arrives after the view closed', async () => {
    const snapshot = Promise.withResolvers<Awaited<ReturnType<TabStateClient['read']>>>();
    const slow: TabStateClient = { ...harness.client, read: () => snapshot.promise };
    await mount(INSPECTED_TAB, slow);
    const before = harness.session;

    await act(async () => {
      render(null, harness.host);
    });
    snapshot.resolve(await harness.client.read(TAB));
    await settle();

    expect(harness.session).toBe(before);
    expect(harness.session.loading).toBe(true);
  });
});
