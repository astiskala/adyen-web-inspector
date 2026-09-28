import { describe, expect, it } from 'vitest';
import { readPagePolicy } from '../../../src/background/checks/page-policy';
import { makeHeader, makeScanPayload } from '../../fixtures/makeScanPayload';

function policyFor(...csp: string[]): ReturnType<typeof readPagePolicy> {
  return readPagePolicy(
    makeScanPayload({
      pageUrl: 'https://merchant.example/checkout',
      mainDocumentHeaders: csp.map((value) => makeHeader('Content-Security-Policy', value)),
    })
  );
}

describe('readPagePolicy', () => {
  it('reports unavailable headers and absent policies', () => {
    expect(readPagePolicy(makeScanPayload({ mainDocumentHeadersAvailable: false }))).toEqual({
      status: 'unavailable',
    });
    expect(policyFor()).toEqual({ status: 'absent' });
    expect(policyFor(' , ')).toEqual({ status: 'absent' });
  });

  it('allows a URL only when every enforced policy allows it', () => {
    const policy = policyFor(
      'connect-src https://checkoutshopper-live.adyen.com',
      "img-src 'self', connect-src *"
    );
    if (policy.status !== 'enforced') throw new Error('Expected an enforced policy');

    expect(policy.allows('connect-src', 'https://checkoutshopper-live.adyen.com/v1/')).toBe(true);
    expect(policy.allows('connect-src', 'https://checkoutanalytics-live.adyen.com/v3/')).toBe(
      false
    );
  });

  it('exposes governing sources, restrictive policies and declared directives', () => {
    const policy = policyFor("default-src 'self'; report-to csp", 'frame-src *');
    if (policy.status !== 'enforced') throw new Error('Expected an enforced policy');

    expect(policy.governing('frame-src').map((governing) => governing?.directive)).toEqual([
      'default-src',
      'frame-src',
    ]);
    expect(policy.restrictive('frame-src')).toEqual({
      directive: 'default-src',
      sources: ["'self'"],
    });
    expect(policy.governing('form-action')).toEqual([null, null]);
    expect(policy.restrictive('form-action')).toBeUndefined();
    expect(policy.declares('report-to')).toBe(true);
    expect(policy.declares('frame-ancestors')).toBe(false);
  });
});
