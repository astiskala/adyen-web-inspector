import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromeTabStateClient } from '../../../src/popup/components/chrome-tab-state-client';
import type { TabSnapshot } from '../../../src/shared/messages';
import { makeScanResult } from '../../fixtures/makeScanPayload';

type Listener = (message: unknown) => void;

function stubRuntime(response: unknown): {
  sendMessage: ReturnType<typeof vi.fn>;
  listeners: Set<Listener>;
} {
  const listeners = new Set<Listener>();
  const sendMessage = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: (listener: Listener) => listeners.add(listener),
        removeListener: (listener: Listener) => listeners.delete(listener),
      },
    },
  });
  return { sendMessage, listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chromeTabStateClient', () => {
  it('reads a tab snapshot from the worker', async () => {
    const snapshot: TabSnapshot = {
      result: makeScanResult({ tabId: 4 }),
      checkoutActivity: { detected: true, version: '6.31.0' },
      scan: { state: 'failed', error: 'Blocked page' },
    };
    const { sendMessage } = stubRuntime(snapshot);

    await expect(chromeTabStateClient.read(4)).resolves.toEqual(snapshot);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_TAB_STATE', tabId: 4 });
  });

  it.each([
    ['a missing response', null],
    ['a malformed response', { result: 'x', checkoutActivity: 'y', scan: { state: 'failed' } }],
  ])('reads %s as an empty snapshot', async (_label, response) => {
    stubRuntime(response);

    await expect(chromeTabStateClient.read(4)).resolves.toEqual({
      result: null,
      checkoutActivity: { detected: false },
      scan: { state: 'idle' },
    });
  });

  it('reads detector activity without a version and a running Scan', async () => {
    stubRuntime({ checkoutActivity: { detected: true }, scan: { state: 'running' } });

    await expect(chromeTabStateClient.read(4)).resolves.toMatchObject({
      checkoutActivity: { detected: true },
      scan: { state: 'running' },
    });
  });

  it('sends scan requests', async () => {
    const { sendMessage } = stubRuntime(undefined);

    await chromeTabStateClient.requestScan(4);

    expect(sendMessage).toHaveBeenCalledWith({ type: 'SCAN_REQUEST', tabId: 4 });
  });

  it('delivers published snapshots until unsubscribed, ignoring other messages', () => {
    const { listeners } = stubRuntime(undefined);
    const received: [number, TabSnapshot][] = [];

    const unsubscribe = chromeTabStateClient.subscribe((tabId, snapshot) => {
      received.push([tabId, snapshot]);
    });
    for (const listener of listeners) {
      listener({ type: 'CHECKOUT_ACTIVITY_DETECTED', tabId: 4 });
      listener({ type: 'TAB_STATE_CHANGED', tabId: 'x' });
      listener('noise');
      listener({ type: 'TAB_STATE_CHANGED', tabId: 4, snapshot: { scan: { state: 'running' } } });
    }
    unsubscribe();

    expect(received).toEqual([
      [4, { result: null, checkoutActivity: { detected: false }, scan: { state: 'running' } }],
    ]);
    expect(listeners.size).toBe(0);
  });
});
