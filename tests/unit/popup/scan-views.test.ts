import { h, render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { Panel } from '../../../src/devtools/panel/Panel';
import { Popup } from '../../../src/popup/PopupApp';
import type { CheckoutActivity, TabScanStatus, TabSnapshot } from '../../../src/shared/messages';
import type { ScanResult } from '../../../src/shared/types';
import { makeAdyenPayload, makeScanResult } from '../../fixtures/makeScanPayload';

interface Message {
  readonly type: string;
  readonly tabId: number;
  readonly snapshot: TabSnapshot;
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

const IDLE: TabScanStatus = { state: 'idle' };

function snapshot(
  result: ScanResult | null,
  checkoutActivity?: CheckoutActivity,
  scan = IDLE
): TabSnapshot {
  return { result, checkoutActivity: checkoutActivity ?? { detected: false }, scan };
}

async function publish(tabSnapshot: TabSnapshot): Promise<void> {
  await act(async () => {
    listener?.({ type: 'TAB_STATE_CHANGED', tabId: 3, snapshot: tabSnapshot });
    await Promise.resolve();
  });
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

    await publish(snapshot(makeResult()));
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Re-run Scan');
    });
  });

  it('shows a Scan already running when the popup opens', async () => {
    sendMessage.mockResolvedValue(snapshot(null, { detected: true }, { state: 'running' }));
    await mount(Popup);

    await vi.waitFor(() => {
      expect(host.textContent).toContain('Scanning…');
    });
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Scanning…');
    expect(button?.disabled).toBe(true);
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
    await publish(snapshot(null, undefined, { state: 'failed', error: 'Blocked page' }));

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

  it.each([
    ['popup', Popup, null],
    ['DevTools panel', Panel, 'Best Practices'],
  ] as const)(
    'shows the resolved remediation and documentation in the %s',
    async (_label, View, tab) => {
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

      await mount(View);
      if (tab !== null) await clickButton(tab);
      await vi.waitFor(() => {
        expect(host.textContent).toContain(remediation);
      });
      expect([...host.querySelectorAll('a')].map((link) => link.href)).toContain(docsUrl);
    }
  );

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

interface ReportTabStubs {
  readonly create: ReturnType<typeof vi.fn>;
  readonly remove: ReturnType<typeof vi.fn>;
}

/** Adds what the PDF export needs to the stubbed chrome global. */
function stubReportTab(): ReportTabStubs {
  const stubbed = globalThis.chrome as unknown as {
    runtime: Record<string, unknown>;
    tabs: Record<string, unknown>;
    storage?: unknown;
  };
  const create = vi.fn().mockResolvedValue({ id: 9 });
  const remove = vi.fn().mockResolvedValue(undefined);
  stubbed.runtime['getURL'] = (path: string): string => `chrome-extension://id/${path}`;
  stubbed.tabs['create'] = create;
  stubbed.storage = { session: { set: vi.fn().mockResolvedValue(undefined), remove } };
  return { create, remove };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DevTools panel states', () => {
  it.each([
    ['a failed scan without a message', '', 'Scan failed. Try reloading the page.'],
    ['a failed scan with its message', 'Blocked page', 'Blocked page'],
  ])('explains %s', async (_label, error, message) => {
    sendMessage.mockResolvedValue(snapshot(null, undefined, { state: 'failed', error }));
    await mount(Panel);

    await vi.waitFor(() => {
      expect(host.textContent).toContain(message);
    });
  });

  it('explains a scan request the runtime rejected', async () => {
    await mount(Panel);
    sendMessage.mockRejectedValueOnce(new Error('offline'));

    await clickButton('Run Scan');
    await settle();

    await vi.waitFor(() => {
      expect(host.textContent).toContain('Unable to start scan. Try reloading the page.');
    });
  });

  it('explains a runtime that cannot be reached', async () => {
    sendMessage.mockRejectedValue(new Error('offline'));
    await mount(Panel);

    await vi.waitFor(() => {
      expect(host.textContent).toContain('Unable to communicate with the extension runtime.');
    });
  });

  it('explains a panel without an inspected tab', async () => {
    (globalThis.chrome as unknown as { devtools: unknown }).devtools = {
      inspectedWindow: { tabId: undefined },
    };
    await mount(Panel);

    await clickButton('Run Scan');
    await settle();

    await vi.waitFor(() => {
      expect(host.textContent).toContain('Unable to communicate with the extension runtime.');
    });
  });

  it('shows a Scan in progress before any result', async () => {
    sendMessage.mockResolvedValue(snapshot(null, undefined, { state: 'running' }));
    await mount(Panel);

    await vi.waitFor(() => {
      expect(host.querySelector('[class*="emptyState"]')?.textContent).toBe('Scanning…');
    });
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Scanning…');
    expect(button?.disabled).toBe(true);
  });

  it('exports the result as JSON and as a PDF report', async () => {
    const report = stubReportTab();
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    const urlStatics = URL as unknown as Record<string, unknown>;
    urlStatics['createObjectURL'] = createObjectURL;
    urlStatics['revokeObjectURL'] = revokeObjectURL;
    onTestFinished(() => {
      Reflect.deleteProperty(urlStatics, 'createObjectURL');
      Reflect.deleteProperty(urlStatics, 'revokeObjectURL');
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    sendMessage.mockResolvedValue(snapshot(makeResult(), { detected: true }));
    await mount(Panel);
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Export JSON');
    });

    vi.useFakeTimers({ toFake: ['setTimeout'] });
    await clickButton('Export JSON');
    vi.runAllTimers();
    vi.useRealTimers();
    await clickButton('Export PDF');
    await settle();

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
    expect(report.create.mock.lastCall?.[0]).toHaveProperty(
      'url',
      expect.stringContaining('report')
    );
    click.mockRestore();
  });

  it('keeps the panel usable when the PDF report tab cannot open', async () => {
    const report = stubReportTab();
    report.create.mockRejectedValue(new Error('blocked'));
    sendMessage.mockResolvedValue(snapshot(makeResult(), { detected: true }));
    await mount(Panel);
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Export PDF');
    });

    await clickButton('Export PDF');
    await settle();

    await vi.waitFor(() => {
      expect(report.remove).toHaveBeenCalled();
    });
    expect(host.querySelector('[class*="errorBanner"]')).toBeNull();
  });
});

describe('popup result states', () => {
  it('offers another attempt when the scan found no SDK', async () => {
    sendMessage.mockResolvedValue(
      snapshot(makeScanResult({ tabId: 3, sdkPresence: { detected: false, source: 'none' } }))
    );
    await mount(Popup);

    await vi.waitFor(() => {
      expect(host.textContent).toContain('Attempt Scan');
    });
    await clickButton('Attempt Scan');
    expect(host.textContent).toContain('Scanning…');
  });

  it('exports a PDF report and lists notices, compliance reasons, and the environment', async () => {
    const report = stubReportTab();
    sendMessage.mockResolvedValue(
      snapshot(
        makeScanResult({
          tabId: 3,
          payload: makeAdyenPayload({}, { environment: 'live-in', clientKey: 'live_KEY' }),
          checks: [
            {
              id: 'security-referrer-policy',
              category: 'security',
              severity: 'notice',
              title: 'Referrer-Policy header is not set.',
            },
          ],
          standardCompliance: { compliant: false, reasons: ['Sessions flow not detected.'] },
        }),
        { detected: true }
      )
    );
    await mount(Popup);
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Notices');
    });

    expect(host.textContent).toContain('Referrer-Policy header is not set.');
    expect(host.textContent).toContain('Sessions flow not detected.');
    expect(host.querySelector('[class*="badgeLive"]')?.textContent).toBe('live-in');

    await clickButton('Export PDF');
    await settle();
    expect(report.create).toHaveBeenCalled();
  });
});

describe('popup compliance and export failures', () => {
  it('shows a met Standard Drop-in assessment and survives a failed PDF export', async () => {
    const report = stubReportTab();
    report.create.mockRejectedValue(new Error('blocked'));
    sendMessage.mockResolvedValue(
      snapshot(makeScanResult({ tabId: 3, standardCompliance: { compliant: true, reasons: [] } }), {
        detected: true,
      })
    );
    await mount(Popup);
    await vi.waitFor(() => {
      expect(host.querySelector('[class*="iconCompliant"]')?.textContent).toBe('\u2713');
    });

    await clickButton('Export PDF');
    await settle();

    await vi.waitFor(() => {
      expect(report.remove).toHaveBeenCalled();
    });
    expect(host.textContent).toContain('Re-run Scan');
  });
});
