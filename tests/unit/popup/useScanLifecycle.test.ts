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

let host: HTMLDivElement;
let session: ScanSession;
let browser: FakeTabStateBrowser;
let tabState: ReturnType<typeof createTabState>;
let client: TabStateClient;
let pending: PendingScan[];

function TestView({
  target,
  tabClient,
}: {
  readonly target: TabTarget;
  readonly tabClient: TabStateClient;
}): JSX.Element | null {
  session = useScanLifecycle(target, tabClient);
  return null;
}

/** Lets queued tab state transitions and view updates finish. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

const INSPECTED_TAB: TabTarget = { getTabId: () => TAB };

async function mount(target = INSPECTED_TAB, tabClient = client): Promise<void> {
  await act(async () => {
    render(h(TestView, { target, tabClient }), host);
  });
  await settle();
}

async function startScan(): Promise<void> {
  await act(async () => {
    session.scan();
  });
  await settle();
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  browser = createFakeTabStateBrowser();
  pending = [];
  tabState = createTabState(
    browser,
    () =>
      new Promise<ScanResult>((resolve, reject) => {
        pending.push({ resolve, reject });
      })
  );
  client = connectTabStateClient(tabState, browser);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe('useScanLifecycle', () => {
  it('loads the tab snapshot, then follows a Scan to its stored result', async () => {
    await tabState.checkoutActivityDetected(TAB, '6.31.0');
    await mount();

    expect(session).toMatchObject({
      result: null,
      checkoutActivity: { detected: true, version: '6.31.0' },
      scanning: false,
      loading: false,
      error: null,
    });

    await startScan();
    expect(session.scanning).toBe(true);
    expect(pending).toHaveLength(1);

    const result = makeScanResult({ tabId: TAB });
    pending[0]?.resolve(result);
    await settle();
    expect(session).toMatchObject({ result, scanning: false, error: null });
  });

  it('shows a Scan that was already running when the view opened', async () => {
    tabState.requestScan(TAB).catch(() => {});
    await settle();
    await mount();

    expect(session.scanning).toBe(true);
  });

  it('shows checkout activity the detector reports while the view is open', async () => {
    await mount();
    expect(session.checkoutActivity).toEqual({ detected: false });

    await tabState.checkoutActivityDetected(TAB, '6.31.0');
    await settle();
    expect(session.checkoutActivity).toEqual({ detected: true, version: '6.31.0' });
  });

  it('clears the view when the tab navigates', async () => {
    await tabState.checkoutActivityDetected(TAB);
    await mount();
    await startScan();
    pending[0]?.resolve(makeScanResult({ tabId: TAB }));
    await settle();
    expect(session.result).not.toBeNull();

    await tabState.navigated(TAB);
    await settle();
    expect(session).toMatchObject({
      result: null,
      checkoutActivity: { detected: false },
      scanning: false,
    });
  });

  it('ignores snapshots published for other tabs', async () => {
    await mount({ getTabId: async () => TAB });
    await tabState.checkoutActivityDetected(TAB + 1);
    tabState.requestScan(TAB + 1).catch(() => {});
    await settle();

    expect(session).toMatchObject({ scanning: false, checkoutActivity: { detected: false } });
  });

  it('shows a failed Scan and clears the failure when a retry starts', async () => {
    await mount();
    await startScan();
    pending[0]?.reject(new Error('Blocked page'));
    await settle();
    expect(session).toMatchObject({
      scanning: false,
      error: { kind: 'scan', message: 'Blocked page' },
    });

    await startScan();
    expect(session).toMatchObject({ scanning: true, error: null });
  });

  it('surfaces a scan request that cannot be sent', async () => {
    const cause = new Error('Extension context invalidated');
    await mount(undefined, {
      ...client,
      requestScan: async () => {
        throw cause;
      },
    });
    await startScan();

    expect(session).toMatchObject({ scanning: false, error: { kind: 'request', cause } });
  });

  it('reports a view without an inspectable tab', async () => {
    await mount({ getTabId: () => undefined });
    expect(session).toMatchObject({ loading: false, error: null, result: null });

    await startScan();
    expect(session).toMatchObject({ scanning: false, error: { kind: 'tab' } });
  });

  it('reports a runtime failure when the tab cannot be resolved or read', async () => {
    const cause = new Error('Extension context invalidated');
    await mount({
      getTabId: () => {
        throw cause;
      },
    });
    expect(session).toMatchObject({ loading: false, error: { kind: 'runtime', cause } });

    await startScan();
    expect(session.error).toEqual({ kind: 'runtime', cause });

    render(null, host);
    await mount(undefined, {
      ...client,
      read: async () => {
        throw cause;
      },
    });
    expect(session.error).toEqual({ kind: 'runtime', cause });
  });

  it('stops following the tab after unmounting', async () => {
    await mount();
    render(null, host);
    const before = session;

    await tabState.checkoutActivityDetected(TAB);
    await settle();
    expect(session).toBe(before);
  });
});

describe('useScanLifecycle after the view closes', () => {
  it('stops following a tab whose id resolves after the view closed', async () => {
    const tab = Promise.withResolvers<number>();
    const target: TabTarget = { getTabId: () => tab.promise };
    let reads = 0;
    const counting: TabStateClient = {
      ...client,
      read: async (tabId) => {
        reads += 1;
        return client.read(tabId);
      },
    };
    await mount(target, counting);

    await act(async () => {
      render(null, host);
    });
    tab.resolve(TAB);
    await settle();

    expect(reads).toBe(0);
  });

  it('ignores a snapshot that arrives after the view closed', async () => {
    const snapshot = Promise.withResolvers<Awaited<ReturnType<TabStateClient['read']>>>();
    const slow: TabStateClient = { ...client, read: () => snapshot.promise };
    await mount(INSPECTED_TAB, slow);
    const before = session;

    await act(async () => {
      render(null, host);
    });
    snapshot.resolve(await client.read(TAB));
    await settle();

    expect(session).toBe(before);
    expect(session.loading).toBe(true);
  });
});
