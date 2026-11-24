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
  return readOnSubmitSource(capturedWith({ onSubmitSources: [source] }), 'advanced');
}

describe('readOnSubmitSource availability', () => {
  it('needs captured checkout or component configuration', () => {
    const inferredOnly = makeScanPayload({
      page: makeCheckoutPage({
        observedConfig: {
          inferred: { 'adyen-request': { onSubmitSources: ['(state) => pay(state.data)'] } },
        },
      }),
    });

    expect(readOnSubmitSource(inferredOnly, 'advanced')).toEqual({
      status: 'unavailable',
      reason: 'no-config',
    });
  });

  it('is not read in Sessions flow, where Adyen Web handles submission', () => {
    const payload = capturedWith({ onSubmitSources: ['(state) => pay(state.data)'] });

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

  it.each([
    [
      'minified v6 parameters',
      'async(e,t,n)=>{const r=await pay(e.data.paymentMethod);if(!r)return void n.reject();n.resolve(r)}',
      { resolvesActions: true, usesComponentCallbacks: false },
    ],
    [
      'minified v5 parameters',
      'function(e,t){t.setStatus("loading"),pay(e.data).then(r=>t.handleAction(r.action))}',
      { resolvesActions: false, usesComponentCallbacks: true },
    ],
    [
      'parameters named with $',
      '($state, $component, $actions) => { $actions.resolve(r); }',
      { resolvesActions: true, usesComponentCallbacks: false },
    ],
    [
      'a member of another object with the actions name',
      '(e, t, n) => { other.n.resolve(r); }',
      { resolvesActions: false, usesComponentCallbacks: false },
    ],
    [
      'calls only in comments',
      '(state, component, actions) => { /* actions.resolve(r) */ pay(state.data); // component.setStatus("x")\n }',
      { resolvesActions: false, usesComponentCallbacks: false },
    ],
  ])('reads callback names from %s', (_label, source, expected) => {
    expect(readSource(source)).toMatchObject(expected);
  });

  it('reads a later parameter only when commas can be trusted to split the list', () => {
    expect(readSource('(state = {}, t, n) => n.resolve(r)')).toMatchObject({
      resolvesActions: false,
      stateData: { kind: 'unknown' },
    });
    expect(readSource('(state = 1, t, n) => n.resolve(state.data)')).toMatchObject({
      resolvesActions: true,
      stateData: { kind: 'whole' },
    });
  });
});

function readSources(...sources: string[]): ReturnType<typeof readOnSubmitSource> {
  return readOnSubmitSource(capturedWith({ onSubmitSources: sources }), 'advanced');
}

describe('readOnSubmitSource across several callbacks', () => {
  const RESOLVES_SELECTED =
    '(state, component, actions) => actions.resolve(pay({ pm: state.data.paymentMethod, b: state.data.browserInfo }))';

  it('reports a finding when any callback shows it', () => {
    expect(
      readSources(
        RESOLVES_SELECTED,
        "(state, c, actions) => { if (state.data.paymentMethod.type === 'paypal') actions.resolve(r); }",
        `(state) => post(state.data) ${'x'.repeat(CALLBACK_SOURCE_LIMIT)}`,
        '(state, component) => component.setStatus("loading")'
      )
    ).toMatchObject({
      truncated: true,
      unhandledFilters: { paymentMethod: true, actionCode: false },
      stateData: { kind: 'whole' },
      resolvesActions: false,
      usesComponentCallbacks: true,
    });
  });

  it('resolves through actions only when every callback does', () => {
    expect(readSources(RESOLVES_SELECTED, '(s, c, n) => n.reject()')).toMatchObject({
      resolvesActions: true,
    });
  });

  it('keeps the fields every callback reads, and every server field any callback sets', () => {
    expect(
      readSources(
        RESOLVES_SELECTED,
        '(s) => post({ amount, pm: s.data.paymentMethod, r: s.data.riskData })',
        '(s) => { s.data.reference = ref; post(s.data.paymentMethod); }'
      )
    ).toMatchObject({
      stateData: { kind: 'selected', fields: ['paymentMethod'], serverFields: ['reference'] },
    });
  });

  it('cannot read state.data handling when any callback is unreadable', () => {
    expect(readSources(RESOLVES_SELECTED, '({ data }) => post(data)')).toMatchObject({
      stateData: { kind: 'unknown', fields: [] },
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
    [
      'a filter that is commented out',
      "(state, component, actions) => {\n  // if (state.data.paymentMethod.type === 'paypal') return;\n  actions.resolve(r);\n}",
      { paymentMethod: false, actionCode: false },
    ],
    [
      'a minified filter that hands the renamed actions on',
      'async(e,t,n)=>{if("scheme"===e.data.paymentMethod.type){e.data.x=1}return pay(e.data,n)}',
      { paymentMethod: false, actionCode: false },
    ],
  ])('classifies %s', (_label, source, expected) => {
    expect(readSource(source)).toMatchObject({ unhandledFilters: expected });
  });
});

describe('readOnSubmitSource state.data forwarding', () => {
  it.each([
    ['a bare arrow', 'state => post(state.data)', 'whole'],
    ['an async arrow', 'async (state, component) => { await post(state.data); }', 'whole'],
    ['a method property', 'onSubmit: function (state) { post(state.data); }', 'whole'],
    ['an optional chain', '(state) => post(state?.data)', 'whole'],
    ['a spread', '(state) => post({ ...state.data, returnUrl })', 'whole'],
    ['a spread outside an object literal', 'state => post([...state.data])', 'whole'],
    [
      'a rest element that strips fields',
      '(state) => { const { clientStateDataIndicator, ...rest } = state.data; post(rest); }',
      'whole',
    ],
    [
      'a URL containing //',
      '(state) => fetch("https://shop.example/pay", { body: JSON.stringify(state.data) })',
      'whole',
    ],
    ['wholesale state forwarding', '(state) => post(state)', 'unknown'],
    ['a destructured parameter', '({ data }) => post(data)', 'unknown'],
    ['a source without a parameter list', 'handleSubmit', 'unknown'],
    ['an unterminated parameter list', 'function (state', 'unknown'],
    ['fields that exclude paymentMethod', '(state) => post(state.data.riskData)', 'unknown'],
    ['a nested field read', '(state) => track(state.data.paymentMethod.type)', 'unknown'],
  ])('classifies %s as %s', (_label, source, kind) => {
    expect(readSource(source)).toMatchObject({ stateData: { kind } });
  });

  it.each([
    [
      'dot access',
      '(s) => post({ pm: s.data.paymentMethod, b: s.data.browserInfo, again: s.data.paymentMethod })',
      ['browserInfo', 'paymentMethod'],
    ],
    [
      'bracket access',
      '(state) => post({ pm: state.data["paymentMethod"], o: state.data?.[\'origin\'] })',
      ['origin', 'paymentMethod'],
    ],
    [
      'destructuring',
      '(state) => { const { paymentMethod, riskData: risk } = state.data; post({ paymentMethod, risk }); }',
      ['paymentMethod', 'riskData'],
    ],
    [
      'member access on another object with the same name',
      '(state) => post(other.state.data, state.data.paymentMethod)',
      ['paymentMethod'],
    ],
    [
      'state.data in comments',
      '(state) => { /* post(state.data) */ post(state.data.paymentMethod); // or state.data\n }',
      ['paymentMethod'],
    ],
    [
      'logged state.data',
      '(state) => { console.log(state.data); post(state.data.paymentMethod); }',
      ['paymentMethod'],
    ],
    [
      'a log call cut off by truncation',
      '(state) => { post(state.data.paymentMethod); console.info(state.data',
      ['paymentMethod'],
    ],
  ])('reads selected fields from %s', (_label, source, fields) => {
    expect(readSource(source)).toMatchObject({ stateData: { kind: 'selected', fields } });
  });

  it.each([
    [
      'keys beside a spread',
      '(state) => post({ ...state.data, amount, "reference": ref, merchantAccount: \'Shop\' })',
      ['amount', 'merchantAccount', 'reference'],
    ],
    [
      'keys before a spread, past nested objects',
      '(state) => post({ amount: { value: 1 }, shopperReference: id, ...state.data })',
      ['amount', 'shopperReference'],
    ],
    [
      'an assignment on state.data',
      '(state) => { state.data.amount = total; if (state.data.reference === ref) post(state.data); }',
      ['amount'],
    ],
    [
      'an object cut off by truncation',
      '(state) => post({ ...state.data, amount: total, ref',
      ['amount'],
    ],
    [
      'keys in an unrelated object',
      '(state) => { post({ ...state.data }); show({ reference }); }',
      [],
    ],
  ])('reads server fields from %s', (_label, source, serverFields) => {
    expect(readSource(source)).toMatchObject({ stateData: { serverFields } });
  });
});

describe('readSubmissionGuard', () => {
  it.each([
    'button.disabled = true',
    'n.disabled=!0',
    'setLoading(true)',
    'setIsSubmitting(!0)',
    "button.setAttribute('disabled', '')",
    "button.classList.add('is-loading')",
    'this.isSubmitting = true',
    'r.isProcessing=!0',
  ])('recognises the guard %s in beforeSubmit source', (source) => {
    expect(readSubmissionGuard(capturedWith({ beforeSubmitSources: [source] }))).toEqual({
      status: 'read',
      guarded: true,
    });
  });

  it('reads onSubmit source without a guard pattern', () => {
    expect(
      readSubmissionGuard(
        capturedWith({ onSubmitSources: ['actions.resolve(await pay(state.data))'] })
      )
    ).toEqual({ status: 'read', guarded: false });
  });

  it('looks in every callback, but not in comments', () => {
    const guardedComponent = capturedWith({
      onSubmitSources: ['(s, c, a) => a.resolve(r)', '(s) => { button.disabled = true; }'],
    });
    const commentedOut = capturedWith({ onSubmitSources: ['() => { /* setLoading(true) */ }'] });

    expect(readSubmissionGuard(guardedComponent)).toEqual({ status: 'read', guarded: true });
    expect(readSubmissionGuard(commentedOut)).toEqual({ status: 'read', guarded: false });
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
