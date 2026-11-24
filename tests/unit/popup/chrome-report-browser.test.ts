import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { chromeReportBrowser } from '../../../src/popup/components/chrome-report-browser';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubChrome(getManifest: () => { version: string } = () => ({ version: '1.4.0' })): {
  session: Record<string, ReturnType<typeof vi.fn>>;
  create: ReturnType<typeof vi.fn>;
} {
  const session = {
    get: vi.fn().mockResolvedValue({ 'pdf-report:t': 'stored' }),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const create = vi.fn().mockResolvedValue({ id: 9 });
  vi.stubGlobal('chrome', {
    storage: { session },
    tabs: { create },
    runtime: { getURL: (path: string) => `chrome-extension://id/${path}`, getManifest },
  });
  return { session, create };
}

describe('chromeReportBrowser', () => {
  it('reads, writes and removes session storage', async () => {
    const { session } = stubChrome();

    await chromeReportBrowser.write({ 'pdf-report:t': 'stored' });
    await expect(chromeReportBrowser.read('pdf-report:t')).resolves.toBe('stored');
    await chromeReportBrowser.remove('pdf-report:t');

    expect(session['set']).toHaveBeenCalledWith({ 'pdf-report:t': 'stored' });
    expect(session['get']).toHaveBeenCalledWith('pdf-report:t');
    expect(session['remove']).toHaveBeenCalledWith('pdf-report:t');
  });

  it('opens an extension page with its query parameters in a new tab', async () => {
    const { create } = stubChrome();

    await chromeReportBrowser.openExtensionPage('report/report.html', { token: 'a b' });

    expect(create).toHaveBeenCalledWith({
      url: 'chrome-extension://id/report/report.html?token=a+b',
    });
  });

  it('downloads text through a temporary object URL', () => {
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
    vi.useFakeTimers({ toFake: ['setTimeout'] });

    chromeReportBrowser.download('report.json', '{}', 'application/json');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    vi.useRealTimers();

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click.mock.contexts[0]).toMatchObject({ download: 'report.json', href: 'blob:report' });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });

  it('reads the token, clock, and extension version, or Unknown without a manifest', () => {
    stubChrome();
    expect(chromeReportBrowser.newToken()).toMatch(/^[\da-f-]{36}$/);
    expect(chromeReportBrowser.now()).toBeGreaterThan(0);
    expect(chromeReportBrowser.extensionVersion()).toBe('1.4.0');

    stubChrome(() => {
      throw new Error('Extension context invalidated.');
    });
    expect(chromeReportBrowser.extensionVersion()).toBe('Unknown');
  });
});
