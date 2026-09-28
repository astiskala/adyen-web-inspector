import { h, render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Panel } from '../../../src/devtools/panel/Panel';
import { Popup } from '../../../src/popup/PopupApp';
import type { ScanResult } from '../../../src/shared/types';
import { makeScanResult } from '../../fixtures/makeScanPayload';

interface Message {
  readonly type: string;
  readonly tabId: number;
}

let host: HTMLDivElement;
let listener: ((message: Message) => void) | undefined;
let sendMessage: ReturnType<typeof vi.fn>;
let getStorage: ReturnType<typeof vi.fn>;

function makeResult(): ScanResult {
  return makeScanResult({
    tabId: 3,
    health: { score: 100, passing: 1, failing: 0, warnings: 0, total: 1, tier: 'excellent' },
  });
}

async function mount(View: () => JSX.Element): Promise<void> {
  await act(async () => {
    render(h(View, {}), host);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  listener = undefined;
  sendMessage = vi.fn().mockResolvedValue(null);
  getStorage = vi.fn().mockResolvedValue({});
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn().mockResolvedValue([{ id: 3 }]) },
    devtools: { inspectedWindow: { tabId: 3 } },
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((fn: (message: Message) => void) => {
          listener = fn;
        }),
        removeListener: vi.fn(),
      },
    },
    storage: { session: { get: getStorage } },
  });
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe('scan views', () => {
  it('keeps the popup version gate and shows a completed scan', async () => {
    getStorage.mockResolvedValue({ adyen_detected_3: true, adyen_version_3: '5.67.0' });
    await mount(Popup);
    await vi.waitFor(() => expect(host.textContent).toContain('Adyen Web Version Outdated'));

    sendMessage.mockResolvedValue(makeResult());
    await act(async () => {
      listener?.({ type: 'SCAN_COMPLETE', tabId: 3 });
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Re-run Scan'));
  });

  it('preserves DevTools context-invalidation wording after a rejected scan request', async () => {
    await mount(Panel);
    sendMessage.mockRejectedValueOnce(new Error('Extension context invalidated'));
    const button = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent === 'Run Scan'
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Reload the extension'));
  });
});
