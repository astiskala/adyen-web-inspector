import { describe, expect, it } from 'vitest';
import { describeError } from '../../../src/shared/utils';

describe('describeError', () => {
  it.each([
    [new Error('Extension context invalidated.'), 'Extension context invalidated.'],
    ['Tab was closed', 'Tab was closed'],
    [{ code: 42 }, '[object Object]'],
    [undefined, '[object Undefined]'],
    [null, '[object Null]'],
  ])('describes %o as %s', (error, description) => {
    expect(describeError(error)).toBe(description);
  });
});
