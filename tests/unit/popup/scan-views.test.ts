import { h, render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Panel } from '../../../src/devtools/panel/Panel';
import { Popup } from '../../../src/popup/PopupApp';
import type { CheckoutActivity, TabSnapshot } from '../../../src/shared/messages';
import type { ScanResult } from '../../../src/shared/types';
import { makeScanResult } from '../../fixtures/makeScanPayload';

interface Message {
  readonly type: string;
  readonly tabId: number;
}

let host: HTMLDivElement;
let listener: ((message: Message) => void) | undefined;
let sendMessage: ReturnType<typeof vi.fn>;

function makeResult(): ScanResult {
  return makeScanResult({
    tabId: 3,
    health: { score: 100, passing: 1, failing: 0, warnings: 0, total: 1, tier: 'excellent' },
  });
}

function snapshot(result: ScanResult | null, checkoutActivity?: CheckoutActivity): TabSnapshot {
  return { result, checkoutActivity: checkoutActivity ?? { detected: false } };
}

async function clickButton(label: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
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
  });
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe('scan views', () => {
  it('keeps the popup version gate and shows a completed scan', async () => {
    sendMessage.mockResolvedValue(snapshot(null, { detected: true, version: '5.67.0' }));
    await mount(Popup);
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Adyen Web Version Outdated');
    });

    sendMessage.mockResolvedValue(snapshot(makeResult()));
    await act(async () => {
      listener?.({ type: 'SCAN_COMPLETE', tabId: 3 });
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Re-run Scan');
    });
  });

  it('offers a scan when the detector saw checkout activity on a supported version', async () => {
    sendMessage.mockResolvedValue(snapshot(null, { detected: true, version: '6.31.0' }));
    await mount(Popup);

    await vi.waitFor(() => {
      expect(host.textContent).toContain('Adyen Web SDK detected');
    });
    expect(host.textContent).toContain('Run Scan');
    expect(host.textContent).not.toContain('Export PDF');
  });

  it('offers an attempt scan when no checkout activity was detected', async () => {
    await mount(Popup);

    await vi.waitFor(() => {
      expect(host.textContent).toContain('Adyen not detected');
    });
    expect(host.textContent).toContain('Attempt Scan');
  });

  it('shows the scan error view with a retry after a failed scan', async () => {
    await mount(Popup);
    await act(async () => {
      listener?.({ type: 'SCAN_ERROR', tabId: 3 });
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(host.textContent).toContain('Scan failed');
    });
    expect(host.textContent).toContain('Try Again');
  });

  it('groups popup failures and warnings with the shared impact labels', async () => {
    sendMessage.mockResolvedValue(
      snapshot(
        makeScanResult({
          tabId: 3,
          checks: [
            {
              id: 'auth-country-code',
              category: 'auth',
              severity: 'fail',
              title: 'Missing country',
            },
            {
              id: 'risk-df-iframe',
              category: 'risk',
              severity: 'warn',
              impact: 'high',
              title: 'No fingerprint',
            },
            { id: 'auth-locale', category: 'auth', severity: 'warn', title: 'Locale missing' },
          ],
        }),
        { detected: true }
      )
    );
    await mount(Popup);

    await vi.waitFor(() => {
      expect(host.textContent).toContain('Missing country');
    });
    const headers = [...host.querySelectorAll('[class*="priorityHeader"]')].map(
      (header) => header.textContent
    );
    expect(headers).toEqual(['High impact1', 'High impact1', 'Medium impact1']);
  });

  it('shows the same resolved remediation and documentation in the popup and DevTools', async () => {
    const withoutGuidance = makeScanResult({
      tabId: 3,
      checks: [
        { id: 'auth-country-code', category: 'auth', severity: 'fail', title: 'No country' },
      ],
    });
    const remediation =
      'Follow the linked Adyen guidance, apply the configuration change, then rerun the scan.';
    const docsUrl = 'https://docs.adyen.com/online-payments/web-best-practices/';
    sendMessage.mockResolvedValue(snapshot(withoutGuidance, { detected: true }));

    for (const View of [Popup, Panel]) {
      await mount(View);
      if (View === Panel) await clickButton('Best Practices');
      await vi.waitFor(() => {
        expect(host.textContent).toContain(remediation);
      });
      expect([...host.querySelectorAll('a')].map((link) => link.href)).toContain(docsUrl);
      render(null, host);
    }
  });

  it('uses the scan verdict for SDK presence in the DevTools panel', async () => {
    sendMessage.mockResolvedValue(
      snapshot(makeScanResult({ tabId: 3, sdkPresence: { detected: false, source: 'none' } }))
    );
    await mount(Panel);

    await vi.waitFor(() => {
      expect(host.textContent).toContain('Adyen Web SDK was not detected on this page.');
    });
    expect(host.textContent).not.toContain('Export JSON');
  });

  it('renders every DevTools panel tab for a detected result', async () => {
    sendMessage.mockResolvedValue(
      snapshot(
        makeScanResult({
          tabId: 3,
          checks: [
            {
              id: 'auth-locale',
              category: 'auth',
              severity: 'warn',
              title: 'Locale missing',
              detail: 'No locale was configured.',
              remediation: 'Set locale.',
              docsUrl: 'https://docs.adyen.com/online-payments/build-your-integration/',
            },
            { id: 'security-https', category: 'security', severity: 'pass', title: 'HTTPS in use' },
            {
              id: '3p-no-sri',
              category: 'third-party',
              severity: 'skip',
              title: 'Third-party SRI — No third-party scripts.',
            },
          ],
        })
      )
    );
    await mount(Panel);
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Export JSON');
    });

    const tabs = [
      ['Best Practices', 'No locale was configured.'],
      ['Security', 'HTTPS in use'],
      ['Skipped Checks', 'No third-party scripts.'],
      ['Network', 'No Adyen requests captured.'],
      ['Extracted Config', 'No inferred config captured.'],
      ['Overview', 'Implementation Attributes'],
    ] as const;
    for (const [tab, text] of tabs) {
      await clickButton(tab);
      expect(host.textContent).toContain(text);
    }
  });

  it('preserves DevTools context-invalidation wording after a rejected scan request', async () => {
    await mount(Panel);
    sendMessage.mockRejectedValueOnce(new Error('Extension context invalidated'));
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Run Scan');
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Reload the extension');
    });
  });
});
