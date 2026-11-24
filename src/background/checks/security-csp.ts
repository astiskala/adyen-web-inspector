/**
Security checks (`security`) — Content-Security-Policy compatibility with Adyen Web.
*/

import type { ScanPayload } from '../../shared/types.js';
import { isAdyenCheckoutResource, readAdyenWebRequests } from '../../shared/adyen-endpoint.js';
import { ADYEN_WEB_TRANSLATION_LOCALES } from '../../shared/constants.js';
import { readCheckoutField } from '../../shared/scan-evidence.js';
import { COMMON_DETAILS, SKIP_REASONS } from './constants.js';
import { readDocumentHeader, readPagePolicy, type PagePolicy } from './page-policy.js';
import { createRegistry, type CheckContext, type CheckOutcome } from './registry.js';

const CATEGORY = 'security' as const;
const ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC =
  'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/script-security#implement-a-content-security-policy-for-requirement-6-4-3';
const ADYEN_PCI_DSS_EXTERNAL_SOURCES_DOC =
  'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/script-security#allow-external-sources';
const ADYEN_PCI_DSS_REPORTING_DOC =
  'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/script-security#report';

const STRINGS = {
  NO_CSP_SKIP_REASON: 'No Content-Security-Policy header present.',
  NO_ENV_SKIP_REASON: 'The Adyen Web environment could not be determined.',

  CSP_PRESENT_SKIP_TITLE: 'CSP presence check skipped.',
  CSP_PRESENT_PASS_TITLE: 'Content-Security-Policy header is present.',
  CSP_PRESENT_WARN_TITLE: 'Content-Security-Policy header is missing.',
  CSP_PRESENT_WARN_DETAIL: `A CSP helps prevent XSS and data injection attacks on checkout pages. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  CSP_PRESENT_WARN_REMEDIATION:
    'Add a Content-Security-Policy header to your checkout page HTTP response.',
  CSP_PRESENT_WARN_URL: ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC,

  SCRIPT_SRC_SKIP_TITLE: 'CSP script-src check skipped.',
  SCRIPT_SRC_NO_SCRIPTS_SKIP_REASON: 'No Adyen-hosted checkout scripts detected.',
  SCRIPT_SRC_PASS_TITLE: 'CSP allows the observed Adyen checkout scripts.',
  SCRIPT_SRC_WARN_TITLE: 'CSP may block an observed Adyen checkout script.',
  SCRIPT_SRC_WARN_DETAIL: `If script-src omits Adyen domains, checkout assets can be blocked or require unsafe CSP relaxations. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  SCRIPT_SRC_WARN_REMEDIATION:
    "Update your Content-Security-Policy to include the Adyen CDN script domains, or allow the Adyen script tag by your policy's nonce or by listing the hash in its integrity attribute.",
  SCRIPT_SRC_WARN_URL: ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC,
  SCRIPT_SRC_STRICT_DYNAMIC_NOTICE_TITLE:
    "CSP 'strict-dynamic' allows the Adyen script only if a trusted script inserted it.",
  SCRIPT_SRC_STRICT_DYNAMIC_NOTICE_DETAIL:
    "Under 'strict-dynamic', host allowlists are ignored: a script without a listed nonce or integrity hash loads only when an already trusted script inserts it, and is blocked when it is in the page markup. The page does not show which applies.",
  SCRIPT_SRC_STRICT_DYNAMIC_NOTICE_REMEDIATION:
    "Confirm that a nonced or hashed loader inserts the Adyen script, or give its script tag your policy's nonce, or an integrity attribute whose hash the policy lists.",

  FRAME_SRC_SKIP_TITLE: 'CSP frame-src check skipped.',
  FRAME_SRC_PASS_TITLE: 'CSP frame-src is compatible with Adyen 3DS iframe guidance.',
  FRAME_SRC_MISSING_WARN_TITLE: 'CSP frame-src/child-src is not explicitly set.',
  FRAME_SRC_MISSING_WARN_DETAIL: `Without an explicit frame-src policy, iframes follow default-src (or are unrestricted), which Adyen describes as functional but not stable for 3DS issuer iframes. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  FRAME_SRC_MISSING_WARN_REMEDIATION:
    'Add an explicit frame-src directive to your Content-Security-Policy. Adyen recommends frame-src * so issuer 3DS iframes can load.',
  FRAME_SRC_MISSING_WARN_URL: ADYEN_PCI_DSS_EXTERNAL_SOURCES_DOC,
  FRAME_SRC_STRICT_WARN_TITLE: 'CSP frame-src may be too restrictive for 3DS issuer iframes.',
  FRAME_SRC_STRICT_WARN_DETAIL: `Overly restrictive frame-src rules can block issuer challenge frames and break 3DS authentication. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  FRAME_SRC_INHERITED_STRICT_WARN_DETAIL: `No frame-src or child-src is set, so iframes inherit a default-src that does not allow HTTPS issuer pages. This can block issuer challenge frames and break 3DS authentication. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  FRAME_SRC_STRICT_WARN_REMEDIATION:
    'Set frame-src to allow HTTPS iframe sources. Adyen recommends frame-src * because issuer 3DS domains cannot be listed in advance.',
  FRAME_SRC_STRICT_WARN_URL: ADYEN_PCI_DSS_EXTERNAL_SOURCES_DOC,

  CONNECT_SRC_SKIP_TITLE: 'CSP connect-src check skipped.',
  CONNECT_SRC_PASS_TITLE: 'CSP connect-src allows the Adyen Web endpoints for this environment.',
  CONNECT_SRC_WARN_TITLE: 'CSP connect-src may block Adyen Web requests.',
  CONNECT_SRC_WARN_CONSEQUENCE:
    'Adyen Web calls these origins for Sessions, card BIN lookups, checkout attempt IDs, and localized text.',
  CONNECT_SRC_WARN_REMEDIATION:
    'Allow the listed Adyen origins in connect-src (or default-src when connect-src is not set). Adyen recommends connect-src * because some payment methods also call their own domains.',

  IMG_SRC_SKIP_TITLE: 'CSP img-src check skipped.',
  IMG_SRC_PASS_TITLE: 'CSP img-src allows Adyen payment method logos.',
  IMG_SRC_WARN_TITLE: 'CSP img-src may block Adyen payment method logos.',
  IMG_SRC_WARN_CONSEQUENCE:
    'Adyen Web loads payment method and card brand logos from this origin, so blocked images leave empty icons in checkout.',
  IMG_SRC_WARN_REMEDIATION:
    'Allow the Adyen CDN origin in img-src (or default-src when img-src is not set). Adyen recommends img-src *.',

  FORM_ACTION_SKIP_TITLE: 'CSP form-action check skipped.',
  FORM_ACTION_PASS_TITLE: 'CSP form-action allows 3DS and redirect form submissions.',
  FORM_ACTION_UNSET_PASS_TITLE: 'CSP does not restrict form-action.',
  FORM_ACTION_WARN_TITLE: 'CSP form-action may block 3DS and redirect payment forms.',
  FORM_ACTION_WARN_DETAIL:
    'Adyen Web posts hidden forms to issuer and payment method URLs for 3DS authentication and POST redirects. A form-action that does not allow HTTPS destinations blocks these submissions. form-action does not fall back to default-src.',
  FORM_ACTION_WARN_REMEDIATION:
    'Set form-action to allow HTTPS destinations. Adyen recommends form-action *.',

  FRAME_ANCESTORS_SKIP_TITLE: 'CSP frame-ancestors check skipped.',
  FRAME_ANCESTORS_CSP_PASS_TITLE: 'CSP frame-ancestors directive is set.',
  FRAME_ANCESTORS_XFO_PASS_TITLE: 'X-Frame-Options header denies cross-origin framing.',
  FRAME_ANCESTORS_WARN_TITLE:
    'No frame-ancestors CSP directive or enforced X-Frame-Options header found.',
  FRAME_ANCESTORS_WARN_DETAIL: `Without anti-framing protection, checkout can be embedded and abused in clickjacking attacks. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  FRAME_ANCESTORS_WARN_REMEDIATION:
    'Add a frame-ancestors directive to your Content-Security-Policy or set an X-Frame-Options: SAMEORIGIN header.',
  FRAME_ANCESTORS_WARN_URL: ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC,

  REPORTING_SKIP_TITLE: 'CSP reporting check skipped.',
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

type EnforcedPolicy = Extract<PagePolicy, { status: 'enforced' }>;

/**
X-Frame-Options values browsers enforce; ALLOW-FROM and others are ignored.
*/
const ENFORCED_XFO_VALUES: ReadonlySet<string> = new Set(['deny', 'sameorigin']);

/**
Skips a directive check when headers are unavailable or no policy is set.
*/
function skipUnenforced(
  policy: Exclude<PagePolicy, EnforcedPolicy>,
  title: string,
  { skip }: CheckContext
): CheckOutcome {
  return skip(
    title,
    policy.status === 'unavailable' ? SKIP_REASONS.HEADERS_UNAVAILABLE : STRINGS.NO_CSP_SKIP_REASON
  );
}

/**
The Adyen Web environment: the configured option, else test when a test signal shows it.
*/
function adyenWebEnvironment(payload: ScanPayload, { attributes }: CheckContext): string | null {
  const environment = readCheckoutField(payload, 'environment');
  if (environment.state === 'present') return environment.value;
  return attributes.environment.value === 'test' ? 'test' : null;
}

const CDN_TRANSLATION_LANGUAGES = new Set(
  ADYEN_WEB_TRANSLATION_LOCALES.map((locale) => locale.slice(0, 2).toLowerCase())
);

/**
Adyen Web bundles en-US and fetches other supported translations from the CDN.
*/
function areCdnTranslationsFetched(payload: ScanPayload): boolean {
  const locale = readCheckoutField(payload, 'locale');
  if (locale.state !== 'present') return false;
  const language = locale.value.slice(0, 2).toLowerCase();
  return language !== 'en' && CDN_TRANSLATION_LANGUAGES.has(language);
}

interface RequestCheckStrings {
  readonly skipTitle: string;
  readonly passTitle: string;
  readonly warnTitle: string;
  readonly warnConsequence: string;
  readonly warnRemediation: string;
}

/**
Checks that the policy allows the requests Adyen Web makes under one directive.
*/
function runRequestCheck(
  directive: 'connect-src' | 'img-src',
  strings: RequestCheckStrings,
  payload: ScanPayload,
  context: CheckContext
): CheckOutcome {
  const { skip, pass, warn } = context;
  const policy = readPagePolicy(payload);
  if (policy.status !== 'enforced') return skipUnenforced(policy, strings.skipTitle, context);
  const environment = adyenWebEnvironment(payload, context);
  if (environment === null) return skip(strings.skipTitle, STRINGS.NO_ENV_SKIP_REASON);

  const requests = readAdyenWebRequests(environment, areCdnTranslationsFetched(payload));
  const blocked = requests[directive].filter(({ url }) => !policy.allows(directive, url));
  if (blocked.length === 0) return pass(strings.passTitle);
  const origins = blocked.map(({ url, purpose }) => `${new URL(url).origin} (${purpose})`);
  return warn(
    strings.warnTitle,
    `The policy does not allow ${origins.join(', ')}. ${strings.warnConsequence}`,
    strings.warnRemediation,
    ADYEN_PCI_DSS_EXTERNAL_SOURCES_DOC
  );
}

export const CSP_CHECKS = createRegistry(CATEGORY)
  .add('security-csp-present', (payload, { pass, warn, skip }) => {
    const policy = readPagePolicy(payload);
    if (policy.status === 'unavailable') {
      return skip(STRINGS.CSP_PRESENT_SKIP_TITLE, SKIP_REASONS.HEADERS_UNAVAILABLE);
    }
    return policy.status === 'enforced'
      ? pass(STRINGS.CSP_PRESENT_PASS_TITLE)
      : warn(
          STRINGS.CSP_PRESENT_WARN_TITLE,
          STRINGS.CSP_PRESENT_WARN_DETAIL,
          STRINGS.CSP_PRESENT_WARN_REMEDIATION,
          STRINGS.CSP_PRESENT_WARN_URL
        );
  })
  .add('security-csp-script-src', (payload, context) => {
    const { skip, pass, warn, notice } = context;
    const policy = readPagePolicy(payload);
    if (policy.status !== 'enforced') {
      return skipUnenforced(policy, STRINGS.SCRIPT_SRC_SKIP_TITLE, context);
    }

    const adyenScripts = payload.page.scripts.filter((script) =>
      isAdyenCheckoutResource(script.src)
    );
    if (adyenScripts.length === 0) {
      return skip(STRINGS.SCRIPT_SRC_SKIP_TITLE, STRINGS.SCRIPT_SRC_NO_SCRIPTS_SKIP_REASON);
    }

    const allowances = new Set(adyenScripts.map((script) => policy.scriptAllowance(script)));
    if (allowances.has('blocked')) {
      return warn(
        STRINGS.SCRIPT_SRC_WARN_TITLE,
        STRINGS.SCRIPT_SRC_WARN_DETAIL,
        STRINGS.SCRIPT_SRC_WARN_REMEDIATION,
        STRINGS.SCRIPT_SRC_WARN_URL
      );
    }
    return allowances.has('needs-trusted-insertion')
      ? notice(
          STRINGS.SCRIPT_SRC_STRICT_DYNAMIC_NOTICE_TITLE,
          STRINGS.SCRIPT_SRC_STRICT_DYNAMIC_NOTICE_DETAIL,
          STRINGS.SCRIPT_SRC_STRICT_DYNAMIC_NOTICE_REMEDIATION,
          STRINGS.SCRIPT_SRC_WARN_URL
        )
      : pass(STRINGS.SCRIPT_SRC_PASS_TITLE);
  })
  .add('security-csp-frame-src', (payload, context) => {
    const { warn, pass } = context;
    const policy = readPagePolicy(payload);
    if (policy.status !== 'enforced') {
      return skipUnenforced(policy, STRINGS.FRAME_SRC_SKIP_TITLE, context);
    }

    const restrictive = policy.restrictive('frame-src');
    if (restrictive !== undefined) {
      return warn(
        STRINGS.FRAME_SRC_STRICT_WARN_TITLE,
        restrictive.directive === 'default-src'
          ? STRINGS.FRAME_SRC_INHERITED_STRICT_WARN_DETAIL
          : STRINGS.FRAME_SRC_STRICT_WARN_DETAIL,
        STRINGS.FRAME_SRC_STRICT_WARN_REMEDIATION,
        STRINGS.FRAME_SRC_STRICT_WARN_URL
      );
    }

    return policy
      .governing('frame-src')
      .some((governing) => governing === null || governing.directive === 'default-src')
      ? warn(
          STRINGS.FRAME_SRC_MISSING_WARN_TITLE,
          STRINGS.FRAME_SRC_MISSING_WARN_DETAIL,
          STRINGS.FRAME_SRC_MISSING_WARN_REMEDIATION,
          STRINGS.FRAME_SRC_MISSING_WARN_URL
        )
      : pass(STRINGS.FRAME_SRC_PASS_TITLE);
  })
  .add('security-csp-connect-src', (payload, context) =>
    runRequestCheck(
      'connect-src',
      {
        skipTitle: STRINGS.CONNECT_SRC_SKIP_TITLE,
        passTitle: STRINGS.CONNECT_SRC_PASS_TITLE,
        warnTitle: STRINGS.CONNECT_SRC_WARN_TITLE,
        warnConsequence: STRINGS.CONNECT_SRC_WARN_CONSEQUENCE,
        warnRemediation: STRINGS.CONNECT_SRC_WARN_REMEDIATION,
      },
      payload,
      context
    )
  )
  .add(
    'security-csp-img-src',
    (payload, context) =>
      runRequestCheck(
        'img-src',
        {
          skipTitle: STRINGS.IMG_SRC_SKIP_TITLE,
          passTitle: STRINGS.IMG_SRC_PASS_TITLE,
          warnTitle: STRINGS.IMG_SRC_WARN_TITLE,
          warnConsequence: STRINGS.IMG_SRC_WARN_CONSEQUENCE,
          warnRemediation: STRINGS.IMG_SRC_WARN_REMEDIATION,
        },
        payload,
        context
      ),
    { warnImpact: 'low' }
  )
  .add('security-csp-form-action', (payload, context) => {
    const { pass, warn } = context;
    const policy = readPagePolicy(payload);
    if (policy.status !== 'enforced') {
      return skipUnenforced(policy, STRINGS.FORM_ACTION_SKIP_TITLE, context);
    }

    if (policy.restrictive('form-action') !== undefined) {
      return warn(
        STRINGS.FORM_ACTION_WARN_TITLE,
        STRINGS.FORM_ACTION_WARN_DETAIL,
        STRINGS.FORM_ACTION_WARN_REMEDIATION,
        ADYEN_PCI_DSS_EXTERNAL_SOURCES_DOC
      );
    }
    return pass(
      policy.governing('form-action').every((governing) => governing === null)
        ? STRINGS.FORM_ACTION_UNSET_PASS_TITLE
        : STRINGS.FORM_ACTION_PASS_TITLE
    );
  })
  .add('security-csp-frame-ancestors', (payload, { pass, warn, skip }) => {
    const policy = readPagePolicy(payload);
    if (policy.status === 'unavailable') {
      return skip(STRINGS.FRAME_ANCESTORS_SKIP_TITLE, SKIP_REASONS.HEADERS_UNAVAILABLE);
    }
    const hasFrameAncestors = policy.status === 'enforced' && policy.declares('frame-ancestors');
    const xfo = readDocumentHeader(payload, 'x-frame-options');
    const hasXfo =
      xfo.state === 'present' && ENFORCED_XFO_VALUES.has(xfo.value.trim().toLowerCase());

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
    const policy = readPagePolicy(payload);
    if (policy.status === 'unavailable') {
      return skip(STRINGS.REPORTING_SKIP_TITLE, SKIP_REASONS.HEADERS_UNAVAILABLE);
    }
    if (policy.status === 'absent') {
      return info(STRINGS.REPORTING_SKIP_INFO_TITLE);
    }

    const reportingEndpoints = readDocumentHeader(payload, 'reporting-endpoints');
    const hasReportTo = policy.declares('report-to');

    if (hasReportTo && reportingEndpoints.state === 'present' && reportingEndpoints.value !== '') {
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

    return policy.declares('report-uri')
      ? info(STRINGS.REPORTING_REPORT_URI_INFO_TITLE, STRINGS.REPORTING_REPORT_URI_INFO_DETAIL)
      : info(STRINGS.REPORTING_NONE_INFO_TITLE, STRINGS.REPORTING_NONE_INFO_DETAIL);
  })
  .getChecks();
