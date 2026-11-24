import { runChecks } from '../../../src/background/checks/index';
import type { Check, CheckId, CheckResult, ScanPayload } from '../../../src/shared/types';

/**
A check bound to the scan's conclusions for whichever payload it runs on.
*/
interface ConcludedCheck extends Pick<Check, 'id' | 'category'> {
  readonly run: (payload: ScanPayload) => CheckResult;
}

/**
Runs a check the way a scan does, with the conclusions drawn from the payload.
*/
export function runCheck(check: Check, payload: ScanPayload): CheckResult {
  const [result] = runChecks(payload, [check]).results;
  if (result === undefined) throw new Error(`Check "${check.id}" produced no result.`);
  return result;
}

/**
Finds a check by id in a registry and throws when it is missing.
*/
export function requireCheck(checks: readonly Check[], id: CheckId): ConcludedCheck {
  const found = checks.find((check) => check.id === id);
  if (found === undefined) {
    throw new Error(`Expected check "${id}" to be registered.`);
  }
  return { id, category: found.category, run: (payload) => runCheck(found, payload) };
}
