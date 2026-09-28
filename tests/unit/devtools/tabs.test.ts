import { h, render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { NetworkTab, SkippedChecksTab, SecurityTab } from '../../../src/devtools/panel/tabs';
import type { ScanResult } from '../../../src/shared/types';
import { makeScanPayload } from '../../fixtures/makeScanPayload';

const host = document.createElement('div');

afterEach(() => {
  render(null, host);
});

function makeResult(): ScanResult {
  return {
    tabId: 1,
    pageUrl: 'https://example.com/checkout',
    scannedAt: '2026-09-28T00:00:00.000Z',
    checks: [
      {
        id: '3p-no-sri',
        category: 'third-party',
        severity: 'skip',
        title: 'Third-party SRI — No scripts detected.',
      },
      {
        id: 'security-sri-css',
        category: 'security',
        severity: 'warn',
        title: 'CSS integrity missing',
      },
    ],
    health: { score: 80, passing: 4, failing: 0, warnings: 1, total: 5, tier: 'issues' },
    standardCompliance: { compliant: false, reasons: [] },
    payload: makeScanPayload({
      capturedRequests: [
        { url: 'https://example.com/metrics', type: 'other', responseHeaders: [], statusCode: 200 },
        {
          url: 'https://checkoutshopper-test.adyen.com/collect',
          type: 'other',
          responseHeaders: [],
          statusCode: 200,
        },
      ],
    }),
  };
}

describe('DevTools finding views', () => {
  it('renders normalized skip reasons from the same projection as exports', () => {
    render(h(SkippedChecksTab, { result: makeResult() }), host);
    expect(host.textContent).toContain('Third-party SRI');
    expect(host.textContent).toContain('No scripts detected.');
    expect(host.textContent).not.toContain('Third-party SRI —');
  });

  it('filters captured requests and groups security findings with the shared rules', () => {
    const result = makeResult();
    render(h(NetworkTab, { result }), host);
    expect(host.textContent).toContain('checkoutshopper-test.adyen.com/collect');
    expect(host.textContent).not.toContain('example.com/metrics');

    render(h(SecurityTab, { result }), host);
    expect(host.textContent).toContain('High impact');
    expect(host.textContent).toContain('CSS integrity missing');
  });
});
