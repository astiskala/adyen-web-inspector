/**
 * Callback checks (`callbacks`) — integration flow, required and outcome callbacks, onSubmit
 * handling, duplicate submissions, and custom pay buttons.
 */

import type {
  CheckoutConfig,
  ImplementationAttributes,
  IntegrationFlow,
  ScanPayload,
} from '../../shared/types.js';
import type { CALLBACK_KEYS } from '../../shared/checkout-config-schema.js';
import { INTEGRATION_FLOW_LABELS } from '../../shared/constants.js';
import {
  hasCapturedCheckoutConfig,
  readCheckoutField,
  type CheckoutFieldEvidence,
} from '../../shared/scan-evidence.js';
import { readOnSubmitSource, readSubmissionGuard, type OnSubmitSource } from './callback-source.js';
import { documentationIntegration, SKIP_REASONS } from './constants.js';
import { readPayButtonVisibility, type HiddenBy } from './pay-button.js';
import { createRegistry, type CheckContext, type CheckOutcome } from './registry.js';

const CATEGORY = 'callbacks' as const;
const FLOW_DOCS = {
  advanced: {
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

type CallbackKey = (typeof CALLBACK_KEYS)[number];

const CAPTURED_ONLY = { includeInferred: false } as const;

function flowLabel(flow: IntegrationFlow): string {
  const label = INTEGRATION_FLOW_LABELS[flow];
  return flow === 'unknown' ? label : `${label} flow`;
}

function readCallback(payload: ScanPayload, key: CallbackKey): CheckoutFieldEvidence<CallbackKey> {
  return readCheckoutField(payload, key, CAPTURED_ONLY);
}

/**
Skip reason for onSubmit source that could not be read.
 */
function unavailableSourceReason(
  source: Extract<OnSubmitSource, { status: 'unavailable' }>
): string {
  if (source.reason === 'no-config') return SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED;
  return source.reason === 'sessions-flow'
    ? STRINGS.SESSIONS_FLOW_SKIP_REASON
    : STRINGS.NO_SOURCE_SKIP_REASON;
}

function isConfigMissing<K extends keyof CheckoutConfig>(
  evidence: CheckoutFieldEvidence<K>
): boolean {
  return evidence.state === 'unobserved' && evidence.reason === 'no-config';
}

function componentLevelWarning(
  label: CallbackKey,
  documentationUrl: string,
  { warn }: CheckContext
): CheckOutcome {
  return warn(
    `${label} is handled at the component level.`,
    `${label} was detected on a component rather than AdyenCheckout. Registering callbacks at the AdyenCheckout level ensures they apply to all payment methods.`,
    `Move ${label} from your component configuration to the AdyenCheckout initialisation.`,
    documentationUrl
  );
}

const SIGNAL_LIST = new Intl.ListFormat('en', { type: 'conjunction' });

/**
A known flow always has at least one signal: Advanced flow requires checkout configuration.
 */
function describeFlow({ value: flow, signals }: ImplementationAttributes['flow']): string {
  if (flow === 'sessions') {
    const sources: string[] = [];
    if (signals.hasSessionsRequest) sources.push('a Sessions API request');
    if (signals.hasSessionConfig) sources.push('a session object in checkout configuration');
    if (signals.hasAnalyticsSessionId) sources.push('an analytics sessionId');
    return `Sessions flow inferred from ${SIGNAL_LIST.format(sources)}.`;
  }

  if (flow === 'advanced') {
    const sources = ['checkout config'];
    if (signals.hasAnalyticsData) sources.push('checkout analytics data');
    return `Advanced flow inferred from ${SIGNAL_LIST.format(sources)}.`;
  }

  return STRINGS.FLOW_UNKNOWN_DETAIL;
}

function getMakePaymentDocumentationUrl(attributes: ImplementationAttributes): string {
  return `https://docs.adyen.com/online-payments/build-your-integration/advanced-flow/?platform=Web&integration=${documentationIntegration(attributes)}#make-a-payment`;
}

function getFlowSensitiveCallbackDocumentationUrl(
  attributes: ImplementationAttributes,
  flow: IntegrationFlow
): string {
  const documentationFlow = flow === 'sessions' ? 'sessions' : 'advanced';
  return FLOW_DOCS[documentationFlow].callbacks[documentationIntegration(attributes)];
}

const STRINGS = {
  FLOW_UNKNOWN_DETAIL: 'No Sessions or Advanced flow signals were captured.',

  SESSIONS_FLOW_SKIP_REASON: 'Sessions flow detected.',
  NO_SOURCE_SKIP_REASON: 'onSubmit source not available.',
  CALLBACK_ABSENCE_UNVERIFIED_REASON: 'Callback absence could not be verified in partial config.',

  ON_SUBMIT_PASS_TITLE: 'onSubmit callback is present.',
  ON_SUBMIT_FAIL_TITLE: 'onSubmit callback is missing.',
  ON_SUBMIT_FAIL_DETAIL:
    'Advanced flow requires handling onSubmit to call your /payments endpoint.',
  ON_SUBMIT_FAIL_REMEDIATION:
    "Add an onSubmit handler to your AdyenCheckout configuration. When the shopper submits payment details, forward the payment state to your server's /payments endpoint and then call actions.resolve() with the result or actions.reject() if the request fails.",

  SUBMIT_FILTER_WARN_TITLE:
    'onSubmit appears to leave some payment methods or action codes unhandled.',
  // SUBMIT_FILTER_WARN_DETAIL stays inline (dynamic: uses joinSignals(filteredTargets))
  SUBMIT_FILTER_WARN_REMEDIATION:
    'Refactor onSubmit so all submissions follow a generic fallback path. Method-specific or action-specific logic can be added as an exception, but all other cases should still call actions.resolve(...) or actions.reject(...).',
  SUBMIT_FILTER_NOTICE_TITLE: 'Verify that onSubmit handles every payment method and action code.',
  SUBMIT_FILTER_NOTICE_DETAIL:
    'A resolution call was found, but static source inspection cannot verify every payment method and action code reaches it.',
  SUBMIT_FILTER_SKIP_TITLE: 'onSubmit filtering check skipped.',
  SUBMIT_FILTER_TRUNCATED_DETAIL:
    'Captured callback source may be truncated, so complete handling cannot be verified.',
  SUBMIT_FILTER_INFO_TITLE: 'Could not determine onSubmit fallback coverage from callback source.',

  STATE_DATA_SKIP_TITLE: 'onSubmit state.data forwarding check skipped.',
  STATE_DATA_PASS_TITLE: 'onSubmit forwards the complete state.data object.',
  STATE_DATA_WARN_TITLE: 'onSubmit appears to forward only selected state.data fields.',
  STATE_DATA_NOTICE_TITLE: 'Verify that onSubmit forwards the complete state.data object.',
  STATE_DATA_INFO_TITLE: 'Could not determine how onSubmit forwards state.data.',
  STATE_DATA_REMEDIATION:
    'Send the complete state.data object from onSubmit to your server, and pass all of its fields in the /payments request instead of rebuilding it from selected properties.',

  ON_ADD_DETAILS_PASS_TITLE: 'onAdditionalDetails callback is present.',
  ON_ADD_DETAILS_FAIL_TITLE: 'onAdditionalDetails callback is missing.',
  ON_ADD_DETAILS_FAIL_DETAIL:
    'Without onAdditionalDetails, 3DS and other follow-up actions cannot complete correctly.',
  ON_ADD_DETAILS_FAIL_REMEDIATION:
    'Add an onAdditionalDetails handler to your AdyenCheckout configuration. This callback fires when follow-up data is needed (such as after 3DS authentication).',

  ON_PAYMENT_COMPLETED_PASS_TITLE: 'onPaymentCompleted callback is present.',
  ON_PAYMENT_COMPLETED_MISSING_TITLE: 'onPaymentCompleted callback is not set.',
  ON_PAYMENT_COMPLETED_SESSIONS_DETAIL:
    'For Sessions flow, onPaymentCompleted provides the immediate browser-side authorised outcome for shopper-facing UI. Use webhooks as the source of truth for business logic.',
  ON_PAYMENT_COMPLETED_ADVANCED_DETAIL:
    'Without onPaymentCompleted, the browser may not show confirmation or next-step UI after a successful payment. Use webhooks as the source of truth for business logic.',
  ON_PAYMENT_COMPLETED_SESSIONS_REMEDIATION:
    'Add an onPaymentCompleted handler to present the shopper-facing outcome. Do not use this client-side callback as the sole trigger for fulfilment; accept Adyen webhooks on your server.',
  ON_PAYMENT_COMPLETED_ADVANCED_REMEDIATION:
    'Add an onPaymentCompleted handler to update the shopper-facing UI when a payment is authorised. Keep server-side business logic driven by Adyen webhooks.',

  ON_PAYMENT_FAILED_PASS_TITLE: 'onPaymentFailed callback is present.',
  ON_PAYMENT_FAILED_MISSING_TITLE: 'onPaymentFailed callback is not set.',
  ON_PAYMENT_FAILED_SESSIONS_DETAIL:
    'For Sessions flow, onPaymentFailed handles refused and error payment outcomes.',
  ON_PAYMENT_FAILED_ADVANCED_DETAIL:
    'Without onPaymentFailed, refused or errored payments can end without clear shopper recovery handling.',
  ON_PAYMENT_FAILED_SESSIONS_REMEDIATION:
    'Add an onPaymentFailed handler to your AdyenCheckout configuration. For Sessions flow, this callback fires when a payment is refused or encounters an error.',
  ON_PAYMENT_FAILED_ADVANCED_REMEDIATION:
    'Add an onPaymentFailed handler to receive notification when a payment is refused.',

  ON_ERROR_SKIP_TITLE: 'onError check skipped.',
  ON_ERROR_PASS_TITLE: 'onError callback is present.',
  ON_ERROR_FAIL_TITLE: 'onError callback is missing.',
  ON_ERROR_FAIL_DETAIL:
    'Without onError, technical checkout failures can fail silently and block shopper recovery.',
  ON_ERROR_FAIL_REMEDIATION:
    'Add an onError handler to your AdyenCheckout configuration to catch and respond to technical errors during the checkout lifecycle.',

  BEFORE_SUBMIT_SKIP_TITLE: 'beforeSubmit check skipped.',
  BEFORE_SUBMIT_PASS_TITLE: 'beforeSubmit callback is present.',
  BEFORE_SUBMIT_INFO_TITLE: 'beforeSubmit is not configured.',

  ACTIONS_PATTERN_SKIP_TITLE: 'Actions pattern check skipped.',
  ACTIONS_PATTERN_PASS_TITLE: 'onSubmit uses the v6 actions.resolve() / actions.reject() pattern.',
  ACTIONS_PATTERN_WARN_TITLE:
    'onSubmit appears to use v5-style component callbacks. Update to v6 actions pattern.',
  ACTIONS_PATTERN_WARN_DETAIL: 'v6 adopts actions.resolve() / actions.reject() inside onSubmit.',
  ACTIONS_PATTERN_WARN_REMEDIATION:
    'Migrate your onSubmit handler from the v5-style component callbacks to the v6 actions pattern.',
  ACTIONS_PATTERN_INFO_TITLE: 'Could not determine onSubmit callback pattern from static analysis.',

  MULTIPLE_SUBMISSIONS_SKIP_TITLE: 'Multiple submissions check skipped.',
  MULTIPLE_SUBMISSIONS_NO_SOURCE_SKIP_REASON: 'Callback source not available.',
  MULTIPLE_SUBMISSIONS_INFO_TITLE:
    'A possible duplicate-submission guard was found in callback source.',
  MULTIPLE_SUBMISSIONS_INFO_DETAIL:
    'A source pattern suggests a guard may be present; its runtime behavior cannot be verified automatically.',
  MULTIPLE_SUBMISSIONS_NOTICE_TITLE: 'Ensure your checkout prevents multiple submissions.',
  MULTIPLE_SUBMISSIONS_DETAIL:
    'To prevent duplicate orders, you should disable your pay button as soon as a payment attempt is made.',
  MULTIPLE_SUBMISSIONS_REMEDIATION:
    'Inside your onSubmit or beforeSubmit handler, add logic to disable the pay button or set a loading state until the payment lifecycle completes.',
  MULTIPLE_SUBMISSIONS_URL:
    'https://docs.adyen.com/online-payments/web-best-practices/#prevent-multiple-submissions',

  CUSTOM_PAY_BUTTON_COMPAT_SKIP_TITLE: 'Custom pay button compatibility check skipped.',
  CUSTOM_PAY_BUTTON_COMPAT_NOT_REPORTED_SKIP_REASON:
    'No component reported its pay button in Adyen checkout analytics. Analytics may be disabled, the SDK may be older than v6, or the scan ran within about 10 seconds of checkout rendering; rescan once checkout has been open for a few seconds.',
  CUSTOM_PAY_BUTTON_COMPAT_PASS_TITLE:
    'PayPal, Klarna, and Click to Pay keep the pay button their component renders.',
  // CUSTOM_PAY_BUTTON_COMPAT_ISSUE_TITLE stays inline (dynamic: lists the affected payment methods)
  CUSTOM_PAY_BUTTON_COMPAT_ISSUE_DETAIL:
    'Adyen Web does not support a custom pay button for PayPal, Klarna, or Click to Pay. With showPayButton set to false, PayPal renders no button and rejects submit() calls.',
  CUSTOM_PAY_BUTTON_COMPAT_REMEDIATION:
    'Keep showPayButton enabled for PayPal, Klarna, and Click to Pay, for example by overriding it in their component or paymentMethodsConfiguration entry, so shoppers use the button the component renders.',
  CUSTOM_PAY_BUTTON_COMPAT_URL:
    'https://docs.adyen.com/online-payments/web-best-practices/#unsupported-payment-methods',
} as const;

const BUTTON_REQUIRED_METHOD_LABELS = {
  paypal: 'PayPal',
  klarna: 'Klarna',
  clicktopay: 'Click to Pay',
} as const;

const HIDDEN_BY_PHRASES: Record<HiddenBy, string> = {
  rendered: 'rendered with showPayButton: false',
  'method-config': 'has showPayButton: false in paymentMethodsConfiguration',
  'checkout-config': 'inherits showPayButton: false from AdyenCheckout',
};

interface AdvancedRequiredCallbackOptions {
  readonly key: CallbackKey;
  readonly presentTitle: string;
  readonly missingTitle: string;
  readonly missingDetail?: string;
  readonly remediation: string;
}

function runAdvancedRequiredCallbackCheck(
  payload: ScanPayload,
  options: AdvancedRequiredCallbackOptions,
  context: CheckContext
): CheckOutcome {
  const { attributes, pass, fail, skip } = context;
  const label = options.key;
  const evidence = readCallback(payload, label);

  if (isConfigMissing(evidence)) {
    return skip(`${label} check skipped.`, SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
  }
  if (attributes.flow.value === 'sessions') {
    return skip(`${label} check skipped.`, STRINGS.SESSIONS_FLOW_SKIP_REASON);
  }

  const documentationUrl = getFlowSensitiveCallbackDocumentationUrl(attributes, 'advanced');
  if (evidence.state === 'present') {
    return evidence.value === 'component'
      ? componentLevelWarning(label, documentationUrl, context)
      : pass(options.presentTitle);
  }
  return evidence.state === 'unobserved'
    ? skip(`${label} check skipped.`, STRINGS.CALLBACK_ABSENCE_UNVERIFIED_REASON)
    : fail(options.missingTitle, options.missingDetail, options.remediation, documentationUrl);
}

interface FlowSensitiveOutcomeCallbackOptions {
  readonly key: CallbackKey;
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
  context: CheckContext
): CheckOutcome {
  const { attributes, pass, fail, skip, warn } = context;
  const label = options.key;
  const evidence = readCallback(payload, label);

  if (isConfigMissing(evidence)) {
    return skip(`${label} check skipped.`, SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
  }

  const flow = attributes.flow.value;
  const documentationUrl = getFlowSensitiveCallbackDocumentationUrl(attributes, flow);
  if (evidence.state === 'present') {
    return evidence.value === 'component'
      ? componentLevelWarning(label, documentationUrl, context)
      : pass(options.presentTitle);
  }
  if (evidence.state === 'unobserved') {
    return skip(`${label} check skipped.`, STRINGS.CALLBACK_ABSENCE_UNVERIFIED_REASON);
  }
  return flow === 'sessions'
    ? fail(
        options.missingTitle,
        options.missingSessionsDetail,
        options.missingSessionsRemediation,
        documentationUrl
      )
    : warn(
        options.missingTitle,
        options.missingAdvancedDetail,
        options.missingAdvancedRemediation,
        documentationUrl
      );
}

export const CALLBACK_CHECKS = createRegistry(CATEGORY)
  .add('flow-type', (_payload, { attributes, info }) => {
    const { flow } = attributes;
    return info(`Integration flow type: ${flowLabel(flow.value)}.`, describeFlow(flow));
  })
  .add('callback-on-submit', (payload, context) =>
    runAdvancedRequiredCallbackCheck(
      payload,
      {
        key: 'onSubmit',
        presentTitle: STRINGS.ON_SUBMIT_PASS_TITLE,
        missingTitle: STRINGS.ON_SUBMIT_FAIL_TITLE,
        missingDetail: STRINGS.ON_SUBMIT_FAIL_DETAIL,
        remediation: STRINGS.ON_SUBMIT_FAIL_REMEDIATION,
      },
      context
    )
  )
  .add('callback-on-submit-filtering', (payload, { attributes, skip, warn, notice, info }) => {
    const onSubmit = readOnSubmitSource(payload, attributes.flow.value);
    if (onSubmit.status === 'unavailable') {
      return skip(STRINGS.SUBMIT_FILTER_SKIP_TITLE, unavailableSourceReason(onSubmit));
    }
    if (onSubmit.truncated) {
      return notice(STRINGS.SUBMIT_FILTER_NOTICE_TITLE, STRINGS.SUBMIT_FILTER_TRUNCATED_DETAIL);
    }

    const filters = onSubmit.unhandledFilters;
    if (filters.paymentMethod || filters.actionCode) {
      const filteredTargets: string[] = [];
      if (filters.paymentMethod) {
        filteredTargets.push('payment methods');
      }
      if (filters.actionCode) {
        filteredTargets.push('action codes');
      }

      return warn(
        STRINGS.SUBMIT_FILTER_WARN_TITLE,
        `Static analysis detected selective filtering on ${SIGNAL_LIST.format(filteredTargets)} without a clear catch-all branch (else/default).`,
        STRINGS.SUBMIT_FILTER_WARN_REMEDIATION,
        getFlowSensitiveCallbackDocumentationUrl(attributes, 'advanced')
      );
    }

    return onSubmit.resolvesActions
      ? notice(
          STRINGS.SUBMIT_FILTER_NOTICE_TITLE,
          STRINGS.SUBMIT_FILTER_NOTICE_DETAIL,
          STRINGS.SUBMIT_FILTER_WARN_REMEDIATION,
          getFlowSensitiveCallbackDocumentationUrl(attributes, 'advanced')
        )
      : info(STRINGS.SUBMIT_FILTER_INFO_TITLE);
  })
  .add(
    'callback-on-submit-state-data',
    (payload, { attributes, skip, pass, warn, notice, info }) => {
      const onSubmit = readOnSubmitSource(payload, attributes.flow.value);
      if (onSubmit.status === 'unavailable') {
        return skip(STRINGS.STATE_DATA_SKIP_TITLE, unavailableSourceReason(onSubmit));
      }

      const forwarding = onSubmit.stateData;
      if (forwarding.kind === 'complete') return pass(STRINGS.STATE_DATA_PASS_TITLE);
      if (forwarding.kind === 'unknown') return info(STRINGS.STATE_DATA_INFO_TITLE);

      const fields = forwarding.fields.map((field) => `state.data.${field}`).join(', ');
      const detail = `onSubmit reads ${fields} without passing state.data as a whole. Adyen Web adds fields such as browserInfo, origin, riskData, and billing or shopper details to state.data depending on the payment method; dropping them can break native 3DS2 and weaken risk checks.`;
      return onSubmit.truncated
        ? notice(
            STRINGS.STATE_DATA_NOTICE_TITLE,
            `${detail} The captured callback source may be truncated, so later code could still forward the complete object.`,
            STRINGS.STATE_DATA_REMEDIATION,
            getMakePaymentDocumentationUrl(attributes)
          )
        : warn(
            STRINGS.STATE_DATA_WARN_TITLE,
            detail,
            STRINGS.STATE_DATA_REMEDIATION,
            getMakePaymentDocumentationUrl(attributes)
          );
    }
  )
  .add('callback-on-additional-details', (payload, context) =>
    runAdvancedRequiredCallbackCheck(
      payload,
      {
        key: 'onAdditionalDetails',
        presentTitle: STRINGS.ON_ADD_DETAILS_PASS_TITLE,
        missingTitle: STRINGS.ON_ADD_DETAILS_FAIL_TITLE,
        missingDetail: STRINGS.ON_ADD_DETAILS_FAIL_DETAIL,
        remediation: STRINGS.ON_ADD_DETAILS_FAIL_REMEDIATION,
      },
      context
    )
  )
  .add('callback-on-payment-completed', (payload, context) =>
    runFlowSensitiveOutcomeCallbackCheck(
      payload,
      {
        key: 'onPaymentCompleted',
        presentTitle: STRINGS.ON_PAYMENT_COMPLETED_PASS_TITLE,
        missingTitle: STRINGS.ON_PAYMENT_COMPLETED_MISSING_TITLE,
        missingSessionsDetail: STRINGS.ON_PAYMENT_COMPLETED_SESSIONS_DETAIL,
        missingAdvancedDetail: STRINGS.ON_PAYMENT_COMPLETED_ADVANCED_DETAIL,
        missingSessionsRemediation: STRINGS.ON_PAYMENT_COMPLETED_SESSIONS_REMEDIATION,
        missingAdvancedRemediation: STRINGS.ON_PAYMENT_COMPLETED_ADVANCED_REMEDIATION,
      },
      context
    )
  )
  .add('callback-on-payment-failed', (payload, context) =>
    runFlowSensitiveOutcomeCallbackCheck(
      payload,
      {
        key: 'onPaymentFailed',
        presentTitle: STRINGS.ON_PAYMENT_FAILED_PASS_TITLE,
        missingTitle: STRINGS.ON_PAYMENT_FAILED_MISSING_TITLE,
        missingSessionsDetail: STRINGS.ON_PAYMENT_FAILED_SESSIONS_DETAIL,
        missingAdvancedDetail: STRINGS.ON_PAYMENT_FAILED_ADVANCED_DETAIL,
        missingSessionsRemediation: STRINGS.ON_PAYMENT_FAILED_SESSIONS_REMEDIATION,
        missingAdvancedRemediation: STRINGS.ON_PAYMENT_FAILED_ADVANCED_REMEDIATION,
      },
      context
    )
  )
  .add('callback-on-error', (payload, context) => {
    const { attributes, pass, fail, skip } = context;
    const evidence = readCallback(payload, 'onError');
    if (isConfigMissing(evidence)) {
      return skip(STRINGS.ON_ERROR_SKIP_TITLE, SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
    }
    const documentationUrl = getFlowSensitiveCallbackDocumentationUrl(attributes, 'advanced');
    if (evidence.state === 'present') {
      return evidence.value === 'component'
        ? componentLevelWarning('onError', documentationUrl, context)
        : pass(STRINGS.ON_ERROR_PASS_TITLE);
    }
    return evidence.state === 'unobserved'
      ? skip(STRINGS.ON_ERROR_SKIP_TITLE, STRINGS.CALLBACK_ABSENCE_UNVERIFIED_REASON)
      : fail(
          STRINGS.ON_ERROR_FAIL_TITLE,
          STRINGS.ON_ERROR_FAIL_DETAIL,
          STRINGS.ON_ERROR_FAIL_REMEDIATION,
          documentationUrl
        );
  })
  .add('callback-before-submit', (payload, context) => {
    const { attributes, pass, info, skip } = context;
    const evidence = readCallback(payload, 'beforeSubmit');

    if (isConfigMissing(evidence)) {
      return skip(STRINGS.BEFORE_SUBMIT_SKIP_TITLE, SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
    }
    if (evidence.state === 'present') {
      return evidence.value === 'component'
        ? componentLevelWarning(
            'beforeSubmit',
            getFlowSensitiveCallbackDocumentationUrl(attributes, 'advanced'),
            context
          )
        : pass(STRINGS.BEFORE_SUBMIT_PASS_TITLE);
    }
    return evidence.state === 'unobserved'
      ? skip(STRINGS.BEFORE_SUBMIT_SKIP_TITLE, STRINGS.CALLBACK_ABSENCE_UNVERIFIED_REASON)
      : info(STRINGS.BEFORE_SUBMIT_INFO_TITLE);
  })
  .add('callback-actions-pattern', (payload, { attributes, skip, pass, warn, info }) => {
    const onSubmit = readOnSubmitSource(payload, attributes.flow.value);
    if (onSubmit.status === 'unavailable') {
      return skip(STRINGS.ACTIONS_PATTERN_SKIP_TITLE, unavailableSourceReason(onSubmit));
    }

    if (onSubmit.resolvesActions) {
      return pass(STRINGS.ACTIONS_PATTERN_PASS_TITLE);
    }

    return onSubmit.usesComponentCallbacks
      ? warn(
          STRINGS.ACTIONS_PATTERN_WARN_TITLE,
          STRINGS.ACTIONS_PATTERN_WARN_DETAIL,
          STRINGS.ACTIONS_PATTERN_WARN_REMEDIATION,
          getFlowSensitiveCallbackDocumentationUrl(attributes, 'advanced')
        )
      : info(STRINGS.ACTIONS_PATTERN_INFO_TITLE);
  })
  .add('callback-multiple-submissions', (payload, { skip, info, notice }) => {
    const guard = readSubmissionGuard(payload);
    if (guard.status === 'unavailable') {
      return skip(
        STRINGS.MULTIPLE_SUBMISSIONS_SKIP_TITLE,
        guard.reason === 'no-config'
          ? SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED
          : STRINGS.MULTIPLE_SUBMISSIONS_NO_SOURCE_SKIP_REASON
      );
    }

    return guard.guarded
      ? info(STRINGS.MULTIPLE_SUBMISSIONS_INFO_TITLE, STRINGS.MULTIPLE_SUBMISSIONS_INFO_DETAIL)
      : notice(
          STRINGS.MULTIPLE_SUBMISSIONS_NOTICE_TITLE,
          STRINGS.MULTIPLE_SUBMISSIONS_DETAIL,
          STRINGS.MULTIPLE_SUBMISSIONS_REMEDIATION,
          STRINGS.MULTIPLE_SUBMISSIONS_URL
        );
  })
  .add('callback-custom-pay-button-compatibility', (payload, { skip, pass, warn, fail }) => {
    const { hidden, reported } = readPayButtonVisibility(payload);
    if (hidden.length > 0) {
      const labels = hidden.map(({ method }) => BUTTON_REQUIRED_METHOD_LABELS[method]);
      const causes = hidden.map(
        ({ method, hiddenBy }) =>
          `${BUTTON_REQUIRED_METHOD_LABELS[method]} ${HIDDEN_BY_PHRASES[hiddenBy]}`
      );
      const report = hidden.some(({ method }) => method === 'paypal') ? fail : warn;
      return report(
        `Custom pay button used with unsupported payment methods: ${SIGNAL_LIST.format(labels)}.`,
        `${STRINGS.CUSTOM_PAY_BUTTON_COMPAT_ISSUE_DETAIL} Detected: ${causes.join('; ')}.`,
        STRINGS.CUSTOM_PAY_BUTTON_COMPAT_REMEDIATION,
        STRINGS.CUSTOM_PAY_BUTTON_COMPAT_URL
      );
    }
    if (reported) return pass(STRINGS.CUSTOM_PAY_BUTTON_COMPAT_PASS_TITLE);

    const isObserved =
      hasCapturedCheckoutConfig(payload.page) || payload.page.analyticsEvents !== undefined;
    return skip(
      STRINGS.CUSTOM_PAY_BUTTON_COMPAT_SKIP_TITLE,
      isObserved
        ? STRINGS.CUSTOM_PAY_BUTTON_COMPAT_NOT_REPORTED_SKIP_REASON
        : SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED
    );
  })
  .getChecks();
