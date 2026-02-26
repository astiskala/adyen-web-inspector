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
import { createRegistry, type CheckContext } from './registry.js';

const CATEGORY = 'third-party' as const;
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
        detail:
          'Tag managers can load unreviewed scripts on checkout, increasing PCI and supply-chain risk.',
        remediation: 'Audit tags carefully on payment pages.',
        docsUrl: 'https://docs.adyen.com/online-payments/web-best-practices/#third-party-tools',
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
        detectedTitlePrefix: 'Session replay detected',
        detectionSeverity: 'fail',
        detail: 'Session replay tools may capture sensitive payment data, violating PCI DSS.',
        remediation: 'Remove session replay and screen recording tools from checkout pages.',
        docsUrl: 'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/',
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
        detail:
          'Ad pixels on checkout can expose payment journey metadata and conflict with compliance controls.',
        remediation:
          'Move advertising and conversion tracking pixels to the post-payment order confirmation page.',
        docsUrl: 'https://docs.adyen.com/online-payments/web-best-practices/#third-party-tools',
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
      'Third-party scripts without SRI can be altered by upstream compromises without browser detection.',
      'Add Subresource Integrity (SRI) attributes to each third-party script tag.',
      'https://www.w3.org/TR/SRI/'
    );
  })
  .getChecks();
