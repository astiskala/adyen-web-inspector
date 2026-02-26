import { describe, it, expect } from 'vitest';
import { CALLBACK_CHECKS } from '../../../src/background/checks/callbacks';
import {
  makeScanPayload,
  makeAdyenPayload,
  makePageExtract,
  makeRequest,
  makeCheckoutConfig,
  makeAnalyticsData,
} from '../../fixtures/makeScanPayload';
import { requireCheck } from './requireCheck';

const flowType = requireCheck(CALLBACK_CHECKS, 'flow-type');
const onSubmit = requireCheck(CALLBACK_CHECKS, 'callback-on-submit');
const onAdditionalDetails = requireCheck(CALLBACK_CHECKS, 'callback-on-additional-details');
const onPaymentCompleted = requireCheck(CALLBACK_CHECKS, 'callback-on-payment-completed');
const onPaymentFailed = requireCheck(CALLBACK_CHECKS, 'callback-on-payment-failed');
const onError = requireCheck(CALLBACK_CHECKS, 'callback-on-error');
const beforeSubmit = requireCheck(CALLBACK_CHECKS, 'callback-before-submit');
const actionsPattern = requireCheck(CALLBACK_CHECKS, 'callback-actions-pattern');

const sessionsRequests = [makeRequest('https://checkout-test.adyen.com/v71/sessions')];
const checkoutShopperSessionsRequests = [
  makeRequest('https://checkoutshopper-test.adyen.com/checkoutshopper/v1/sessions/'),
];
const ADVANCED_DROP_IN_CALLBACK_DOC =
  'https://docs.adyen.com/online-payments/build-your-integration/advanced-flow/?platform=Web&integration=Drop-in#add';
const ADVANCED_COMPONENTS_CALLBACK_DOC =
  'https://docs.adyen.com/online-payments/build-your-integration/advanced-flow/?platform=Web&integration=Components#add';
const SESSIONS_DROP_IN_CALLBACK_DOC =
  'https://docs.adyen.com/online-payments/build-your-integration/sessions-flow?platform=Web&integration=Drop-in#configure';
const SESSIONS_COMPONENTS_CALLBACK_DOC =
  'https://docs.adyen.com/online-payments/build-your-integration/sessions-flow?platform=Web&integration=Components#configure';

describe('flow-type', () => {
  it('reports sessions flow when sessions API is captured', () => {
    const payload = makeScanPayload({
      capturedRequests: sessionsRequests,
    });
    const result = flowType.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Sessions flow');
  });

  it('reports advanced flow when checkout config is present and no sessions signal', () => {
    const payload = makeAdyenPayload({}, {});
    const result = flowType.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Advanced flow');
    expect(result.detail).toContain('checkout config');
  });

  it('reports unknown flow when no Adyen API requests captured', () => {
    const payload = makeScanPayload();
    const result = flowType.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Unknown');
  });

  it('reports sessions flow from checkoutshopper /sessions/ URL', () => {
    const payload = makeScanPayload({
      capturedRequests: checkoutShopperSessionsRequests,
    });
    const result = flowType.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Sessions flow');
  });

  it('reports sessions flow from checkoutshopper /sessions/{id}/setup URL', () => {
    const payload = makeScanPayload({
      capturedRequests: [
        makeRequest(
          'https://checkoutshopper-test.adyen.com/checkoutshopper/v1/sessions/CS616abc/setup'
        ),
      ],
    });
    const result = flowType.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Sessions flow');
  });

  it('reports sessions flow when hasSession is true and no network match', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: makeCheckoutConfig({ hasSession: true }),
      }),
    });
    const result = flowType.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Sessions flow');
    expect(result.detail).toContain('session object in checkout configuration');
  });

  it('reports sessions flow from analytics sessionId signal', () => {
    const payload = makeScanPayload({
      analyticsData: makeAnalyticsData({ sessionId: 'session-id-123' }),
    });
    const result = flowType.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Sessions flow');
    expect(result.detail).toContain('analytics sessionId');
  });

  it('prefers network detection over hasSession', () => {
    const payload = makeScanPayload({
      capturedRequests: sessionsRequests,
      page: makePageExtract({
        checkoutConfig: makeCheckoutConfig({ hasSession: true }),
      }),
    });
    const result = flowType.run(payload);
    expect(result.severity).toBe('info');
    expect(result.title).toContain('Sessions flow');
    expect(result.detail).toContain('Sessions API request');
  });
});

describe('callback-on-additional-details', () => {
  it('passes when callback is present', () => {
    const payload = makeAdyenPayload({}, { onAdditionalDetails: 'function(state,c){...}' });
    expect(onAdditionalDetails.run(payload).severity).toBe('pass');
  });

  it('fails when callback is missing on advanced flow', () => {
    const payload = makeAdyenPayload({}, {});
    expect(onAdditionalDetails.run(payload).severity).toBe('fail');
  });

  it('skips when no config', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutConfig: null }),
    });
    expect(onAdditionalDetails.run(payload).severity).toBe('skip');
  });

  it('skips when sessions flow is detected', () => {
    const payload = makeAdyenPayload({}, {}, { capturedRequests: sessionsRequests });
    expect(onAdditionalDetails.run(payload).severity).toBe('skip');
  });
});

describe('callback-on-submit', () => {
  it('passes when callback is present on advanced flow', () => {
    const payload = makeAdyenPayload(
      {},
      { onSubmit: 'function(state,component,actions){ actions.resolve({}); }' }
    );
    expect(onSubmit.run(payload).severity).toBe('pass');
  });

  it('fails when callback is missing on advanced flow', () => {
    const payload = makeAdyenPayload({}, {});
    const result = onSubmit.run(payload);
    expect(result.severity).toBe('fail');
    expect(result.title).toBe('onSubmit callback is missing.');
  });

  it('fails when callback is missing on inferred advanced flow (no network)', () => {
    const payload = makeAdyenPayload({}, {});
    expect(onSubmit.run(payload).severity).toBe('fail');
  });

  it('skips when sessions flow is detected', () => {
    const payload = makeAdyenPayload({}, {}, { capturedRequests: sessionsRequests });
    expect(onSubmit.run(payload).severity).toBe('skip');
  });
});

describe('callback-on-payment-completed', () => {
  it('passes when callback is present', () => {
    const payload = makeAdyenPayload(
      {},
      { onPaymentCompleted: 'function(result,c){...}' },
      { capturedRequests: sessionsRequests }
    );
    expect(onPaymentCompleted.run(payload).severity).toBe('pass');
  });

  it('fails for sessions flow when missing', () => {
    const payload = makeAdyenPayload({}, {}, { capturedRequests: sessionsRequests });
    const result = onPaymentCompleted.run(payload);
    expect(result.severity).toBe('fail');
    expect(result.docsUrl).toBe(SESSIONS_COMPONENTS_CALLBACK_DOC);
    expect(result.detail).toContain('primary handler');
  });

  it('warns for advanced flow when missing', () => {
    const payload = makeAdyenPayload({}, {});
    const result = onPaymentCompleted.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.docsUrl).toBe(ADVANCED_COMPONENTS_CALLBACK_DOC);
    expect(result.detail).toContain('confirmation and fulfillment');
  });

  it('warns when advanced flow is inferred from config (no network)', () => {
    const payload = makeAdyenPayload({}, {});
    expect(onPaymentCompleted.run(payload).severity).toBe('warn');
  });

  it('skips when no config', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutConfig: null }),
    });
    expect(onPaymentCompleted.run(payload).severity).toBe('skip');
  });

  it('fails for sessions flow detected via hasSession (no network)', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: makeCheckoutConfig({ hasSession: true }),
      }),
    });
    expect(onPaymentCompleted.run(payload).severity).toBe('fail');
  });

  it('uses the Drop-in advanced docs link when flavor is Drop-in', () => {
    const payload = makeAdyenPayload(
      {},
      {},
      {
        analyticsData: makeAnalyticsData({ flavor: 'dropin' }),
      }
    );
    expect(onPaymentCompleted.run(payload).docsUrl).toBe(ADVANCED_DROP_IN_CALLBACK_DOC);
  });
});

describe('callback-on-payment-failed', () => {
  it('passes when callback is present', () => {
    const payload = makeAdyenPayload(
      {},
      { onPaymentFailed: 'function(r,c){...}' },
      { capturedRequests: sessionsRequests }
    );
    expect(onPaymentFailed.run(payload).severity).toBe('pass');
  });

  it('fails for sessions flow when missing', () => {
    const payload = makeAdyenPayload({}, {}, { capturedRequests: sessionsRequests });
    const result = onPaymentFailed.run(payload);
    expect(result.severity).toBe('fail');
    expect(result.docsUrl).toBe(SESSIONS_COMPONENTS_CALLBACK_DOC);
    expect(result.detail).toContain('refused and error payment outcomes');
  });

  it('warns for advanced flow when missing', () => {
    const payload = makeAdyenPayload({}, {});
    const result = onPaymentFailed.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.docsUrl).toBe(ADVANCED_COMPONENTS_CALLBACK_DOC);
    expect(result.detail).toContain('shopper recovery');
  });

  it('warns when advanced flow is inferred from config (no network)', () => {
    const payload = makeAdyenPayload({}, {});
    expect(onPaymentFailed.run(payload).severity).toBe('warn');
  });

  it('skips when no config', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutConfig: null }),
    });
    expect(onPaymentFailed.run(payload).severity).toBe('skip');
  });

  it('uses the Drop-in Sessions docs link when flavor is Drop-in', () => {
    const payload = makeAdyenPayload(
      {},
      {},
      {
        capturedRequests: sessionsRequests,
        analyticsData: makeAnalyticsData({ flavor: 'dropin' }),
      }
    );
    expect(onPaymentFailed.run(payload).docsUrl).toBe(SESSIONS_DROP_IN_CALLBACK_DOC);
  });
});

describe('callback-on-error', () => {
  it('passes when callback is present', () => {
    const payload = makeAdyenPayload({}, { onError: 'function(e,c){...}' });
    expect(onError.run(payload).severity).toBe('pass');
  });

  it('fails when callback is missing', () => {
    const payload = makeAdyenPayload({}, { onError: undefined });
    const result = onError.run(payload);
    expect(result.severity).toBe('fail');
    expect(result.title).toBe('onError callback is missing.');
    expect(result.detail).toContain('technical checkout failures can fail silently');
  });
});

describe('callback-before-submit', () => {
  it('passes when callback is present', () => {
    const payload = makeAdyenPayload({}, { beforeSubmit: 'function(d,c,a){...}' });
    expect(beforeSubmit.run(payload).severity).toBe('pass');
  });

  it('returns info when callback is absent', () => {
    const payload = makeAdyenPayload({}, { beforeSubmit: undefined });
    expect(beforeSubmit.run(payload).severity).toBe('info');
  });
});

describe('callback-actions-pattern', () => {
  it('passes when onSubmit uses v6 actions.resolve pattern', () => {
    const payload = makeAdyenPayload(
      {},
      { onSubmitSource: 'async (state, component, actions) => { actions.resolve(result); }' }
    );
    expect(actionsPattern.run(payload).severity).toBe('pass');
  });

  it('warns when onSubmit uses v5 component pattern', () => {
    const payload = makeAdyenPayload(
      {},
      { onSubmitSource: 'function(state, component) { component.setStatus("loading"); }' }
    );
    expect(actionsPattern.run(payload).severity).toBe('warn');
  });

  it('returns info when pattern cannot be determined', () => {
    const payload = makeAdyenPayload({}, { onSubmitSource: 'doSomething()' });
    expect(actionsPattern.run(payload).severity).toBe('info');
  });

  it('skips when no config', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutConfig: null }),
    });
    expect(actionsPattern.run(payload).severity).toBe('skip');
  });

  it('skips when no onSubmitSource', () => {
    const payload = makeAdyenPayload({}, { onSubmitSource: undefined });
    expect(actionsPattern.run(payload).severity).toBe('skip');
  });

  it('skips when flow is not advanced', () => {
    const payload = makeAdyenPayload(
      {},
      { onSubmitSource: 'actions.resolve(result);' },
      { capturedRequests: sessionsRequests }
    );
    expect(actionsPattern.run(payload).severity).toBe('skip');
  });
});
