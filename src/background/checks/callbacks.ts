/**
 * Category 5 — Integration Flow & Callback checks.
 */

import type { ScanPayload, Severity } from '../../shared/types.js';
import {
  collectIntegrationFlowSignals,
  detectIntegrationFlow,
  resolveIntegrationFlavor,
  type IntegrationFlow,
} from '../../shared/implementation-attributes.js';
import { createRegistry, type CheckContext } from './registry.js';

const CATEGORY = 'callbacks' as const;
const FLOW_DOCS = {
  advanced: {
    overview: 'https://docs.adyen.com/online-payments/build-your-integration/advanced-flow/',
    callbacks: {
      'Drop-in':
        'https://docs.adyen.com/online-payments/build-your-integration/advanced-flow/?platform=Web&integration=Drop-in#add',
      Components:
        'https://docs.adyen.com/online-payments/build-your-integration/advanced-flow/?platform=Web&integration=Components#add',
    },
  },
  sessions: {
    callbacks: {
      'Drop-in':
        'https://docs.adyen.com/online-payments/build-your-integration/sessions-flow?platform=Web&integration=Drop-in#configure',
      Components:
        'https://docs.adyen.com/online-payments/build-your-integration/sessions-flow?platform=Web&integration=Components#configure',
    },
  },
} as const;

type CheckoutConfig = NonNullable<ScanPayload['page']['checkoutConfig']>;
type CallbackValue = string | boolean | undefined;

/** Simplified outcome for internal helpers */
interface CheckOutcome {
  readonly severity: Severity;
  readonly title: string;
  readonly detail?: string;
  readonly remediation?: string;
  readonly docsUrl?: string;
}

function flowLabel(flow: IntegrationFlow): string {
  if (flow === 'sessions') return 'Sessions flow';
  if (flow === 'advanced') return 'Advanced flow';
  return 'Unknown';
}

function hasCallbackSignal(value: string | boolean | undefined): boolean {
  return value === true || (typeof value === 'string' && value !== '');
}

function joinSignals(signals: readonly string[]): string {
  if (signals.length === 0) return 'no strong flow signals';
  if (signals.length === 1) {
    return signals[0] ?? 'no strong flow signals';
  }
  const head = signals.slice(0, -1).join(', ');
  const tail = signals[signals.length - 1] ?? '';
  return `${head} and ${tail}`;
}

function describeFlow(payload: ScanPayload, flow: IntegrationFlow): string {
  const signals = collectIntegrationFlowSignals(payload);

  if (flow === 'sessions') {
    const sources: string[] = [];
    if (signals.hasSessionsRequest) sources.push('a Sessions API request');
    if (signals.hasSessionConfig) sources.push('a session object in checkout configuration');
    if (signals.hasAnalyticsSessionId) sources.push('an analytics sessionId');
    return `Sessions flow inferred from ${joinSignals(sources)}.`;
  }

  if (flow === 'advanced') {
    const sources: string[] = [];
    if (signals.hasCheckoutConfig) sources.push('checkout config');
    if (signals.hasAnalyticsData) sources.push('checkout analytics data');
    return `Advanced flow inferred from ${joinSignals(sources)}.`;
  }

  return 'No Sessions or Advanced flow signals were captured.';
}

function getFlowSensitiveCallbackDocsUrl(payload: ScanPayload, flow: IntegrationFlow): string {
  const callbackDocFlavor =
    resolveIntegrationFlavor(payload).flavor === 'Drop-in' ? 'Drop-in' : 'Components';
  if (flow === 'sessions') {
    return FLOW_DOCS.sessions.callbacks[callbackDocFlavor];
  }
  return FLOW_DOCS.advanced.callbacks[callbackDocFlavor];
}

interface AdvancedRequiredCallbackOptions {
  readonly label: string;
  readonly readCallback: (config: CheckoutConfig) => CallbackValue;
  readonly presentTitle: string;
  readonly missingTitle: string;
  readonly missingDetail?: string;
  readonly remediation: string;
}

function runAdvancedRequiredCallbackCheck(
  payload: ScanPayload,
  options: AdvancedRequiredCallbackOptions,
  { pass, fail, skip }: CheckContext
): CheckOutcome {
  const config = payload.page.checkoutConfig;
  if (!config) {
    return skip(`${options.label} check skipped — config not detected.`);
  }

  const flow = detectIntegrationFlow(payload);
  if (flow === 'sessions') {
    return skip(`${options.label} check skipped — Sessions flow detected.`);
  }

  if (hasCallbackSignal(options.readCallback(config))) {
    return pass(options.presentTitle);
  }

  return fail(
    options.missingTitle,
    options.missingDetail,
    options.remediation,
    FLOW_DOCS.advanced.overview
  );
}

interface FlowSensitiveOutcomeCallbackOptions {
  readonly label: string;
  readonly readCallback: (config: CheckoutConfig) => CallbackValue;
  readonly presentTitle: string;
  readonly missingTitle: string;
  readonly missingSessionsDetail: string;
  readonly missingAdvancedDetail: string;
  readonly missingSessionsRemediation: string;
  readonly missingAdvancedRemediation: string;
}

function runFlowSensitiveOutcomeCallbackCheck(
  payload: ScanPayload,
  options: FlowSensitiveOutcomeCallbackOptions,
  { pass, fail, skip, warn }: CheckContext
): CheckOutcome {
  const config = payload.page.checkoutConfig;
  if (!config) {
    return skip(`${options.label} check skipped — config not detected.`);
  }

  const flow = detectIntegrationFlow(payload);
  if (hasCallbackSignal(options.readCallback(config))) {
    return pass(options.presentTitle);
  }

  const docsUrl = getFlowSensitiveCallbackDocsUrl(payload, flow);
  if (flow === 'sessions') {
    return fail(
      options.missingTitle,
      options.missingSessionsDetail,
      options.missingSessionsRemediation,
      docsUrl
    );
  }

  return warn(
    options.missingTitle,
    options.missingAdvancedDetail,
    options.missingAdvancedRemediation,
    docsUrl
  );
}

export const CALLBACK_CHECKS = createRegistry(CATEGORY)
  .add('flow-type', (payload, { info }) => {
    const flow = detectIntegrationFlow(payload);
    return info(`Integration flow type: ${flowLabel(flow)}.`, describeFlow(payload, flow));
  })
  .add('callback-on-submit', (payload, context) => {
    return runAdvancedRequiredCallbackCheck(
      payload,
      {
        label: 'onSubmit',
        readCallback: (config) => config.onSubmit,
        presentTitle: 'onSubmit callback is present.',
        missingTitle: 'onSubmit callback is missing.',
        missingDetail: 'Advanced flow requires handling onSubmit to call your /payments endpoint.',
        remediation:
          "Add an onSubmit handler to your AdyenCheckout configuration. When the shopper submits payment details, forward the payment state to your server's /payments endpoint and then call actions.resolve() with the result or actions.reject() if the request fails.",
      },
      context
    );
  })
  .add('callback-on-additional-details', (payload, context) => {
    return runAdvancedRequiredCallbackCheck(
      payload,
      {
        label: 'onAdditionalDetails',
        readCallback: (config) => config.onAdditionalDetails,
        presentTitle: 'onAdditionalDetails callback is present.',
        missingTitle: 'onAdditionalDetails callback is missing (required for Advanced flow).',
        missingDetail:
          'Without onAdditionalDetails, 3DS and other follow-up actions cannot complete correctly.',
        remediation:
          'Add an onAdditionalDetails handler to your AdyenCheckout configuration. This callback fires when follow-up data is needed (such as after 3DS authentication).',
      },
      context
    );
  })
  .add('callback-on-payment-completed', (payload, context) => {
    return runFlowSensitiveOutcomeCallbackCheck(
      payload,
      {
        label: 'onPaymentCompleted',
        readCallback: (config) => config.onPaymentCompleted,
        presentTitle: 'onPaymentCompleted callback is present.',
        missingTitle: 'onPaymentCompleted callback is not set.',
        missingSessionsDetail:
          'For Sessions flow, onPaymentCompleted is the primary handler for authorised and refused outcomes.',
        missingAdvancedDetail:
          'Without onPaymentCompleted, successful outcomes may not trigger your confirmation and fulfillment logic.',
        missingSessionsRemediation:
          'Add an onPaymentCompleted handler to your AdyenCheckout configuration. For Sessions flow, this is the primary callback for payment outcomes.',
        missingAdvancedRemediation:
          'Add an onPaymentCompleted handler to receive notification when a payment is authorised.',
      },
      context
    );
  })
  .add('callback-on-payment-failed', (payload, context) => {
    return runFlowSensitiveOutcomeCallbackCheck(
      payload,
      {
        label: 'onPaymentFailed',
        readCallback: (config) => config.onPaymentFailed,
        presentTitle: 'onPaymentFailed callback is present.',
        missingTitle: 'onPaymentFailed callback is not set.',
        missingSessionsDetail:
          'For Sessions flow, onPaymentFailed handles refused and error payment outcomes.',
        missingAdvancedDetail:
          'Without onPaymentFailed, refused or errored payments can end without clear shopper recovery handling.',
        missingSessionsRemediation:
          'Add an onPaymentFailed handler to your AdyenCheckout configuration. For Sessions flow, this callback fires when a payment is refused or encounters an error.',
        missingAdvancedRemediation:
          'Add an onPaymentFailed handler to receive notification when a payment is refused.',
      },
      context
    );
  })
  .add('callback-on-error', (payload, { pass, fail, skip }) => {
    const config = payload.page.checkoutConfig;
    if (!config) {
      return skip('onError check skipped — config not detected.');
    }

    if (hasCallbackSignal(config.onError)) {
      return pass('onError callback is present.');
    }

    return fail(
      'onError callback is missing.',
      'Without onError, technical checkout failures can fail silently and block shopper recovery.',
      'Add an onError handler to your AdyenCheckout configuration to catch and respond to technical errors during the checkout lifecycle.',
      FLOW_DOCS.advanced.overview
    );
  })
  .add('callback-before-submit', (payload, { pass, info, skip }) => {
    const config = payload.page.checkoutConfig;
    if (!config) {
      return skip('beforeSubmit check skipped — config not detected.');
    }

    if (hasCallbackSignal(config.beforeSubmit)) {
      return pass('beforeSubmit callback is present (custom pay button flow).');
    }
    return info('beforeSubmit is not configured.');
  })
  .add('callback-actions-pattern', (payload, { skip, pass, warn, info }) => {
    const config = payload.page.checkoutConfig;
    if (!config) {
      return skip('Actions pattern check skipped — config not detected.');
    }

    const flow = detectIntegrationFlow(payload);
    if (flow === 'sessions') {
      return skip('Actions pattern check skipped — Sessions flow detected.');
    }

    const onSubmitSource = config.onSubmitSource ?? '';
    if (onSubmitSource === '') {
      return skip('Actions pattern check skipped — onSubmit source not available.');
    }

    if (/actions\.(resolve|reject)\(/.test(onSubmitSource)) {
      return pass('onSubmit uses the v6 actions.resolve() / actions.reject() pattern.');
    }

    if (/component\.(setStatus|handleAction)\(/.test(onSubmitSource)) {
      return warn(
        'onSubmit appears to use v5-style component callbacks — update to v6 actions pattern.',
        'v6 adopts actions.resolve() / actions.reject() inside onSubmit.',
        'Migrate your onSubmit handler from the v5-style component callbacks to the v6 actions pattern.',
        FLOW_DOCS.advanced.overview
      );
    }

    return info('Could not determine onSubmit callback pattern from static analysis.');
  })
  .getChecks();
