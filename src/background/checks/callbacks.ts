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
import { SKIP_REASONS } from './constants.js';
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

interface UnhandledOnSubmitFilters {
  readonly paymentMethod: boolean;
  readonly actionCode: boolean;
}

const STRING_LITERAL_PATTERN = /['"`][^'"`\n]+['"`]/;
const PAYMENT_METHOD_SELECTOR_PATTERN =
  /\bpaymentMethod(?:\?\.)?\.type\b|\bpaymentMethod\s*\[\s*['"]type['"]\s*\]/;
const ACTION_CODE_SELECTOR_PATTERN =
  /\bresultCode\b|\baction(?:\?\.)?\.type\b|\baction\s*\[\s*['"]type['"]\s*\]/;

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

const STRINGS = {
  SESSIONS_FLOW_SKIP_REASON: 'Sessions flow detected.',
  NO_SOURCE_SKIP_REASON: 'onSubmit source not available.',

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
  SUBMIT_FILTER_PASS_TITLE:
    'onSubmit appears to handle payment methods and action codes through a generic fallback path.',

  ON_ADD_DETAILS_PASS_TITLE: 'onAdditionalDetails callback is present.',
  ON_ADD_DETAILS_FAIL_TITLE: 'onAdditionalDetails callback is missing.',
  ON_ADD_DETAILS_FAIL_DETAIL:
    'Without onAdditionalDetails, 3DS and other follow-up actions cannot complete correctly.',
  ON_ADD_DETAILS_FAIL_REMEDIATION:
    'Add an onAdditionalDetails handler to your AdyenCheckout configuration. This callback fires when follow-up data is needed (such as after 3DS authentication).',

  ON_PAYMENT_COMPLETED_PASS_TITLE: 'onPaymentCompleted callback is present.',
  ON_PAYMENT_COMPLETED_MISSING_TITLE: 'onPaymentCompleted callback is not set.',
  ON_PAYMENT_COMPLETED_SESSIONS_DETAIL:
    'For Sessions flow, onPaymentCompleted is the primary handler for authorised and refused outcomes.',
  ON_PAYMENT_COMPLETED_ADVANCED_DETAIL:
    'Without onPaymentCompleted, successful outcomes may not trigger your confirmation and fulfillment logic.',
  ON_PAYMENT_COMPLETED_SESSIONS_REMEDIATION:
    'Add an onPaymentCompleted handler to your AdyenCheckout configuration. For Sessions flow, this is the primary callback for payment outcomes.',
  ON_PAYMENT_COMPLETED_ADVANCED_REMEDIATION:
    'Add an onPaymentCompleted handler to receive notification when a payment is authorised.',

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
  BEFORE_SUBMIT_PASS_TITLE: 'beforeSubmit callback is present (custom pay button flow).',
  BEFORE_SUBMIT_INFO_TITLE: 'beforeSubmit is not configured.',

  ACTIONS_PATTERN_SKIP_TITLE: 'Actions pattern check skipped.',
  ACTIONS_PATTERN_PASS_TITLE: 'onSubmit uses the v6 actions.resolve() / actions.reject() pattern.',
  ACTIONS_PATTERN_WARN_TITLE:
    'onSubmit appears to use v5-style component callbacks — update to v6 actions pattern.',
  ACTIONS_PATTERN_WARN_DETAIL: 'v6 adopts actions.resolve() / actions.reject() inside onSubmit.',
  ACTIONS_PATTERN_WARN_REMEDIATION:
    'Migrate your onSubmit handler from the v5-style component callbacks to the v6 actions pattern.',
  ACTIONS_PATTERN_INFO_TITLE: 'Could not determine onSubmit callback pattern from static analysis.',
} as const;

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
    return skip(`${options.label} check skipped.`, SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
  }

  const flow = detectIntegrationFlow(payload);
  if (flow === 'sessions') {
    return skip(`${options.label} check skipped.`, STRINGS.SESSIONS_FLOW_SKIP_REASON);
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
    return skip(`${options.label} check skipped.`, SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
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

function isWhitespaceChar(char: string | undefined): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f';
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (isWhitespaceChar(source[index])) {
    index += 1;
  }
  return index;
}

function findMatchingDelimiter(
  source: string,
  start: number,
  openDelimiter: string,
  closeDelimiter: string
): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === openDelimiter) {
      depth += 1;
      continue;
    }
    if (char === closeDelimiter) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function findStatementEnd(source: string, start: number): number {
  const firstToken = source[start];
  if (firstToken === '{') {
    return findMatchingDelimiter(source, start, '{', '}');
  }

  const semicolonIndex = source.indexOf(';', start);
  if (semicolonIndex !== -1) {
    return semicolonIndex;
  }

  const newlineIndex = source.indexOf('\n', start);
  if (newlineIndex !== -1) {
    return newlineIndex;
  }

  return source.length - 1;
}

function hasUnhandledSelectorIfStatement(source: string, selectorPattern: RegExp): boolean {
  const ifPattern = /\bif\s*\(/g;
  let match = ifPattern.exec(source);

  while (match !== null) {
    const conditionStart = source.indexOf('(', match.index);
    if (conditionStart === -1) {
      match = ifPattern.exec(source);
      continue;
    }

    const conditionEnd = findMatchingDelimiter(source, conditionStart, '(', ')');
    if (conditionEnd === -1) {
      return false;
    }

    const condition = source.slice(conditionStart + 1, conditionEnd);
    const hasSelector = selectorPattern.test(condition);
    const hasSpecificLiteral = STRING_LITERAL_PATTERN.test(condition);
    if (hasSelector && hasSpecificLiteral) {
      const statementStart = skipWhitespace(source, conditionEnd + 1);
      const statementEnd = findStatementEnd(source, statementStart);
      if (statementEnd === -1) {
        return false;
      }

      const trailingTokenStart = skipWhitespace(source, statementEnd + 1);
      if (!source.startsWith('else', trailingTokenStart)) {
        return true;
      }
    }

    ifPattern.lastIndex = conditionEnd + 1;
    match = ifPattern.exec(source);
  }

  return false;
}

function hasUnhandledSelectorSwitchStatement(source: string, selectorPattern: RegExp): boolean {
  const switchPattern = /\bswitch\s*\(/g;
  let match = switchPattern.exec(source);

  while (match !== null) {
    const conditionStart = source.indexOf('(', match.index);
    if (conditionStart === -1) {
      match = switchPattern.exec(source);
      continue;
    }

    const conditionEnd = findMatchingDelimiter(source, conditionStart, '(', ')');
    if (conditionEnd === -1) {
      return false;
    }

    const condition = source.slice(conditionStart + 1, conditionEnd);
    if (selectorPattern.test(condition)) {
      const blockStart = skipWhitespace(source, conditionEnd + 1);
      if (source[blockStart] !== '{') {
        match = switchPattern.exec(source);
        continue;
      }

      const blockEnd = findMatchingDelimiter(source, blockStart, '{', '}');
      if (blockEnd === -1) {
        return false;
      }

      const switchBlock = source.slice(blockStart + 1, blockEnd);
      const hasStringCases = /\bcase\s*['"`][^'"`\n]+['"`]\s*:/.test(switchBlock);
      const hasDefaultCase = /\bdefault\s*:/.test(switchBlock);

      if (hasStringCases && !hasDefaultCase) {
        return true;
      }
    }

    switchPattern.lastIndex = conditionEnd + 1;
    match = switchPattern.exec(source);
  }

  return false;
}

function detectUnhandledOnSubmitFilters(source: string): UnhandledOnSubmitFilters {
  const paymentMethodFiltered =
    hasUnhandledSelectorIfStatement(source, PAYMENT_METHOD_SELECTOR_PATTERN) ||
    hasUnhandledSelectorSwitchStatement(source, PAYMENT_METHOD_SELECTOR_PATTERN);
  const actionCodeFiltered =
    hasUnhandledSelectorIfStatement(source, ACTION_CODE_SELECTOR_PATTERN) ||
    hasUnhandledSelectorSwitchStatement(source, ACTION_CODE_SELECTOR_PATTERN);

  return {
    paymentMethod: paymentMethodFiltered,
    actionCode: actionCodeFiltered,
  };
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
        presentTitle: STRINGS.ON_SUBMIT_PASS_TITLE,
        missingTitle: STRINGS.ON_SUBMIT_FAIL_TITLE,
        missingDetail: STRINGS.ON_SUBMIT_FAIL_DETAIL,
        remediation: STRINGS.ON_SUBMIT_FAIL_REMEDIATION,
      },
      context
    );
  })
  .add('callback-on-submit-filtering', (payload, { skip, warn, pass }) => {
    const config = payload.page.checkoutConfig;
    if (!config) {
      return skip('onSubmit filtering check skipped.', SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
    }

    const flow = detectIntegrationFlow(payload);
    if (flow === 'sessions') {
      return skip('onSubmit filtering check skipped.', STRINGS.SESSIONS_FLOW_SKIP_REASON);
    }

    const onSubmitSource = config.onSubmitSource ?? '';
    if (onSubmitSource === '') {
      return skip('onSubmit filtering check skipped.', STRINGS.NO_SOURCE_SKIP_REASON);
    }

    const filters = detectUnhandledOnSubmitFilters(onSubmitSource);
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
        `Static analysis detected selective filtering on ${joinSignals(filteredTargets)} without a clear catch-all branch (else/default).`,
        STRINGS.SUBMIT_FILTER_WARN_REMEDIATION,
        FLOW_DOCS.advanced.overview
      );
    }

    return pass(STRINGS.SUBMIT_FILTER_PASS_TITLE);
  })
  .add('callback-on-additional-details', (payload, context) => {
    return runAdvancedRequiredCallbackCheck(
      payload,
      {
        label: 'onAdditionalDetails',
        readCallback: (config) => config.onAdditionalDetails,
        presentTitle: STRINGS.ON_ADD_DETAILS_PASS_TITLE,
        missingTitle: STRINGS.ON_ADD_DETAILS_FAIL_TITLE,
        missingDetail: STRINGS.ON_ADD_DETAILS_FAIL_DETAIL,
        remediation: STRINGS.ON_ADD_DETAILS_FAIL_REMEDIATION,
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
        presentTitle: STRINGS.ON_PAYMENT_COMPLETED_PASS_TITLE,
        missingTitle: STRINGS.ON_PAYMENT_COMPLETED_MISSING_TITLE,
        missingSessionsDetail: STRINGS.ON_PAYMENT_COMPLETED_SESSIONS_DETAIL,
        missingAdvancedDetail: STRINGS.ON_PAYMENT_COMPLETED_ADVANCED_DETAIL,
        missingSessionsRemediation: STRINGS.ON_PAYMENT_COMPLETED_SESSIONS_REMEDIATION,
        missingAdvancedRemediation: STRINGS.ON_PAYMENT_COMPLETED_ADVANCED_REMEDIATION,
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
        presentTitle: STRINGS.ON_PAYMENT_FAILED_PASS_TITLE,
        missingTitle: STRINGS.ON_PAYMENT_FAILED_MISSING_TITLE,
        missingSessionsDetail: STRINGS.ON_PAYMENT_FAILED_SESSIONS_DETAIL,
        missingAdvancedDetail: STRINGS.ON_PAYMENT_FAILED_ADVANCED_DETAIL,
        missingSessionsRemediation: STRINGS.ON_PAYMENT_FAILED_SESSIONS_REMEDIATION,
        missingAdvancedRemediation: STRINGS.ON_PAYMENT_FAILED_ADVANCED_REMEDIATION,
      },
      context
    );
  })
  .add('callback-on-error', (payload, { pass, fail, skip }) => {
    const config = payload.page.checkoutConfig;
    if (!config) {
      return skip(STRINGS.ON_ERROR_SKIP_TITLE, SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
    }

    if (hasCallbackSignal(config.onError)) {
      return pass(STRINGS.ON_ERROR_PASS_TITLE);
    }

    return fail(
      STRINGS.ON_ERROR_FAIL_TITLE,
      STRINGS.ON_ERROR_FAIL_DETAIL,
      STRINGS.ON_ERROR_FAIL_REMEDIATION,
      FLOW_DOCS.advanced.overview
    );
  })
  .add('callback-before-submit', (payload, { pass, info, skip }) => {
    const config = payload.page.checkoutConfig;
    if (!config) {
      return skip(STRINGS.BEFORE_SUBMIT_SKIP_TITLE, SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
    }

    if (hasCallbackSignal(config.beforeSubmit)) {
      return pass(STRINGS.BEFORE_SUBMIT_PASS_TITLE);
    }
    return info(STRINGS.BEFORE_SUBMIT_INFO_TITLE);
  })
  .add('callback-actions-pattern', (payload, { skip, pass, warn, info }) => {
    const config = payload.page.checkoutConfig;
    if (!config) {
      return skip(STRINGS.ACTIONS_PATTERN_SKIP_TITLE, SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
    }

    const flow = detectIntegrationFlow(payload);
    if (flow === 'sessions') {
      return skip(STRINGS.ACTIONS_PATTERN_SKIP_TITLE, STRINGS.SESSIONS_FLOW_SKIP_REASON);
    }

    const onSubmitSource = config.onSubmitSource ?? '';
    if (onSubmitSource === '') {
      return skip(STRINGS.ACTIONS_PATTERN_SKIP_TITLE, STRINGS.NO_SOURCE_SKIP_REASON);
    }

    if (/actions\.(resolve|reject)\(/.test(onSubmitSource)) {
      return pass(STRINGS.ACTIONS_PATTERN_PASS_TITLE);
    }

    if (/component\.(setStatus|handleAction)\(/.test(onSubmitSource)) {
      return warn(
        STRINGS.ACTIONS_PATTERN_WARN_TITLE,
        STRINGS.ACTIONS_PATTERN_WARN_DETAIL,
        STRINGS.ACTIONS_PATTERN_WARN_REMEDIATION,
        FLOW_DOCS.advanced.overview
      );
    }

    return info(STRINGS.ACTIONS_PATTERN_INFO_TITLE);
  })
  .getChecks();
