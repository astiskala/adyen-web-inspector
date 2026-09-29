import { describe, expect, it } from 'vitest';
import {
  readOnSubmitSource,
  readSubmissionGuard,
} from '../../../src/background/checks/callback-source';
import { CALLBACK_SOURCE_LIMIT } from '../../../src/shared/checkout-config-schema';
import type { CheckoutConfig, ScanPayload } from '../../../src/shared/types';
import {
  makeAdyenPayload,
  makeCheckoutPage,
  makeScanPayload,
} from '../../fixtures/makeScanPayload';

function capturedWith(config: CheckoutConfig): ScanPayload {
  return makeAdyenPayload({}, config);
}

function readSource(source: string): ReturnType<typeof readOnSubmitSource> {
  return readOnSubmitSource(capturedWith({ onSubmitSource: source }), 'advanced');
}

describe('readOnSubmitSource availability', () => {
  it('needs captured checkout or component configuration', () => {
    const inferredOnly = makeScanPayload({
      page: makeCheckoutPage({ inferredConfig: { onSubmitSource: '(state) => pay(state.data)' } }),
    });

    expect(readOnSubmitSource(inferredOnly, 'advanced')).toEqual({
      status: 'unavailable',
      reason: 'no-config',
    });
  });

  it('is not read in Sessions flow, where Adyen Web handles submission', () => {
    const payload = capturedWith({ onSubmitSource: '(state) => pay(state.data)' });

    expect(readOnSubmitSource(payload, 'sessions')).toEqual({
      status: 'unavailable',
      reason: 'sessions-flow',
    });
  });

  it('reports captured configuration without onSubmit source', () => {
    expect(readOnSubmitSource(capturedWith({}), 'advanced')).toEqual({
      status: 'unavailable',
      reason: 'no-source',
    });
  });

  it('marks source at the capture limit as possibly truncated', () => {
    const complete = readSource('(state) => pay(state.data)');
    const cutOff = readSource(`(state) => pay(state.data) ${'x'.repeat(CALLBACK_SOURCE_LIMIT)}`);

    expect(complete).toMatchObject({ status: 'read', truncated: false });
    expect(cutOff).toMatchObject({ status: 'read', truncated: true });
  });

  it('recognises the v6 actions and v5 component callback patterns', () => {
    expect(readSource('(s, c, actions) => actions.resolve(r)')).toMatchObject({
      resolvesActions: true,
      usesComponentCallbacks: false,
    });
    expect(readSource('(s, component) => component.handleAction(a)')).toMatchObject({
      resolvesActions: false,
      usesComponentCallbacks: true,
    });
  });
});

describe('readOnSubmitSource unhandled filters', () => {
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
    [
      'an unterminated if condition',
      "(state) => { if (state.data.paymentMethod.type === 'scheme' ",
      { paymentMethod: false, actionCode: false },
    ],
    [
      'an unterminated switch condition',
      "(state) => { switch (action.type { case 'x': }",
      { paymentMethod: false, actionCode: false },
    ],
    [
      'an unterminated switch body',
      "(state) => { switch (action.type) { case 'redirect': go();",
      { paymentMethod: false, actionCode: false },
    ],
    [
      'a statement that ends at a newline',
      "if (paymentMethod.type === 'scheme') pay(state)\nelse other()",
      { paymentMethod: false, actionCode: false },
    ],
    [
      'a statement that runs to the end of the source',
      "if (paymentMethod.type === 'scheme') pay(state)",
      { paymentMethod: true, actionCode: false },
    ],
  ])('classifies %s', (_label, source, expected) => {
    expect(readSource(source)).toMatchObject({ unhandledFilters: expected });
  });
});

describe('readOnSubmitSource state.data forwarding', () => {
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
    expect(readSource(source)).toMatchObject({ stateData: { kind } });
  });

  it('lists selected fields in sorted order', () => {
    expect(
      readSource(
        '(s) => post({ pm: s.data.paymentMethod, b: s.data.browserInfo, again: s.data.paymentMethod })'
      )
    ).toMatchObject({ stateData: { kind: 'partial', fields: ['browserInfo', 'paymentMethod'] } });
  });

  it('ignores member access on another object with the same name', () => {
    expect(readSource('(state) => post(other.state.data, state.data.paymentMethod)')).toMatchObject(
      { stateData: { kind: 'partial', fields: ['paymentMethod'] } }
    );
  });
});

describe('readSubmissionGuard', () => {
  it.each([
    'button.disabled = true',
    'setLoading(true)',
    "button.setAttribute('disabled', '')",
    "button.classList.add('is-loading')",
    'this.isSubmitting = true',
  ])('recognises the guard %s in beforeSubmit source', (source) => {
    expect(readSubmissionGuard(capturedWith({ beforeSubmitSource: source }))).toEqual({
      status: 'read',
      guarded: true,
    });
  });

  it('reads onSubmit source without a guard pattern', () => {
    expect(
      readSubmissionGuard(
        capturedWith({ onSubmitSource: 'actions.resolve(await pay(state.data))' })
      )
    ).toEqual({ status: 'read', guarded: false });
  });

  it('is unavailable without configuration or callback source', () => {
    expect(readSubmissionGuard(makeScanPayload())).toEqual({
      status: 'unavailable',
      reason: 'no-config',
    });
    expect(readSubmissionGuard(capturedWith({}))).toEqual({
      status: 'unavailable',
      reason: 'no-source',
    });
  });
});
