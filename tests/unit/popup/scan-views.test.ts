import { h, render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { Panel } from '../../../src/devtools/panel/Panel';
import { Popup } from '../../../src/popup/PopupApp';
import type { CheckoutActivity, TabScanStatus, TabSnapshot } from '../../../src/shared/messages';
import type { ScanResult } from '../../../src/shared/types';
import { makeAdyenPayload, makeScanPayload, makeScanResult } from '../../fixtures/makeScanPayload';

interface Message {
  readonly type: string;
  readonly tabId: number;
  readonly snapshot: TabSnapshot;
}

const harness = {} as {
  host: HTMLDivElement;
  listener: ((message: Message) => void) | undefined;
  sendMessage: ReturnType<typeof vi.fn>;
};

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
    harness.listener?.({ type: 'TAB_STATE_CHANGED', tabId: 3, snapshot: tabSnapshot });
    await Promise.resolve();
  });
}

function findButton(label: string): HTMLButtonElement | undefined {
  return [...harness.host.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
}

async function clickButton(label: string): Promise<void> {
  const button = findButton(label);
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
}

async function mount(View: () => JSX.Element): Promise<void> {
  await act(async () => {
    render(h(View, {}), harness.host);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  globalThis.localStorage.clear();
  harness.host = document.createElement('div');
  document.body.append(harness.host);
  harness.listener = undefined;
  harness.sendMessage = vi.fn().mockResolvedValue(null);
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn().mockResolvedValue([{ id: 3 }]) },
    devtools: { inspectedWindow: { tabId: 3 } },
    runtime: {
      getManifest: () => ({ version: '1.5.0' }),
      sendMessage: harness.sendMessage,
      onMessage: {
        addListener: vi.fn((function_: (message: Message) => void) => {
          harness.listener = function_;
        }),
        removeListener: vi.fn(),
      },
    },
  });
});

afterEach(async () => {
  await act(() => {
    render(null, harness.host);
  });
  harness.host.remove();
  vi.unstubAllGlobals();
});

describe('scan views', () => {
  it('stores detail and theme changes and restores focus after settings', async () => {
    await mount(Popup);
    const select = async (input: HTMLInputElement | null): Promise<void> => {
      await act(() => {
        input?.click();
      });
    };

    const settingsButton = (): HTMLButtonElement | null =>
      harness.host.querySelector<HTMLButtonElement>('button[aria-label="Settings"]');
    await act(() => {
      settingsButton()?.click();
    });
    const focused = document.activeElement;
    expect(focused?.textContent.trim()).toBe('Back');
    expect(harness.host.querySelector('h1')?.textContent).toBe('Settings');

    const theme = (name: string): HTMLInputElement | null =>
      [...harness.host.querySelectorAll<HTMLInputElement>('input[name="theme"]')].find(
        (input) => input.value === name
      ) ?? null;
    expect(theme('system')?.checked).toBe(true);
    await select(theme('light'));
    expect(document.documentElement.dataset['theme']).toBe('light');
    await select(theme('dark'));
    expect(document.documentElement.dataset['theme']).toBe('dark');

    const details = harness.host.querySelectorAll<HTMLInputElement>('input[name="detail"]');
    expect(details[0]?.checked).toBe(true);
    await select(details[1] ?? null);
    expect(details[1]?.checked).toBe(true);
    await clickButton('Back');
    expect(document.activeElement).toBe(settingsButton());
    await publish(snapshot(makeResult()));
    expect(harness.host.textContent).toContain('Implementation attributes');

    await act(() => {
      settingsButton()?.click();
    });
    await select(harness.host.querySelector<HTMLInputElement>('input[name="detail"]'));
    await clickButton('Back');
    expect(harness.host.textContent).not.toContain('Implementation attributes');

    await act(() => {
      globalThis.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    });
    expect(document.documentElement.dataset['theme']).toBe('dark');

    for (const value of ['light', 'dark', 'system']) {
      await act(() => {
        globalThis.localStorage.setItem('inspector-theme', value);
        globalThis.dispatchEvent(new StorageEvent('storage', { key: 'inspector-theme' }));
      });
      expect(document.documentElement.dataset['theme']).toBe(value);
    }
  });

  it('keeps the popup version gate and shows a completed scan', async () => {
    harness.sendMessage.mockResolvedValue(snapshot(null, { detected: true, version: '5.67.0' }));
    await mount(Popup);
    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Adyen Web version outdated');
    });

    await publish(snapshot(makeResult()));
    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Re-run scan');
    });
  });

  it('shows a Scan already running when the popup opens', async () => {
    harness.sendMessage.mockResolvedValue(snapshot(null, { detected: true }, { state: 'running' }));
    await mount(Popup);

    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Scanning…');
    });
    const button = [...harness.host.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Scanning…'
    );
    expect(button?.disabled).toBe(true);
  });

  it('offers a scan when the detector saw checkout activity on a supported version', async () => {
    harness.sendMessage.mockResolvedValue(snapshot(null, { detected: true, version: '6.31.0' }));
    await mount(Popup);

    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Adyen Web SDK detected');
    });
    expect(harness.host.textContent).toContain('Run scan');
    expect(harness.host.textContent).not.toContain('Export PDF');
  });

  it('offers an attempt scan when no checkout activity was detected', async () => {
    await mount(Popup);

    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Adyen not detected');
    });
    expect(harness.host.textContent).toContain('Attempt scan');
  });

  it('shows the scan error view with a retry after a failed scan', async () => {
    await mount(Popup);
    await publish(snapshot(null, undefined, { state: 'failed', error: 'Blocked page' }));

    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Scan failed');
    });
    expect(harness.host.textContent).toContain('Try again');
  });

  it('shows check titles but omits impact labels in Essential', async () => {
    harness.sendMessage.mockResolvedValue(
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
      expect(harness.host.textContent).toContain('Missing country');
    });
    expect(harness.host.textContent).not.toContain('High impact');
  });

  it.each([
    ['popup', Popup, null],
    ['DevTools panel', Panel, 'Best practices'],
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
      const documentationUrl = 'https://docs.adyen.com/online-payments/web-best-practices/';
      harness.sendMessage.mockResolvedValue(snapshot(withoutGuidance, { detected: true }));

      globalThis.localStorage.setItem('inspector-detail', 'detailed');
      await mount(View);
      if (tab !== null) await clickButton(tab);
      await vi.waitFor(() => {
        expect(harness.host.textContent).toContain(remediation);
      });
      expect([...harness.host.querySelectorAll('a')].map((link) => link.href)).toContain(
        documentationUrl
      );
    }
  );

  it('uses the scan verdict for SDK presence in the DevTools panel', async () => {
    const noSdk = makeScanResult({ payload: makeScanPayload({ tabId: 3 }) });
    harness.sendMessage.mockResolvedValue(snapshot(noSdk));
    await mount(Panel);

    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Adyen Web SDK was not detected on this page.');
    });
    expect(
      [...harness.host.querySelectorAll('button')].find(
        (button) => button.textContent.trim() === 'Export JSON'
      )?.disabled
    ).toBe(true);
  });

  it('renders every DevTools panel tab for a detected result', async () => {
    harness.sendMessage.mockResolvedValue(
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
      expect(harness.host.textContent).toContain('Export JSON');
    });

    const tabs = [
      ['Best practices', 'No locale was configured.'],
      ['Security', 'HTTPS in use'],
      ['Skipped checks', 'No third-party scripts.'],
      ['Network', 'No Adyen requests captured.'],
      ['Extracted config', 'No inferred config captured.'],
      ['Overview', 'Implementation attributes'],
    ] as const;
    for (const [tab, text] of tabs) {
      await clickButton(tab);
      expect(harness.host.textContent).toContain(text);
    }

    // Tabs follow the WAI-ARIA tabs pattern: one selected tab in the tab order, arrow keys move.
    const selected = (): HTMLElement | null =>
      harness.host.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    const press = async (key: string): Promise<void> => {
      await act(async () => {
        selected()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await Promise.resolve();
      });
    };
    expect(selected()?.textContent).toBe('Overview');
    expect(harness.host.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(
      selected()?.id
    );
    await press('ArrowLeft');
    expect(selected()?.textContent).toBe('Extracted config');
    expect(document.activeElement).toBe(selected());
    await press('ArrowRight');
    await press('End');
    expect(selected()?.textContent).toBe('Extracted config');
    await press('Home');
    await press('Enter');
    expect(selected()?.textContent).toBe('Overview');
    expect(
      [...harness.host.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
        (tab) => tab.tabIndex === 0
      )
    ).toHaveLength(1);
  });

  it('preserves DevTools context-invalidation wording after a rejected scan request', async () => {
    await mount(Panel);
    harness.sendMessage.mockRejectedValueOnce(new Error('Extension context invalidated'));
    const button = [...harness.host.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Run scan'
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Reload the extension');
    });
  });
});

interface ReportTabStubs {
  readonly create: ReturnType<typeof vi.fn>;
  readonly remove: ReturnType<typeof vi.fn>;
}

/**
Adds what the PDF export needs to the stubbed chrome global.
*/
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
  it('offers a scan on a detected checkout and disables exports until results exist', async () => {
    harness.sendMessage.mockResolvedValue(snapshot(null, { detected: true }));
    await mount(Panel);
    await vi.waitFor(() => {
      expect(harness.host.querySelector('h2')?.textContent).toBe('Adyen Web SDK detected');
    });
    const exports = [...harness.host.querySelectorAll('button')].filter((button) =>
      button.textContent.trim().startsWith('Export ')
    );
    expect(exports.map((button) => button.disabled)).toEqual([true, true]);
  });

  it.each([
    ['a failed scan without a message', '', 'Scan failed. Try reloading the page.'],
    ['a failed scan with its message', 'Blocked page', 'Blocked page'],
  ])('explains %s', async (_label, error, message) => {
    harness.sendMessage.mockResolvedValue(snapshot(null, undefined, { state: 'failed', error }));
    await mount(Panel);

    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain(message);
    });
  });

  it('explains a scan request the runtime rejected', async () => {
    await mount(Panel);
    harness.sendMessage.mockRejectedValueOnce(new Error('offline'));

    await clickButton('Run scan');
    await settle();

    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Unable to start scan. Try reloading the page.');
    });
  });

  it('explains a runtime that cannot be reached', async () => {
    harness.sendMessage.mockRejectedValue(new Error('offline'));
    await mount(Panel);

    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain(
        'Unable to communicate with the extension runtime.'
      );
    });
  });

  it('explains a panel without an inspected tab', async () => {
    (globalThis.chrome as unknown as { devtools: unknown }).devtools = {
      inspectedWindow: { tabId: undefined },
    };
    await mount(Panel);

    await clickButton('Run scan');
    await settle();

    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain(
        'Unable to communicate with the extension runtime.'
      );
    });
  });

  it('shows a Scan in progress before any result', async () => {
    harness.sendMessage.mockResolvedValue(snapshot(null, undefined, { state: 'running' }));
    await mount(Panel);

    await vi.waitFor(() => {
      expect(harness.host.querySelector('h2')?.textContent).toBe('Scanning this page…');
    });
    const button = [...harness.host.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Scanning…'
    );
    expect(button?.disabled).toBe(true);
  });

  it.each([
    ['Copied', vi.fn().mockResolvedValue(undefined)],
    ['Could not copy', vi.fn().mockRejectedValue(new Error('Clipboard unavailable'))],
  ])('shows %s after copying captured configuration', async (message, writeText) => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, 'clipboard');
    });
    harness.sendMessage.mockResolvedValue(snapshot(makeResult()));
    await mount(Panel);
    await vi.waitFor(() => {
      expect(
        harness.host.querySelector<HTMLButtonElement>('button[aria-selected="true"]')?.textContent
      ).toBe('Overview');
    });
    await clickButton('Extracted config');
    await act(async () => {
      harness.host
        .querySelector<HTMLButtonElement>('button[aria-label="Copy Captured Checkout Fields"]')
        ?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(harness.host.querySelector('pre')?.textContent);
    expect(harness.host.textContent).toContain(message);
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
    harness.sendMessage.mockResolvedValue(snapshot(makeResult(), { detected: true }));
    await mount(Panel);
    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Export JSON');
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
    harness.sendMessage.mockResolvedValue(snapshot(makeResult(), { detected: true }));
    await mount(Panel);
    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Export PDF');
    });

    await clickButton('Export PDF');
    await settle();

    await vi.waitFor(() => {
      expect(report.remove).toHaveBeenCalled();
    });
    expect(harness.host.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not open the report'
    );
  });
});

describe('popup result states', () => {
  it('offers another attempt when the scan found no SDK', async () => {
    const noSdk = makeScanResult({ payload: makeScanPayload({ tabId: 3 }) });
    harness.sendMessage.mockResolvedValue(snapshot(noSdk));
    await mount(Popup);

    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Attempt scan');
    });
    await clickButton('Attempt scan');
    expect(harness.host.textContent).toContain('Scanning…');
  });

  it('opens a full report and lists notices, compliance reasons, and the environment in Detailed', async () => {
    const report = stubReportTab();
    globalThis.localStorage.setItem('inspector-detail', 'detailed');
    const payload = makeAdyenPayload({}, { environment: 'live-in', clientKey: 'live_KEY' });
    harness.sendMessage.mockResolvedValue(
      snapshot(
        makeScanResult({
          tabId: 3,
          payload,
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
      expect(harness.host.textContent).toContain('Notice');
    });

    expect(harness.host.textContent).toContain('Referrer-Policy header is not set.');
    expect(harness.host.textContent).toContain('Sessions flow not detected.');
    expect([...harness.host.querySelectorAll('dd')].map((item) => item.textContent)).toContain(
      'live-in'
    );

    await clickButton('Open full report');
    await settle();
    expect(report.create).toHaveBeenCalled();
  });

  it('returns focus to the scan action when a scan the user started finishes', async () => {
    harness.sendMessage.mockResolvedValue(snapshot(makeResult(), { detected: true }));
    await mount(Popup);
    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Re-run scan');
    });

    findButton('Re-run scan')?.focus();
    await clickButton('Re-run scan');
    expect(harness.host.textContent).toContain('Scanning this page');
    expect(document.activeElement).toBe(document.body);

    await publish(snapshot(makeResult(), { detected: true }));
    expect(findButton('Re-run scan')).toBeDefined();
    expect(document.activeElement).toBe(findButton('Re-run scan'));
  });

  it('leaves focus alone when it moved during the scan or the next view has no scan action', async () => {
    await mount(Popup);
    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Attempt scan');
    });

    await clickButton('Attempt scan');
    const settings = harness.host.querySelector<HTMLButtonElement>('button[aria-label="Settings"]');
    settings?.focus();
    await publish(snapshot(makeResult(), { detected: true }));
    expect(document.activeElement).toBe(settings);

    findButton('Re-run scan')?.focus();
    await clickButton('Re-run scan');
    await publish(snapshot(null, { detected: true, version: '5.67.0' }));
    expect(harness.host.textContent).toContain('Adyen Web version outdated');
    expect(document.activeElement).toBe(document.body);
  });
});

describe('popup compliance and export failures', () => {
  it('shows a met Standard Drop-in assessment and survives a failed report opening', async () => {
    const report = stubReportTab();
    report.create.mockRejectedValue(new Error('blocked'));
    harness.sendMessage.mockResolvedValue(
      snapshot(makeScanResult({ tabId: 3, standardCompliance: { compliant: true, reasons: [] } }), {
        detected: true,
      })
    );
    await mount(Popup);
    await vi.waitFor(() => {
      expect(harness.host.textContent).toContain('Standard Drop-in frontend criteria met');
    });

    await clickButton('Open full report');
    await settle();

    await vi.waitFor(() => {
      expect(report.remove).toHaveBeenCalled();
    });
    expect(harness.host.textContent).toContain('Re-run scan');
    expect(harness.host.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not open the report'
    );
  });
});
