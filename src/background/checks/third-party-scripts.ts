/**
 * Category 8 — Third-party Script checks.
 */

import type { ScanPayload, ScriptTag, Severity } from '../../shared/types.js';
import {
  AD_PIXEL_PATTERNS,
  ANALYTICS_PATTERNS,
  SESSION_REPLAY_PATTERNS,
  TAG_MANAGER_PATTERNS,
} from '../../shared/constants.js';
import { COMMON_DETAILS } from './constants.js';
import { createRegistry, type CheckContext } from './registry.js';

const CATEGORY = 'third-party' as const;
const ADYEN_PCI_SCRIPT_SECURITY_DOC =
  'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/script-security';
const THIRD_PARTY_SCRIPT_PATTERNS = [
  ...TAG_MANAGER_PATTERNS,
  ...ANALYTICS_PATTERNS,
  ...SESSION_REPLAY_PATTERNS,
  ...AD_PIXEL_PATTERNS,
] as const;

type ThirdPartyPattern = Readonly<{ name: string; pattern: RegExp }>;

interface CheckOutcome {
  readonly severity: Severity;
  readonly title: string;
  readonly detail?: string;
  readonly remediation?: string;
  readonly docsUrl?: string;
}

interface PatternCheckOptions {
  readonly patterns: readonly ThirdPartyPattern[];
  readonly detectedTitlePrefix: string;
  readonly detectionSeverity: 'notice' | 'warn' | 'fail';
  readonly detail?: string;
  readonly remediation: string;
  readonly docsUrl: string;
  readonly passTitle: string;
}

function getScriptSources(payload: ScanPayload): string[] {
  return payload.page.scripts.map((script: ScriptTag) => script.src);
}

function findMatchingScripts(srcs: string[], patterns: readonly ThirdPartyPattern[]): string[] {
  const matches: string[] = [];
  for (const { name, pattern } of patterns) {
    if (srcs.some((src) => pattern.test(src))) {
      matches.push(name);
    }
  }
  return matches;
}

function scriptMatchesAnyPattern(src: string, patterns: readonly ThirdPartyPattern[]): boolean {
  return patterns.some(({ pattern }) => pattern.test(src));
}

function runPatternCheck(
  payload: ScanPayload,
  options: PatternCheckOptions,
  context: CheckContext
): CheckOutcome {
  const found = findMatchingScripts(getScriptSources(payload), options.patterns);
  if (found.length === 0) {
    return context.pass(options.passTitle);
  }

  const title = `${options.detectedTitlePrefix}: ${found.join(', ')}.`;
  if (options.detectionSeverity === 'fail') {
    return context.fail(title, options.detail, options.remediation, options.docsUrl);
  }
  if (options.detectionSeverity === 'warn') {
    return context.warn(title, options.detail, options.remediation, options.docsUrl);
  }
  return context.notice(title, options.detail, options.remediation, options.docsUrl);
}

export const THIRD_PARTY_CHECKS = createRegistry(CATEGORY)
  .add('3p-tag-manager', (payload, context) => {
    return runPatternCheck(
      payload,
      {
        patterns: TAG_MANAGER_PATTERNS,
        detectedTitlePrefix: 'Tag manager(s) detected',
        detectionSeverity: 'notice',
        detail: `Tag managers can dynamically load unreviewed scripts on the payment page, bypassing the script inventory and authorization required by PCI DSS requirement 6.4.3. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
        remediation:
          'Audit all tags loaded via tag managers on payment pages. Ensure every script loaded through the tag manager is included in your PCI DSS requirement 6.4.3 script inventory with a written justification.',
        docsUrl: ADYEN_PCI_SCRIPT_SECURITY_DOC,
        passTitle: 'No known tag managers detected.',
      },
      context
    );
  })
  .add('3p-session-replay', (payload, context) => {
    return runPatternCheck(
      payload,
      {
        patterns: SESSION_REPLAY_PATTERNS,
        detectedTitlePrefix: 'Session replay tool detected',
        detectionSeverity: 'fail',
        detail: `Session replay tools record DOM state including payment form fields, risking exposure of sensitive payment data. All scripts on the payment page must be inventoried and authorized per PCI DSS requirement 6.4.3. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
        remediation:
          'Remove session replay and screen recording tools from payment pages. If retention is justified, ensure the tool is included in your PCI DSS requirement 6.4.3 script inventory, integrity-checked with SRI, and configured to exclude payment form fields.',
        docsUrl: ADYEN_PCI_SCRIPT_SECURITY_DOC,
        passTitle: 'No known session replay tools detected.',
      },
      context
    );
  })
  .add('3p-ad-pixels', (payload, context) => {
    return runPatternCheck(
      payload,
      {
        patterns: AD_PIXEL_PATTERNS,
        detectedTitlePrefix: 'Ad pixel(s) detected',
        detectionSeverity: 'warn',
        detail: `Ad pixels on payment pages add scripts that must be inventoried and authorized per PCI DSS requirement 6.4.3. They can expose payment journey metadata to third-party advertising networks. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
        remediation:
          'Move advertising and conversion tracking pixels to the post-payment order confirmation page. If they must remain on the payment page, ensure each pixel is included in your PCI DSS requirement 6.4.3 script inventory with a written justification.',
        docsUrl: ADYEN_PCI_SCRIPT_SECURITY_DOC,
        passTitle: 'No known ad pixels detected.',
      },
      context
    );
  })
  .add('3p-no-sri', (payload, { pass, notice }) => {
    const knownThirdPartyScripts = payload.page.scripts.filter((s: ScriptTag) => {
      return (
        s.src.startsWith('http') && scriptMatchesAnyPattern(s.src, THIRD_PARTY_SCRIPT_PATTERNS)
      );
    });

    if (knownThirdPartyScripts.length === 0) {
      return pass('No known third-party scripts detected requiring SRI.');
    }

    const withoutSri = knownThirdPartyScripts.filter(
      (s: ScriptTag) => s.integrity === undefined || s.integrity === ''
    );
    if (withoutSri.length === 0) {
      return pass('Detected third-party scripts have SRI.');
    }

    return notice(
      `${withoutSri.length} third-party script(s) loaded without SRI.`,
      `Without Subresource Integrity (SRI), third-party scripts can be altered by upstream compromises without browser detection. PCI DSS requirement 6.4.3 requires a method to assure the integrity of each script on the payment page. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
      'Add integrity and crossorigin attributes to each third-party script tag on the payment page to comply with PCI DSS requirement 6.4.3 script integrity requirements.',
      ADYEN_PCI_SCRIPT_SECURITY_DOC
    );
  })
  .getChecks();
