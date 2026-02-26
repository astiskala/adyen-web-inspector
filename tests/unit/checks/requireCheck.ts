import type { Check, CheckId } from '../../../src/shared/types';

/**
 * Finds a check by id in a registry and throws when it is missing.
 */
export function requireCheck(checks: readonly Check[], id: CheckId): Check {
  const found = checks.find((check) => check.id === id);
  if (found === undefined) {
    throw new Error(`Expected check "${id}" to be registered.`);
  }
  return found;
}
