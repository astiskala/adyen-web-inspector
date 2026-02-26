import { describe, it, expect } from 'vitest';
import { ALL_CHECKS } from '../../../src/background/checks/index';

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
});
