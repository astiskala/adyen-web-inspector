import { h, render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScanLifecycle } from '../../../src/popup/components/useScanLifecycle';
import type { ScanResult } from '../../../src/shared/types';
import { makeScanPayload } from '../../fixtures/makeScanPayload';

type ScanSession = ReturnType<typeof useScanLifecycle>;
type Adapter = Parameters<typeof useScanLifecycle>[0];
interface Message {
  readonly type: string;
  readonly tabId: number;
  readonly error?: string;
}

let host: HTMLDivElement;
let session: ScanSession;
let listener: ((message: Message) => void) | undefined;
let sendMessage: ReturnType<typeof vi.fn>;
let removeListener: ReturnType<typeof vi.fn>;

function TestView({ adapter }: { readonly adapter: Adapter }): JSX.Element | null {
  session = useScanLifecycle(adapter);
  return null;
}

function makeResult(): ScanResult {
  return {
    tabId: 3,
    pageUrl: 'https://merchant.example/checkout',
    scannedAt: '2026-09-28T00:00:00.000Z',
    checks: [],
    health: { score: 100, passing: 0, failing: 0, warnings: 0, total: 0, tier: 'excellent' },
    standardCompliance: { compliant: false, reasons: [] },
    payload: makeScanPayload(),
  };
}

async function mount(adapter: Adapter): Promise<void> {
  await act(async () => {
    render(h(TestView, { adapter }), host);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function dispatch(message: Message): Promise<void> {
  await act(async () => {
    listener?.(message);
    await Promise.resolve();
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  listener = undefined;
  sendMessage = vi.fn().mockResolvedValue(null);
  removeListener = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((fn: (message: Message) => void) => {
          listener = fn;
        }),
        removeListener,
      },
    },
  });
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useScanLifecycle', () => {
  it('loads a result, starts a scan and reloads after completion', async () => {
    const result = makeResult();
    sendMessage.mockResolvedValue(result);
    await mount({ source: 'popup', getTabId: async () => 3 });

    expect(session.result).toEqual(result);
    expect(session.loading).toBe(false);
    await act(async () => {
      session.scan();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SCAN_REQUEST', tabId: 3, source: 'popup' });
    expect(session.scanning).toBe(true);

    await dispatch({ type: 'SCAN_STARTED', tabId: 12 });
    expect(session.scanning).toBe(true);
    await dispatch({ type: 'SCAN_COMPLETE', tabId: 3 });
    expect(sendMessage).toHaveBeenLastCalledWith({ type: 'GET_RESULT', tabId: 3 });
    expect(session.result).toEqual(result);
    expect(session.scanning).toBe(false);
    expect(session.error).toBeNull();
  });

  it('waits for the popup reset delay before reloading, but clears the prior result at once', async () => {
    sendMessage.mockResolvedValue(makeResult());
    await mount({ source: 'popup', getTabId: async () => 3, resetDelayMs: 400 });
    vi.useFakeTimers();
    sendMessage.mockResolvedValue(null);

    await dispatch({ type: 'SCAN_RESET', tabId: 3 });
    expect(session.result).toBeNull();
    expect(session.loading).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(session.loading).toBe(false);
  });

  it('clears the inspected tab without a reset reload', async () => {
    sendMessage.mockResolvedValue(makeResult());
    await mount({ source: 'devtools', getTabId: () => 3 });

    await dispatch({ type: 'SCAN_RESET', tabId: 3 });
    expect(session.result).toBeNull();
    expect(session.loading).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending popup reset reload when another scan starts', async () => {
    await mount({ source: 'popup', getTabId: async () => 3, resetDelayMs: 400 });
    vi.useFakeTimers();

    await dispatch({ type: 'SCAN_RESET', tabId: 3 });
    await dispatch({ type: 'SCAN_STARTED', tabId: 3 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(session.scanning).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores a result loaded before a reset', async () => {
    let resolveResult: ((result: ScanResult) => void) | undefined;
    sendMessage.mockReturnValueOnce(
      new Promise<ScanResult>((resolve) => {
        resolveResult = resolve;
      })
    );
    await mount({ source: 'popup', getTabId: async () => 3, resetDelayMs: 400 });
    await dispatch({ type: 'SCAN_RESET', tabId: 3 });

    expect(resolveResult).toBeDefined();
    await act(async () => {
      resolveResult?.(makeResult());
      await Promise.resolve();
    });
    expect(session.result).toBeNull();
  });

  it('uses the inspected tab adapter, ignores other tabs and preserves scan errors', async () => {
    await mount({ source: 'devtools', getTabId: () => 4 });
    await dispatch({ type: 'SCAN_STARTED', tabId: 3 });
    expect(session.scanning).toBe(false);
    await dispatch({ type: 'SCAN_STARTED', tabId: 4 });
    expect(session.scanning).toBe(true);
    await dispatch({ type: 'SCAN_ERROR', tabId: 4, error: 'Blocked page' });
    expect(session.scanning).toBe(false);
    expect(session.error).toEqual({ kind: 'scan', message: 'Blocked page' });
  });

  it('surfaces request errors and cleans up the listener on unmount', async () => {
    await mount({ source: 'devtools', getTabId: () => 4 });
    sendMessage.mockRejectedValueOnce(new Error('Extension context invalidated'));
    await act(async () => {
      session.scan();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(session.error?.kind).toBe('request');
    if (session.error?.kind === 'request') {
      expect(session.error.cause).toBeInstanceOf(Error);
    }
    render(null, host);
    expect(removeListener).toHaveBeenCalledWith(listener);
  });
});
