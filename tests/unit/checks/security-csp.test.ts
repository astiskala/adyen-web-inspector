import { describe, it, expect } from 'vitest';
import { CSP_CHECKS } from '../../../src/background/checks/security-csp';
import { makeScanPayload, makeHeader } from '../../fixtures/makeScanPayload';
import { requireCheck } from './requireCheck';

const cspPresent = requireCheck(CSP_CHECKS, 'security-csp-present');
const cspScriptSrc = requireCheck(CSP_CHECKS, 'security-csp-script-src');
const cspFrameSrc = requireCheck(CSP_CHECKS, 'security-csp-frame-src');
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
});

describe('csp-script-src', () => {
  it('passes when Adyen CDN is in script-src', () => {
    const payload = makeScanPayload({
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
      mainDocumentHeaders: [
        makeHeader(
          'content-security-policy',
          "default-src 'self' https://checkoutshopper-live.adyen.com"
        ),
      ],
    });
    expect(cspScriptSrc.run(payload).severity).toBe('pass');
  });

  it('warns when Adyen CDN is missing from script-src', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [makeHeader('content-security-policy', "default-src 'self'")],
    });
    const result = cspScriptSrc.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.detail).toContain('PCI compliance');
  });

  it('warns when script-src contains lookalike domains but not Adyen', () => {
    const payload = makeScanPayload({
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

  it('warns when no explicit frame-src or child-src is set', () => {
    const payload = makeScanPayload({
      mainDocumentHeaders: [
        makeHeader('content-security-policy', "default-src 'self' https://*.adyen.com"),
      ],
    });
    expect(cspFrameSrc.run(payload).severity).toBe('warn');
  });

  it('returns skip when no CSP present', () => {
    const payload = makeScanPayload({ mainDocumentHeaders: [] });
    expect(cspFrameSrc.run(payload).severity).toBe('skip');
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
