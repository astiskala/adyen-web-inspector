/**
 * Security: CSP checks.
 */

import type { ScanPayload, CapturedHeader } from '../../shared/types.js';
import { cspIncludesDomain, getHeader, parseCsp } from '../../shared/utils.js';
import { createRegistry } from './registry.js';

const CATEGORY = 'security' as const;
const ADYEN_CDN = 'adyen.com';
const ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC =
  'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/script-security#implement-a-content-security-policy-for-requirement-6-4-3';
const ADYEN_PCI_DSS_REPORTING_DOC =
  'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/script-security#report';
const PCI_COMPLIANCE_MESSAGE = 'This is required to maintain PCI compliance.';

function withPciComplianceMessage(detail: string): string {
  return `${detail} ${PCI_COMPLIANCE_MESSAGE}`;
}

function getCspHeader(payload: ScanPayload): string | null {
  return getHeader(payload, 'content-security-policy');
}

function allowsAnyHttpsIframeSource(values: string[]): boolean {
  return values.includes('*') || values.includes('https:');
}

export const CSP_CHECKS = createRegistry(CATEGORY)
  .add('security-csp-present', (payload, { pass, warn }) => {
    const cspValue = getCspHeader(payload);
    if (cspValue !== null && cspValue !== '') {
      return pass('Content-Security-Policy header is present.');
    }
    return warn(
      'Content-Security-Policy header is missing.',
      withPciComplianceMessage(
        'A CSP helps prevent XSS and data injection attacks on checkout pages.'
      ),
      'Add a Content-Security-Policy header to your checkout page HTTP response.',
      ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC
    );
  })
  .add('security-csp-script-src', (payload, { skip, pass, warn }) => {
    const cspValue = getCspHeader(payload);
    if (cspValue === null || cspValue === '') {
      return skip('CSP script-src check skipped — no Content-Security-Policy header present.');
    }

    const csp = parseCsp(cspValue);
    const hasAdyen =
      cspIncludesDomain(csp, 'script-src', ADYEN_CDN) ||
      cspIncludesDomain(csp, 'default-src', ADYEN_CDN);

    if (hasAdyen) {
      return pass('CSP script-src includes Adyen CDN domain.');
    }

    return warn(
      'CSP script-src may not include the Adyen CDN domain.',
      withPciComplianceMessage(
        'If script-src omits Adyen domains, checkout assets can be blocked or require unsafe CSP relaxations.'
      ),
      'Update your Content-Security-Policy to include the Adyen CDN script domains.',
      ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC
    );
  })
  .add('security-csp-frame-src', (payload, { skip, warn, pass }) => {
    const cspValue = getCspHeader(payload);
    if (cspValue === null || cspValue === '') {
      return skip('CSP frame-src check skipped — no Content-Security-Policy header present.');
    }

    const csp = parseCsp(cspValue);
    const frameSrcValues = csp.directives['frame-src'];
    const childSrcValues = csp.directives['child-src'];
    const effectiveFrameValues = frameSrcValues ?? childSrcValues;

    if (!effectiveFrameValues) {
      return warn(
        'CSP frame-src/child-src is not explicitly set.',
        withPciComplianceMessage(
          'Without an explicit frame-src policy, iframe restrictions may be inconsistent across browsers.'
        ),
        'Add an explicit frame-src directive to your Content-Security-Policy.',
        ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC
      );
    }

    if (allowsAnyHttpsIframeSource(effectiveFrameValues)) {
      return pass('CSP frame-src is compatible with Adyen 3DS iframe guidance.');
    }

    return warn(
      'CSP frame-src may be too restrictive for 3DS issuer iframes.',
      withPciComplianceMessage(
        'Overly restrictive frame-src rules can block issuer challenge frames and break 3DS authentication.'
      ),
      'Relax your frame-src directive to allow HTTPS iframe sources.',
      ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC
    );
  })
  .add('security-csp-frame-ancestors', (payload, { pass, warn }) => {
    const cspValue = getCspHeader(payload);
    const xfoHeader = payload.mainDocumentHeaders.find(
      (h: CapturedHeader) => h.name.toLowerCase() === 'x-frame-options'
    );

    const csp = cspValue !== null && cspValue !== '' ? parseCsp(cspValue) : null;
    const hasFrameAncestors = csp ? 'frame-ancestors' in csp.directives : false;
    const hasXfo = Boolean(xfoHeader);

    if (hasFrameAncestors || hasXfo) {
      return pass(
        hasFrameAncestors
          ? 'CSP frame-ancestors directive is set.'
          : 'X-Frame-Options header is present.'
      );
    }

    return warn(
      'No frame-ancestors CSP directive or X-Frame-Options header found.',
      withPciComplianceMessage(
        'Without anti-framing protection, checkout can be embedded and abused in clickjacking attacks.'
      ),
      'Add a frame-ancestors directive to your Content-Security-Policy or set an X-Frame-Options: SAMEORIGIN header.',
      ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC
    );
  })
  .add('security-csp-reporting', (payload, { info, pass, warn }) => {
    const cspValue = getCspHeader(payload);
    const reportingEndpoints = getHeader(payload, 'reporting-endpoints');

    if (cspValue === null || cspValue === '') {
      return info('CSP reporting check skipped — no CSP header present.');
    }

    const csp = parseCsp(cspValue);
    const hasReportTo = 'report-to' in csp.directives;
    const hasReportUri = 'report-uri' in csp.directives;

    if (hasReportTo && Boolean(reportingEndpoints)) {
      return pass('CSP reporting is configured with report-to and Reporting-Endpoints.');
    }

    if (hasReportTo) {
      return warn(
        'CSP has report-to, but Reporting-Endpoints header is missing.',
        'Without a reporting endpoint, CSP violations are not captured for investigation.',
        'Add a Reporting-Endpoints response header that maps your report-to endpoint name.',
        ADYEN_PCI_DSS_REPORTING_DOC
      );
    }

    if (hasReportUri) {
      return info(
        'CSP report-uri is configured, but report-to is recommended.',
        `Migrate from the older report-uri directive to report-to. See: ${ADYEN_PCI_DSS_REPORTING_DOC}`
      );
    }

    return info(
      'CSP reporting is not configured.',
      `Configure CSP violation reporting by adding the report-to directive. See: ${ADYEN_PCI_DSS_REPORTING_DOC}`
    );
  })
  .getChecks();
