/**
 * Security: CSP checks.
 */

import type { ScanPayload, CapturedHeader } from '../../shared/types.js';
import { cspIncludesDomain, getHeader, parseCsp } from '../../shared/utils.js';
import { COMMON_DETAILS } from './constants.js';
import { createRegistry } from './registry.js';

const CATEGORY = 'security' as const;
const ADYEN_CDN = 'adyen.com';
const ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC =
  'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/script-security#implement-a-content-security-policy-for-requirement-6-4-3';
const ADYEN_PCI_DSS_REPORTING_DOC =
  'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/script-security#report';

const STRINGS = {
  NO_CSP_SKIP_REASON: 'No Content-Security-Policy header present.',

  CSP_PRESENT_PASS_TITLE: 'Content-Security-Policy header is present.',
  CSP_PRESENT_WARN_TITLE: 'Content-Security-Policy header is missing.',
  CSP_PRESENT_WARN_DETAIL: `A CSP helps prevent XSS and data injection attacks on checkout pages. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  CSP_PRESENT_WARN_REMEDIATION:
    'Add a Content-Security-Policy header to your checkout page HTTP response.',
  CSP_PRESENT_WARN_URL: ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC,

  SCRIPT_SRC_SKIP_TITLE: 'CSP script-src check skipped.',
  SCRIPT_SRC_PASS_TITLE: 'CSP script-src includes Adyen CDN domain.',
  SCRIPT_SRC_WARN_TITLE: 'CSP script-src may not include the Adyen CDN domain.',
  SCRIPT_SRC_WARN_DETAIL: `If script-src omits Adyen domains, checkout assets can be blocked or require unsafe CSP relaxations. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  SCRIPT_SRC_WARN_REMEDIATION:
    'Update your Content-Security-Policy to include the Adyen CDN script domains.',
  SCRIPT_SRC_WARN_URL: ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC,

  FRAME_SRC_SKIP_TITLE: 'CSP frame-src check skipped.',
  FRAME_SRC_PASS_TITLE: 'CSP frame-src is compatible with Adyen 3DS iframe guidance.',
  FRAME_SRC_MISSING_WARN_TITLE: 'CSP frame-src/child-src is not explicitly set.',
  FRAME_SRC_MISSING_WARN_DETAIL: `Without an explicit frame-src policy, iframe restrictions may be inconsistent across browsers. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  FRAME_SRC_MISSING_WARN_REMEDIATION:
    'Add an explicit frame-src directive to your Content-Security-Policy.',
  FRAME_SRC_MISSING_WARN_URL: ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC,
  FRAME_SRC_STRICT_WARN_TITLE: 'CSP frame-src may be too restrictive for 3DS issuer iframes.',
  FRAME_SRC_STRICT_WARN_DETAIL: `Overly restrictive frame-src rules can block issuer challenge frames and break 3DS authentication. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  FRAME_SRC_STRICT_WARN_REMEDIATION:
    'Relax your frame-src directive to allow HTTPS iframe sources.',
  FRAME_SRC_STRICT_WARN_URL: ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC,

  FRAME_ANCESTORS_CSP_PASS_TITLE: 'CSP frame-ancestors directive is set.',
  FRAME_ANCESTORS_XFO_PASS_TITLE: 'X-Frame-Options header is present.',
  FRAME_ANCESTORS_WARN_TITLE: 'No frame-ancestors CSP directive or X-Frame-Options header found.',
  FRAME_ANCESTORS_WARN_DETAIL: `Without anti-framing protection, checkout can be embedded and abused in clickjacking attacks. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  FRAME_ANCESTORS_WARN_REMEDIATION:
    'Add a frame-ancestors directive to your Content-Security-Policy or set an X-Frame-Options: SAMEORIGIN header.',
  FRAME_ANCESTORS_WARN_URL: ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC,

  REPORTING_SKIP_INFO_TITLE: 'CSP reporting check skipped — no CSP header present.',
  REPORTING_PASS_TITLE: 'CSP reporting is configured with report-to and Reporting-Endpoints.',
  REPORTING_NO_ENDPOINTS_WARN_TITLE:
    'CSP has report-to, but Reporting-Endpoints header is missing.',
  REPORTING_NO_ENDPOINTS_WARN_DETAIL:
    'Without a reporting endpoint, CSP violations are not captured for investigation.',
  REPORTING_NO_ENDPOINTS_WARN_REMEDIATION:
    'Add a Reporting-Endpoints response header that maps your report-to endpoint name.',
  REPORTING_NO_ENDPOINTS_WARN_URL: ADYEN_PCI_DSS_REPORTING_DOC,
  REPORTING_REPORT_URI_INFO_TITLE: 'CSP report-uri is configured, but report-to is recommended.',
  REPORTING_REPORT_URI_INFO_DETAIL: `Migrate from the older report-uri directive to report-to. See: ${ADYEN_PCI_DSS_REPORTING_DOC}`,
  REPORTING_NONE_INFO_TITLE: 'CSP reporting is not configured.',
  REPORTING_NONE_INFO_DETAIL: `Configure CSP violation reporting by adding the report-to directive. See: ${ADYEN_PCI_DSS_REPORTING_DOC}`,
} as const;

function getCspHeader(payload: ScanPayload): string | null {
  return getHeader(payload, 'content-security-policy');
}

function allowsAnySources(values: string[]): boolean {
  return values.includes('*') || values.includes('https:');
}

export const CSP_CHECKS = createRegistry(CATEGORY)
  .add('security-csp-present', (payload, { pass, warn }) => {
    const cspValue = getCspHeader(payload);
    if (cspValue !== null && cspValue !== '') {
      return pass(STRINGS.CSP_PRESENT_PASS_TITLE);
    }
    return warn(
      STRINGS.CSP_PRESENT_WARN_TITLE,
      STRINGS.CSP_PRESENT_WARN_DETAIL,
      STRINGS.CSP_PRESENT_WARN_REMEDIATION,
      STRINGS.CSP_PRESENT_WARN_URL
    );
  })
  .add('security-csp-script-src', (payload, { skip, pass, warn }) => {
    const cspValue = getCspHeader(payload);
    if (cspValue === null || cspValue === '') {
      return skip(STRINGS.SCRIPT_SRC_SKIP_TITLE, STRINGS.NO_CSP_SKIP_REASON);
    }

    const csp = parseCsp(cspValue);
    const scriptSrcValues = csp.directives['script-src'] ?? [];
    const defaultSrcValues = csp.directives['default-src'] ?? [];
    const hasAdyen =
      allowsAnySources(scriptSrcValues) ||
      allowsAnySources(defaultSrcValues) ||
      cspIncludesDomain(csp, 'script-src', ADYEN_CDN) ||
      cspIncludesDomain(csp, 'default-src', ADYEN_CDN);

    if (hasAdyen) {
      return pass(STRINGS.SCRIPT_SRC_PASS_TITLE);
    }

    return warn(
      STRINGS.SCRIPT_SRC_WARN_TITLE,
      STRINGS.SCRIPT_SRC_WARN_DETAIL,
      STRINGS.SCRIPT_SRC_WARN_REMEDIATION,
      STRINGS.SCRIPT_SRC_WARN_URL
    );
  })
  .add('security-csp-frame-src', (payload, { skip, warn, pass }) => {
    const cspValue = getCspHeader(payload);
    if (cspValue === null || cspValue === '') {
      return skip(STRINGS.FRAME_SRC_SKIP_TITLE, STRINGS.NO_CSP_SKIP_REASON);
    }

    const csp = parseCsp(cspValue);
    const frameSrcValues = csp.directives['frame-src'];
    const childSrcValues = csp.directives['child-src'];
    const effectiveFrameValues = frameSrcValues ?? childSrcValues;

    if (!effectiveFrameValues) {
      return warn(
        STRINGS.FRAME_SRC_MISSING_WARN_TITLE,
        STRINGS.FRAME_SRC_MISSING_WARN_DETAIL,
        STRINGS.FRAME_SRC_MISSING_WARN_REMEDIATION,
        STRINGS.FRAME_SRC_MISSING_WARN_URL
      );
    }

    if (allowsAnySources(effectiveFrameValues)) {
      return pass(STRINGS.FRAME_SRC_PASS_TITLE);
    }

    return warn(
      STRINGS.FRAME_SRC_STRICT_WARN_TITLE,
      STRINGS.FRAME_SRC_STRICT_WARN_DETAIL,
      STRINGS.FRAME_SRC_STRICT_WARN_REMEDIATION,
      STRINGS.FRAME_SRC_STRICT_WARN_URL
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
          ? STRINGS.FRAME_ANCESTORS_CSP_PASS_TITLE
          : STRINGS.FRAME_ANCESTORS_XFO_PASS_TITLE
      );
    }

    return warn(
      STRINGS.FRAME_ANCESTORS_WARN_TITLE,
      STRINGS.FRAME_ANCESTORS_WARN_DETAIL,
      STRINGS.FRAME_ANCESTORS_WARN_REMEDIATION,
      STRINGS.FRAME_ANCESTORS_WARN_URL
    );
  })
  .add('security-csp-reporting', (payload, { info, pass, warn }) => {
    const cspValue = getCspHeader(payload);
    const reportingEndpoints = getHeader(payload, 'reporting-endpoints');

    if (cspValue === null || cspValue === '') {
      return info(STRINGS.REPORTING_SKIP_INFO_TITLE);
    }

    const csp = parseCsp(cspValue);
    const hasReportTo = 'report-to' in csp.directives;
    const hasReportUri = 'report-uri' in csp.directives;

    if (hasReportTo && Boolean(reportingEndpoints)) {
      return pass(STRINGS.REPORTING_PASS_TITLE);
    }

    if (hasReportTo) {
      return warn(
        STRINGS.REPORTING_NO_ENDPOINTS_WARN_TITLE,
        STRINGS.REPORTING_NO_ENDPOINTS_WARN_DETAIL,
        STRINGS.REPORTING_NO_ENDPOINTS_WARN_REMEDIATION,
        STRINGS.REPORTING_NO_ENDPOINTS_WARN_URL
      );
    }

    if (hasReportUri) {
      return info(
        STRINGS.REPORTING_REPORT_URI_INFO_TITLE,
        STRINGS.REPORTING_REPORT_URI_INFO_DETAIL
      );
    }

    return info(STRINGS.REPORTING_NONE_INFO_TITLE, STRINGS.REPORTING_NONE_INFO_DETAIL);
  })
  .getChecks();
