/**
 * Check registry helper — provides a concise way to define groups of checks.
 */

import type {
  Check,
  CheckCategory,
  CheckId,
  CheckImpact,
  ScanPayload,
  Severity,
} from '../../shared/types.js';
import { getDefaultImpact } from '../../shared/results.js';

/**
 * Result of a check runner before ID and Category are injected.
 */
interface CheckOutcome {
  readonly severity: Severity;
  readonly title: string;
  readonly detail?: string;
  readonly remediation?: string;
  readonly docsUrl?: string;
}

/**
 * Context provided to check runners.
 */
export interface CheckContext {
  pass(title: string, detail?: string): CheckOutcome;
  fail(title: string, detail?: string, remediation?: string, docsUrl?: string): CheckOutcome;
  warn(title: string, detail?: string, remediation?: string, docsUrl?: string): CheckOutcome;
  notice(title: string, detail?: string, remediation?: string, docsUrl?: string): CheckOutcome;
  info(title: string, detail?: string): CheckOutcome;
  skip(title: string, detail: string): CheckOutcome;
}

type CheckRunner = (payload: ScanPayload, context: CheckContext) => CheckOutcome;

interface CheckImpactPolicy {
  readonly warnImpact?: 'high' | 'low';
  readonly noticeImpact?: 'low';
}

function outcomeImpact(severity: Severity, policy: CheckImpactPolicy): CheckImpact | undefined {
  if (severity === 'warn' && policy.warnImpact !== undefined) return policy.warnImpact;
  if (severity === 'notice' && policy.noticeImpact !== undefined) return policy.noticeImpact;
  return getDefaultImpact(severity);
}

function buildOutcome(
  severity: Severity,
  title: string,
  detail?: string,
  remediation?: string,
  docsUrl?: string
): CheckOutcome {
  return {
    severity,
    title,
    ...(detail === undefined ? {} : { detail }),
    ...(remediation === undefined ? {} : { remediation }),
    ...(docsUrl === undefined ? {} : { docsUrl }),
  };
}

class CheckRegistry {
  private readonly checks: Check[] = [];
  private readonly category: CheckCategory;

  constructor(category: CheckCategory) {
    this.category = category;
  }

  add(id: CheckId, run: CheckRunner, policy: CheckImpactPolicy = {}): this {
    const category = this.category;

    const context: CheckContext = {
      pass: (title, detail) => buildOutcome('pass', title, detail),
      fail: (title, detail, remediation, docsUrl) =>
        buildOutcome('fail', title, detail, remediation, docsUrl),
      warn: (title, detail, remediation, docsUrl) =>
        buildOutcome('warn', title, detail, remediation, docsUrl),
      notice: (title, detail, remediation, docsUrl) =>
        buildOutcome('notice', title, detail, remediation, docsUrl),
      info: (title, detail) => buildOutcome('info', title, detail),
      skip: (title, detail) => buildOutcome('skip', title, detail),
    };

    this.checks.push({
      id,
      category,
      run: (payload) => {
        const outcome = run(payload, context);
        const impact = outcomeImpact(outcome.severity, policy);
        return {
          ...outcome,
          id,
          category,
          ...(impact === undefined ? {} : { impact }),
        };
      },
    });
    return this;
  }

  getChecks(): Check[] {
    return this.checks;
  }
}

/** Utility to create a category-scoped registry. */
export function createRegistry(category: CheckCategory): CheckRegistry {
  return new CheckRegistry(category);
}
