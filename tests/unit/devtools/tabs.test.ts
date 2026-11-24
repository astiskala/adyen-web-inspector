import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { NetworkTab, SkippedChecksTab, SecurityTab } from '../../../src/devtools/panel/tabs';
import type { ScanResult } from '../../../src/shared/types';
import { makeScanPayload, makeScanResult } from '../../fixtures/makeScanPayload';

const host = document.createElement('div');

afterEach(async () => {
  await act(() => {
    render(null, host);
  });
});

function makeResult(): ScanResult {
  return makeScanResult({
    checks: [
      {
        id: '3p-no-sri',
        category: 'third-party',
        severity: 'skip',
        title: 'Third-party SRI check skipped.',
        detail: 'No third-party scripts detected.',
      },
      {
        id: 'env-cdn-mismatch',
        category: 'environment',
        severity: 'skip',
        title: 'CDN mismatch check skipped.',
      },
      {
        id: 'security-sri-css',
        category: 'security',
        severity: 'warn',
        title: 'CSS integrity missing',
        impact: 'high',
      },
    ],
    health: { score: 80, passing: 4, failing: 0, warnings: 1, total: 5, tier: 'issues' },
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
  });
}

describe('DevTools finding views', () => {
  it('renders skip reasons from the same projection as exports', () => {
    render(h(SkippedChecksTab, { result: makeResult() }), host);
    const reasons = [...host.querySelectorAll('[class*="skipReason"]')].map((r) => r.textContent);

    expect(host.textContent).toContain('Third-party SRI check skipped.');
    expect(host.textContent).toContain('CDN mismatch check skipped.');
    expect(reasons).toEqual(['No third-party scripts detected.']);
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

describe('DevTools empty and unobserved values', () => {
  it('shows a dash for requests whose status was not observed', () => {
    const result = makeScanResult({
      payload: makeScanPayload({
        capturedRequests: [
          {
            url: 'https://checkoutshopper-test.adyen.com/sdk.js',
            type: 'script',
            responseHeaders: [],
            statusCode: 0,
          },
        ],
      }),
    });

    render(h(NetworkTab, { result }), host);

    expect([...host.querySelectorAll('td')].map((cell) => cell.textContent)).toContain('—');
  });

  it('says so when no check was skipped', () => {
    render(h(SkippedChecksTab, { result: makeScanResult({ checks: [] }) }), host);

    expect(host.textContent).toContain('No checks were skipped.');
  });
});
