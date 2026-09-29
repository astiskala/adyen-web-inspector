import { describe, it, expect } from 'vitest';
import { ALL_CHECKS } from '../../../src/background/checks/index';
import { getImpactLevel } from '../../../src/shared/results';
import {
  makeAdyenPayload,
  makeCheckoutPage,
  makeScanPayload,
} from '../../fixtures/makeScanPayload';
import { requireCheck } from './requireCheck';

describe('ALL_CHECKS registry', () => {
  it('exports a non-empty array of checks', () => {
    expect(ALL_CHECKS.length).toBeGreaterThan(0);
  });

  it('every check has a unique id', () => {
    const ids = ALL_CHECKS.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every check has a category', () => {
    for (const check of ALL_CHECKS) {
      expect(check.category).toBeTruthy();
    }
  });

  it('every check exposes a run function', () => {
    for (const check of ALL_CHECKS) {
      expect(typeof check.run).toBe('function');
    }
  });

  it('attaches check-owned impact to high-priority warnings and low-impact notices', () => {
    const risk = requireCheck(ALL_CHECKS, 'risk-df-iframe').run(makeAdyenPayload());
    const sri = requireCheck(ALL_CHECKS, 'security-sri-css').run(
      makeScanPayload({
        page: makeCheckoutPage({
          links: [
            {
              href: 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk.css',
              rel: 'stylesheet',
            },
          ],
        }),
      })
    );
    const bundle = requireCheck(ALL_CHECKS, 'sdk-bundle-type').run(
      makeAdyenPayload({ bundleType: 'auto' })
    );

    expect(risk).toMatchObject({ severity: 'warn', impact: 'high' });
    expect(sri).toMatchObject({ severity: 'warn', impact: 'high' });
    expect(bundle).toMatchObject({ severity: 'notice', impact: 'low' });
    expect(getImpactLevel(risk)).toBe('high');
  });

  it('serializes issue impact without adding it to non-issues', () => {
    const payloads = [makeScanPayload(), makeAdyenPayload()];
    for (const payload of payloads) {
      for (const check of ALL_CHECKS) {
        const result = check.run(payload);
        if (['fail', 'warn', 'notice'].includes(result.severity)) {
          expect(result.impact).toBe(getImpactLevel(result));
        } else {
          expect(result.impact).toBeUndefined();
        }
      }
    }
  });
});
