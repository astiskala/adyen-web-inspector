import { describe, it, expect } from 'vitest';
import { CSP_CHECKS } from '../../../src/background/checks/security-csp';
import type { CheckoutConfig, ScanPayload } from '../../../src/shared/types';
import {
  makeCheckoutConfig,
  makeScanPayload,
  makeHeader,
  makeCheckoutPage,
} from '../../fixtures/makeScanPayload';
import { requireCheck } from './requireCheck';

const cspPresent = requireCheck(CSP_CHECKS, 'security-csp-present');
const cspScriptSrc = requireCheck(CSP_CHECKS, 'security-csp-script-src');
const cspFrameSrc = requireCheck(CSP_CHECKS, 'security-csp-frame-src');
const cspConnectSrc = requireCheck(CSP_CHECKS, 'security-csp-connect-src');
const cspImgSrc = requireCheck(CSP_CHECKS, 'security-csp-img-src');
const cspFormAction = requireCheck(CSP_CHECKS, 'security-csp-form-action');
const cspFrameAncestors = requireCheck(CSP_CHECKS, 'security-csp-frame-ancestors');
const cspReporting = requireCheck(CSP_CHECKS, 'security-csp-reporting');

describe('csp-present', () => {
  it('passes when CSP header is present', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [
        makeHeader(
          'content-security-policy',
          "default-src 'self'; script-src 'self' https://checkoutshopper-test.adyen.com"
        ),
      ],
    });
    expect(cspPresent.run(payload).severity).toBe('pass');
  });

  it('warns when no CSP header', () => {
    const payload = makeScanPayload({ mainDocumentHeaders: [] });
    const result = cspPresent.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.detail).toContain('PCI compliance');
  });

  it('skips CSP checks when response headers could not be captured', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [],
      mainDocumentHeadersAvailable: false,
    });
    expect(cspPresent.run(payload).severity).toBe('skip');
    expect(cspScriptSrc.run(payload).severity).toBe('skip');
    expect(cspFrameAncestors.run(payload).severity).toBe('skip');
    expect(cspReporting.run(payload).severity).toBe('skip');
  });
});

describe('csp-script-src', () => {
  const page = makeCheckoutPage({
    scripts: [{ src: 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk.js' }],
  });

  it('passes when Adyen CDN is in script-src', () => {
    const payload = makeScanPayload({
      page,
      mainDocumentHeaders: [
        makeHeader(
          'content-security-policy',
          "script-src 'self' https://checkoutshopper-test.adyen.com"
        ),
      ],
    });
    expect(cspScriptSrc.run(payload).severity).toBe('pass');
  });

  it('passes when Adyen CDN is in default-src', () => {
    const payload = makeScanPayload({
      page,
      mainDocumentHeaders: [
        makeHeader(
          'content-security-policy',
          "default-src 'self' https://checkoutshopper-test.adyen.com"
        ),
      ],
    });
    expect(cspScriptSrc.run(payload).severity).toBe('pass');
  });

  it('warns when Adyen CDN is missing from script-src', () => {
    const payload = makeScanPayload({
      page,
      mainDocumentHeaders: [makeHeader('content-security-policy', "default-src 'self'")],
    });
    const result = cspScriptSrc.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.detail).toContain('PCI compliance');
  });

  it('warns when script-src contains lookalike domains but not Adyen', () => {
    const payload = makeScanPayload({
      page,
      mainDocumentHeaders: [
        makeHeader('content-security-policy', "script-src 'self' https://notadyen.com"),
      ],
    });
    expect(cspScriptSrc.run(payload).severity).toBe('warn');
  });

  it('returns skip when no CSP present', () => {
    const payload = makeScanPayload({ mainDocumentHeaders: [] });
    expect(cspScriptSrc.run(payload).severity).toBe('skip');
  });

  it('honors explicit script-src over an allowing default-src', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        scripts: [{ src: 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk.js' }],
      }),
      mainDocumentHeaders: [
        makeHeader('content-security-policy', "default-src https:; script-src 'self'"),
      ],
    });
    expect(cspScriptSrc.run(payload).severity).toBe('warn');
  });

  it('requires each enforced CSP header to allow the observed Adyen script', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        scripts: [{ src: 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk.js' }],
      }),
      mainDocumentHeaders: [
        makeHeader('content-security-policy', 'script-src https://*.adyen.com'),
        makeHeader('content-security-policy', "script-src 'self'"),
      ],
    });
    expect(cspScriptSrc.run(payload).severity).toBe('warn');
  });

  it('requires all policies in a combined CSP header to allow the script', () => {
    const payload = makeScanPayload({
      page,
      mainDocumentHeaders: [
        makeHeader('content-security-policy', "script-src https://*.adyen.com, script-src 'self'"),
      ],
    });
    expect(cspScriptSrc.run(payload).severity).toBe('warn');
  });

  it('skips the Adyen CDN script requirement for npm-only pages', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({
        adyenMetadata: { version: '6.31.0' },
        scripts: [{ src: 'https://merchant.example/app.js' }],
      }),
      mainDocumentHeaders: [makeHeader('content-security-policy', "script-src 'self'")],
    });
    expect(cspScriptSrc.run(payload).severity).toBe('skip');
  });
});

describe('csp-frame-src', () => {
  it('passes when frame-src wildcard is configured', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [makeHeader('content-security-policy', 'frame-src *')],
    });
    expect(cspFrameSrc.run(payload).severity).toBe('pass');
  });

  it('passes when frame-src allows all HTTPS origins', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [makeHeader('content-security-policy', 'frame-src https:')],
    });
    expect(cspFrameSrc.run(payload).severity).toBe('pass');
  });

  it('warns when frame-src is restrictive', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [
        makeHeader('content-security-policy', "frame-src 'self' https://*.adyen.com"),
      ],
    });
    const result = cspFrameSrc.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.detail).toContain('PCI compliance');
  });

  it('warns that a restrictive inherited default-src blocks issuer iframes', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [
        makeHeader('content-security-policy', "default-src 'self' https://*.adyen.com"),
      ],
    });
    const result = cspFrameSrc.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.title).toBe('CSP frame-src may be too restrictive for 3DS issuer iframes.');
    expect(result.detail).toContain('inherit a default-src');
  });

  it('warns that frame-src is not explicit when default-src allows HTTPS', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [makeHeader('content-security-policy', 'default-src https:')],
    });
    const result = cspFrameSrc.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.title).toBe('CSP frame-src/child-src is not explicitly set.');
  });

  it('warns that frame-src is not explicit when the policy has no fetch fallback', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [makeHeader('content-security-policy', "script-src 'self'")],
    });
    expect(cspFrameSrc.run(payload).title).toBe('CSP frame-src/child-src is not explicitly set.');
  });

  it('passes when child-src allows HTTPS iframes', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [
        makeHeader('content-security-policy', "default-src 'self'; child-src https:"),
      ],
    });
    expect(cspFrameSrc.run(payload).severity).toBe('pass');
  });

  it('returns skip when no CSP present', () => {
    const payload = makeScanPayload({ mainDocumentHeaders: [] });
    expect(cspFrameSrc.run(payload).severity).toBe('skip');
  });

  it('returns skip when response headers could not be captured', () => {
    const payload = makeScanPayload({ mainDocumentHeadersAvailable: false });
    expect(cspFrameSrc.run(payload).severity).toBe('skip');
  });
});

function withCsp(policy: string, config: Partial<CheckoutConfig> = {}): ScanPayload {
  return makeScanPayload({
    page: makeCheckoutPage({
      checkoutConfig: makeCheckoutConfig(config),
      checkoutConfigComplete: true,
    }),
    mainDocumentHeaders: [makeHeader('content-security-policy', policy)],
  });
}

describe('csp-connect-src', () => {
  it('passes when connect-src allows the Adyen origins for the environment', () => {
    const result = cspConnectSrc.run(
      withCsp(
        "connect-src 'self' https://checkoutshopper-test.adyen.com https://checkoutanalytics-test.adyen.com"
      )
    );
    expect(result.severity).toBe('pass');
  });

  it('passes with the Adyen recommended connect-src wildcard', () => {
    expect(cspConnectSrc.run(withCsp("default-src 'self'; connect-src *")).severity).toBe('pass');
  });

  it('warns and lists blocked origins when default-src is restrictive', () => {
    const result = cspConnectSrc.run(withCsp("default-src 'self'"));
    expect(result.severity).toBe('warn');
    expect(result.detail).toContain('https://checkoutshopper-test.adyen.com (checkout API)');
    expect(result.detail).toContain(
      'https://checkoutanalytics-test.adyen.com (checkout analytics)'
    );
    expect(result.detail).not.toContain('translations');
  });

  it('requires the regional analytics origin for regional live environments', () => {
    const result = cspConnectSrc.run(
      withCsp('connect-src https://checkoutshopper-live-us.adyen.com', { environment: 'live-us' })
    );
    expect(result.severity).toBe('warn');
    expect(result.detail).toContain('https://checkoutanalytics-live-us.adyen.com');
    expect(result.detail).not.toContain('checkoutshopper-live-us.adyen.com (checkout API)');
  });

  it('resolves environment names case-insensitively', () => {
    const result = cspConnectSrc.run(withCsp("connect-src 'self'", { environment: 'LIVE-AU' }));
    expect(result.detail).toContain('https://checkoutshopper-live-au.adyen.com');
  });

  it('falls back to the default live endpoints for unknown environment names', () => {
    const result = cspConnectSrc.run(withCsp("connect-src 'self'", { environment: 'production' }));
    expect(result.detail).toContain('https://checkoutshopper-live.adyen.com');
  });

  it('requires the CDN origin when a non-English locale loads CDN translations', () => {
    const result = cspConnectSrc.run(
      withCsp(
        'connect-src https://checkoutshopper-test.adyen.com https://checkoutanalytics-test.adyen.com',
        { locale: 'nl-NL' }
      )
    );
    expect(result.severity).toBe('warn');
    expect(result.detail).toContain('https://checkoutshopper-test.cdn.adyen.com (translations)');
  });

  it('uses the test environment from client key evidence when config has no environment', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({ inferredConfig: { clientKey: 'test_ABCDEFGHIJK' } }),
      mainDocumentHeaders: [makeHeader('content-security-policy', "connect-src 'self'")],
    });
    const result = cspConnectSrc.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.detail).toContain('https://checkoutshopper-test.adyen.com');
  });

  it('skips when the environment cannot be determined', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [makeHeader('content-security-policy', "connect-src 'self'")],
    });
    expect(cspConnectSrc.run(payload)).toMatchObject({
      severity: 'skip',
      detail: 'The Adyen Web environment could not be determined.',
    });
  });

  it('skips without a CSP or captured headers', () => {
    expect(cspConnectSrc.run(makeScanPayload()).severity).toBe('skip');
    expect(
      cspConnectSrc.run(makeScanPayload({ mainDocumentHeadersAvailable: false })).severity
    ).toBe('skip');
  });
});

describe('csp-img-src', () => {
  it('passes when img-src allows the Adyen CDN', () => {
    expect(
      cspImgSrc.run(withCsp("img-src 'self' https://checkoutshopper-test.cdn.adyen.com")).severity
    ).toBe('pass');
  });

  it('passes when img-src is not restricted by the policy', () => {
    expect(cspImgSrc.run(withCsp("script-src 'self'")).severity).toBe('pass');
  });

  it('warns with low impact when default-src blocks Adyen logos', () => {
    const result = cspImgSrc.run(withCsp("default-src 'self'", { environment: 'live-apse' }));
    expect(result).toMatchObject({ severity: 'warn', impact: 'low' });
    expect(result.detail).toContain('https://checkoutshopper-live-apse.cdn.adyen.com (logos)');
  });

  it('skips when the environment, CSP, or headers are unavailable', () => {
    const noEnvironment = makeScanPayload({
      mainDocumentHeaders: [makeHeader('content-security-policy', "img-src 'self'")],
    });
    expect(cspImgSrc.run(noEnvironment).severity).toBe('skip');
    expect(cspImgSrc.run(makeScanPayload()).severity).toBe('skip');
    expect(cspImgSrc.run(makeScanPayload({ mainDocumentHeadersAvailable: false })).severity).toBe(
      'skip'
    );
  });
});

describe('csp-form-action', () => {
  it('passes when form-action is not set, even with a restrictive default-src', () => {
    const result = cspFormAction.run(withCsp("default-src 'self'"));
    expect(result).toMatchObject({ severity: 'pass', title: 'CSP does not restrict form-action.' });
  });

  it.each(['form-action *', 'form-action https:', "form-action 'self' https:"])(
    'passes when %s allows HTTPS destinations',
    (policy) => {
      expect(cspFormAction.run(withCsp(policy)).title).toBe(
        'CSP form-action allows 3DS and redirect form submissions.'
      );
    }
  );

  it('warns when form-action restricts destinations', () => {
    const result = cspFormAction.run(withCsp("form-action 'self'"));
    expect(result.severity).toBe('warn');
    expect(result.detail).toContain('does not fall back to default-src');
  });

  it('warns when any enforced policy restricts form-action', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [
        makeHeader('content-security-policy', 'form-action *'),
        makeHeader('content-security-policy', "form-action 'self'"),
      ],
    });
    expect(cspFormAction.run(payload).severity).toBe('warn');
  });

  it('skips without a CSP or captured headers', () => {
    expect(cspFormAction.run(makeScanPayload()).severity).toBe('skip');
    expect(
      cspFormAction.run(makeScanPayload({ mainDocumentHeadersAvailable: false })).severity
    ).toBe('skip');
  });
});

describe('csp-frame-ancestors', () => {
  it('passes when frame-ancestors directive is set', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [makeHeader('content-security-policy', "frame-ancestors 'self'")],
    });
    expect(cspFrameAncestors.run(payload).severity).toBe('pass');
  });

  it('passes when X-Frame-Options header is set', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [makeHeader('x-frame-options', 'SAMEORIGIN')],
    });
    expect(cspFrameAncestors.run(payload).severity).toBe('pass');
  });

  it('warns when neither frame-ancestors nor X-Frame-Options present', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [makeHeader('content-security-policy', "default-src 'self'")],
    });
    const result = cspFrameAncestors.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.detail).toContain('clickjacking');
    expect(result.detail).toContain('PCI compliance');
  });

  it('warns when no headers at all', () => {
    const payload = makeScanPayload({ mainDocumentHeaders: [] });
    expect(cspFrameAncestors.run(payload).severity).toBe('warn');
  });
});

describe('csp-reporting', () => {
  it('passes when report-to and Reporting-Endpoints are configured', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [
        makeHeader('content-security-policy', "default-src 'self'; report-to csp-endpoint"),
        makeHeader('reporting-endpoints', 'csp-endpoint="https://example.com/csp-reports"'),
      ],
    });
    expect(cspReporting.run(payload).severity).toBe('pass');
  });

  it('warns when report-to is set but Reporting-Endpoints is missing', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [
        makeHeader('content-security-policy', "default-src 'self'; report-to csp-endpoint"),
      ],
    });
    expect(cspReporting.run(payload).severity).toBe('warn');
  });

  it('returns info when report-uri is configured', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [
        makeHeader(
          'content-security-policy',
          "default-src 'self'; report-uri https://reporting.example.com/csp"
        ),
      ],
    });
    expect(cspReporting.run(payload).severity).toBe('info');
  });

  it('returns info when CSP present but no reporting configured', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [makeHeader('content-security-policy', "default-src 'self'")],
    });
    expect(cspReporting.run(payload).severity).toBe('info');
  });

  it('returns info when no CSP (check skipped)', () => {
    const payload = makeScanPayload({ mainDocumentHeaders: [] });
    expect(cspReporting.run(payload).severity).toBe('info');
  });
});
