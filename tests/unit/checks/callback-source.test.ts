import { describe, expect, it } from 'vitest';
import {
  detectStateDataForwarding,
  detectUnhandledOnSubmitFilters,
  detectsMultipleSubmissions,
} from '../../../src/background/checks/callback-source';

describe('detectUnhandledOnSubmitFilters', () => {
  it.each([
    [
      'single-statement if without else',
      "(state, component, actions) => { if (state.data.paymentMethod.type === 'scheme') pay(state); }",
      { paymentMethod: true, actionCode: false },
    ],
    [
      'if followed by else',
      "(state) => { if (state.data.paymentMethod.type === 'scheme') { pay(state); } else { other(state); } }",
      { paymentMethod: false, actionCode: false },
    ],
    [
      'bracket access to the type field',
      "(state) => { if (state.data.paymentMethod['type'] === 'scheme') { pay(state); } }",
      { paymentMethod: true, actionCode: false },
    ],
    [
      'resultCode switch without default',
      "(state) => { switch (response.resultCode) { case 'Authorised': done(); break; } }",
      { paymentMethod: false, actionCode: true },
    ],
    [
      'switch with default',
      "(state) => { switch (action.type) { case 'redirect': go(); break; default: fallback(); } }",
      { paymentMethod: false, actionCode: false },
    ],
    [
      'switch without a block body',
      '(state) => { switch (action.type) return; if (ready) { pay(state); } }',
      { paymentMethod: false, actionCode: false },
    ],
    [
      'if without a string literal',
      '(state) => { if (state.data.paymentMethod.type === expected) { pay(state); } }',
      { paymentMethod: false, actionCode: false },
    ],
  ])('classifies %s', (_label, source, expected) => {
    expect(detectUnhandledOnSubmitFilters(source)).toEqual(expected);
  });

  it.each([
    [
      'an unterminated if condition',
      "(state) => { if (state.data.paymentMethod.type === 'scheme' ",
    ],
    ['an unterminated switch condition', "(state) => { switch (action.type { case 'x': }"],
    ['an unterminated switch body', "(state) => { switch (action.type) { case 'redirect': go();"],
  ])('treats %s as unhandled-free', (_label, source) => {
    expect(detectUnhandledOnSubmitFilters(source)).toEqual({
      paymentMethod: false,
      actionCode: false,
    });
  });

  it('ends a filtered statement at a newline when it has no semicolon', () => {
    expect(
      detectUnhandledOnSubmitFilters(
        "if (paymentMethod.type === 'scheme') pay(state)\nelse other()"
      )
    ).toEqual({ paymentMethod: false, actionCode: false });
  });

  it('reads a filtered statement that runs to the end of the source', () => {
    expect(
      detectUnhandledOnSubmitFilters("if (paymentMethod.type === 'scheme') pay(state)")
    ).toEqual({ paymentMethod: true, actionCode: false });
  });
});

describe('detectStateDataForwarding', () => {
  it.each([
    ['a bare arrow', 'state => post(state.data)', 'complete'],
    ['an async arrow', 'async (state, component) => { await post(state.data); }', 'complete'],
    ['a method property', 'onSubmit: function (state) { post(state.data); }', 'complete'],
    ['an optional chain', '(state) => post(state?.data)', 'complete'],
    ['wholesale state forwarding', '(state) => post(state)', 'unknown'],
    ['a destructured parameter', '({ data }) => post(data)', 'unknown'],
    ['a source without a parameter list', 'handleSubmit', 'unknown'],
    ['an unterminated parameter list', 'function (state', 'unknown'],
    ['fields that exclude paymentMethod', '(state) => post(state.data.riskData)', 'unknown'],
  ])('classifies %s as %s', (_label, source, kind) => {
    expect(detectStateDataForwarding(source).kind).toBe(kind);
  });

  it('lists selected fields in sorted order', () => {
    expect(
      detectStateDataForwarding(
        '(s) => post({ pm: s.data.paymentMethod, b: s.data.browserInfo, again: s.data.paymentMethod })'
      )
    ).toEqual({ kind: 'partial', fields: ['browserInfo', 'paymentMethod'] });
  });

  it('ignores member access on another object with the same name', () => {
    expect(
      detectStateDataForwarding('(state) => post(other.state.data, state.data.paymentMethod)')
    ).toEqual({ kind: 'partial', fields: ['paymentMethod'] });
  });
});

describe('detectsMultipleSubmissions', () => {
  it.each([
    'button.disabled = true',
    'setLoading(true)',
    "button.setAttribute('disabled', '')",
    "button.classList.add('is-loading')",
    'this.isSubmitting = true',
  ])('recognises the guard %s', (source) => {
    expect(detectsMultipleSubmissions(source)).toBe(true);
  });

  it('returns false when no guard pattern appears', () => {
    expect(detectsMultipleSubmissions('actions.resolve(await pay(state.data))')).toBe(false);
  });
});
