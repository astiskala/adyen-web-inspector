/**
 * Security: CSP checks.
 */

import type { ScanPayload } from '../../shared/types.js';
import {
  cspAllowsUrl,
  getAllHeaders,
  getHeader,
  isAdyenCheckoutResource,
  parseCsp,
} from '../../shared/utils.js';
import { COMMON_DETAILS } from './constants.js';
import { createRegistry } from './registry.js';

const CATEGORY = 'security' as const;
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
  SCRIPT_SRC_PASS_TITLE: 'CSP allows the observed Adyen checkout scripts.',
  SCRIPT_SRC_WARN_TITLE: 'CSP may block an observed Adyen checkout script.',
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

  REPORTING_SKIP_INFO_TITLE: 'CSP reporting check skipped. No CSP header present.',
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

function getCspPolicies(payload: ScanPayload): ReturnType<typeof parseCsp>[] {
  return getAllHeaders(payload, 'content-security-policy')
    .flatMap((value) => value.split(/\s*,\s*/))
    .filter((value) => value.trim() !== '')
    .map(parseCsp);
}

function allowsAnySources(values: string[]): boolean {
  return values.includes('*') || values.includes('https:');
}

export const CSP_CHECKS = createRegistry(CATEGORY)
  .add('security-csp-present', (payload, { pass, warn, skip }) => {
    if (payload.mainDocumentHeadersAvailable === false) {
      return skip(
        'CSP presence check skipped.',
        'Document response headers could not be captured.'
      );
    }
    if (getCspPolicies(payload).length > 0) {
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
    if (payload.mainDocumentHeadersAvailable === false) {
      return skip(
        STRINGS.SCRIPT_SRC_SKIP_TITLE,
        'Document response headers could not be captured.'
      );
    }
    const policies = getCspPolicies(payload);
    if (policies.length === 0) {
      return skip(STRINGS.SCRIPT_SRC_SKIP_TITLE, STRINGS.NO_CSP_SKIP_REASON);
    }

    const adyenScripts = payload.page.scripts.filter((script) =>
      isAdyenCheckoutResource(script.src)
    );
    if (adyenScripts.length === 0) {
      return skip(STRINGS.SCRIPT_SRC_SKIP_TITLE, 'No Adyen-hosted checkout scripts detected.');
    }

    const allAllowed = policies.every((policy) =>
      adyenScripts.every((script) =>
        cspAllowsUrl(policy, 'script-src', script.src, payload.pageUrl)
      )
    );
    if (allAllowed) return pass(STRINGS.SCRIPT_SRC_PASS_TITLE);

    return warn(
      STRINGS.SCRIPT_SRC_WARN_TITLE,
      STRINGS.SCRIPT_SRC_WARN_DETAIL,
      STRINGS.SCRIPT_SRC_WARN_REMEDIATION,
      STRINGS.SCRIPT_SRC_WARN_URL
    );
  })
  .add('security-csp-frame-src', (payload, { skip, warn, pass }) => {
    if (payload.mainDocumentHeadersAvailable === false) {
      return skip(STRINGS.FRAME_SRC_SKIP_TITLE, 'Document response headers could not be captured.');
    }
    const policies = getCspPolicies(payload);
    if (policies.length === 0) {
      return skip(STRINGS.FRAME_SRC_SKIP_TITLE, STRINGS.NO_CSP_SKIP_REASON);
    }

    const frameSources = policies.map(
      (policy) => policy.directives['frame-src'] ?? policy.directives['child-src']
    );
    if (frameSources.some((sources) => sources === undefined)) {
      return warn(
        STRINGS.FRAME_SRC_MISSING_WARN_TITLE,
        STRINGS.FRAME_SRC_MISSING_WARN_DETAIL,
        STRINGS.FRAME_SRC_MISSING_WARN_REMEDIATION,
        STRINGS.FRAME_SRC_MISSING_WARN_URL
      );
    }

    if (frameSources.every((sources) => sources !== undefined && allowsAnySources(sources))) {
      return pass(STRINGS.FRAME_SRC_PASS_TITLE);
    }

    return warn(
      STRINGS.FRAME_SRC_STRICT_WARN_TITLE,
      STRINGS.FRAME_SRC_STRICT_WARN_DETAIL,
      STRINGS.FRAME_SRC_STRICT_WARN_REMEDIATION,
      STRINGS.FRAME_SRC_STRICT_WARN_URL
    );
  })
  .add('security-csp-frame-ancestors', (payload, { pass, warn, skip }) => {
    if (payload.mainDocumentHeadersAvailable === false) {
      return skip(
        'CSP frame-ancestors check skipped.',
        'Document response headers could not be captured.'
      );
    }
    const hasFrameAncestors = getCspPolicies(payload).some(
      (policy) => policy.directives['frame-ancestors'] !== undefined
    );
    const hasXfo = getHeader(payload, 'x-frame-options') !== null;

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
  .add('security-csp-reporting', (payload, { info, pass, warn, skip }) => {
    if (payload.mainDocumentHeadersAvailable === false) {
      return skip(
        'CSP reporting check skipped.',
        'Document response headers could not be captured.'
      );
    }
    const policies = getCspPolicies(payload);
    const reportingEndpoints = getHeader(payload, 'reporting-endpoints');

    if (policies.length === 0) {
      return info(STRINGS.REPORTING_SKIP_INFO_TITLE);
    }

    const hasReportTo = policies.some((policy) => policy.directives['report-to'] !== undefined);
    const hasReportUri = policies.some((policy) => policy.directives['report-uri'] !== undefined);

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
