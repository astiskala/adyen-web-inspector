/**
 * Check registry helper — provides a concise way to define groups of checks.
 */

import type {
  Check,
  CheckCategory,
  CheckId,
  CheckImpact,
  ImplementationAttributes,
  ScanPayload,
  Severity,
} from '../../shared/types.js';
import { readImplementationAttributes } from '../../shared/implementation-attributes.js';
import { getDefaultImpact } from '../../shared/results.js';

/**
 * Result of a check runner before ID and Category are injected.
 */
export interface CheckOutcome {
  readonly severity: Severity;
  readonly title: string;
  readonly detail?: string;
  readonly remediation?: string;
  readonly docsUrl?: string;
}

type IssueOutcome = (
  title: string,
  detail?: string,
  remediation?: string,
  documentationUrl?: string
) => CheckOutcome;

/**
 * Context provided to check runners.
 */
export interface CheckContext {
  /**
  Implementation attributes of the scan, derived once and shared by every check.
   */
  readonly attributes: ImplementationAttributes;
  readonly pass: (title: string, detail?: string) => CheckOutcome;
  readonly fail: IssueOutcome;
  readonly warn: IssueOutcome;
  readonly notice: IssueOutcome;
  readonly info: (title: string, detail?: string) => CheckOutcome;
  readonly skip: (title: string, detail: string) => CheckOutcome;
}

type CheckRunner = (payload: ScanPayload, context: CheckContext) => CheckOutcome;

interface CheckImpactPolicy {
  readonly warnImpact?: 'high' | 'low';
  readonly noticeImpact?: 'low';
}

function outcomeImpact(severity: Severity, policy: CheckImpactPolicy): CheckImpact | undefined {
  if (severity === 'warn' && policy.warnImpact !== undefined) return policy.warnImpact;
  return severity === 'notice' && policy.noticeImpact !== undefined
    ? policy.noticeImpact
    : getDefaultImpact(severity);
}

function buildOutcome(
  severity: Severity,
  title: string,
  detail?: string,
  remediation?: string,
  documentationUrl?: string
): CheckOutcome {
  return {
    severity,
    title,
    ...(detail !== undefined && { detail }),
    ...(remediation !== undefined && { remediation }),
    ...(documentationUrl !== undefined && { docsUrl: documentationUrl }),
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

    const helpers: Omit<CheckContext, 'attributes'> = {
      pass: (title, detail) => buildOutcome('pass', title, detail),
      fail: (title, detail, remediation, documentationUrl) =>
        buildOutcome('fail', title, detail, remediation, documentationUrl),
      warn: (title, detail, remediation, documentationUrl) =>
        buildOutcome('warn', title, detail, remediation, documentationUrl),
      notice: (title, detail, remediation, documentationUrl) =>
        buildOutcome('notice', title, detail, remediation, documentationUrl),
      info: (title, detail) => buildOutcome('info', title, detail),
      skip: (title, detail) => buildOutcome('skip', title, detail),
    };

    this.checks.push({
      id,
      category,
      run: (payload) => {
        const outcome = run(payload, {
          ...helpers,
          attributes: readImplementationAttributes(payload),
        });
        const impact = outcomeImpact(outcome.severity, policy);
        return {
          ...outcome,
          id,
          category,
          ...(impact !== undefined && { impact }),
        };
      },
    });
    return this;
  }

  getChecks(): Check[] {
    return this.checks;
  }
}

/**
Utility to create a category-scoped registry.
 */
export function createRegistry(category: CheckCategory): CheckRegistry {
  return new CheckRegistry(category);
}
