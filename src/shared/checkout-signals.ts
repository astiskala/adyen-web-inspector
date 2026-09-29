/**
 * Checkout signals — the one definition of checkout activity. It owns the DOM
 * selectors of mounted checkout, which iframes and documents are Adyen's, how
 * strongly a frame's extraction shows checkout, and whether the Checkout page
 * shows checkout activity. The passive detector and the page extractor read
 * the DOM through it, the frame merge ranks and classifies frames with it, and
 * implementation attributes decide checkout activity with it.
 *
 * Content scripts bundle this module inline, so it may depend only on types,
 * the Adyen endpoint reading, configuration evidence, and SDK presence.
 */

import { isCheckoutApiRequest, readAdyenEndpoint } from './adyen-endpoint.js';
import { checkoutConfigSources, hasCompleteCheckoutConfig } from './scan-evidence.js';
import { hasAdyenScriptHint } from './sdk-presence.js';
import type { PageExtractResult, ScanPayload } from './types.js';

const SELECTORS = {
  dropin: '.adyen-checkout__dropin',
  card: '.adyen-checkout__card-input',
  // Stored-card forms use the same wrapper, so only new-card forms count.
  newCardForm: '.adyen-checkout__card__form:not(.adyen-checkout__card__form--oneClick)',
  cardHolderName: '.adyen-checkout__card__holderName',
  anyElement: '[class*="adyen-checkout"]',
} as const;

/** What a document's DOM shows of mounted checkout. */
export interface CheckoutDom {
  readonly dropin: boolean;
  readonly card: boolean;
  readonly newCardForm: boolean;
  readonly cardHolderName: boolean;
  /** Any element with an adyen-checkout class, such as a mounted Component. */
  readonly anyElement: boolean;
  readonly adyenIframe: boolean;
}

/** The parts of an iframe that identify it. */
interface IframeIdentity {
  readonly name?: string | undefined;
  readonly src?: string | undefined;
}

/** The parts of a frame's extraction that show checkout. */
type FrameSignals = Pick<
  PageExtractResult,
  | 'capturedConfig'
  | 'componentConfig'
  | 'inferredConfig'
  | 'pageJsonConfig'
  | 'componentMountCount'
  | 'hasDropinDOM'
  | 'hasCardDOM'
  | 'adyenMetadata'
  | 'scripts'
  | 'iframes'
>;

/** Returns true for an iframe Adyen Web renders: named adyen-*, or served from an Adyen host. */
function isAdyenIframe({ name, src }: IframeIdentity): boolean {
  return (
    name?.startsWith('adyen-') === true || (src !== undefined && readAdyenEndpoint(src) !== null)
  );
}

/** Reads what a document's DOM shows of mounted checkout. */
export function readCheckoutDom(root: ParentNode): CheckoutDom {
  const has = (selector: string): boolean => root.querySelector(selector) !== null;
  return {
    dropin: has(SELECTORS.dropin),
    card: has(SELECTORS.card),
    newCardForm: has(SELECTORS.newCardForm),
    cardHolderName: has(SELECTORS.cardHolderName),
    anyElement: has(SELECTORS.anyElement),
    adyenIframe: [...root.querySelectorAll('iframe')].some((frame) =>
      isAdyenIframe({ name: frame.name, src: frame.src })
    ),
  };
}

/**
 * Returns true when a document shows mounted checkout: an adyen-checkout
 * element or an Adyen iframe. SDK script tags alone do not count.
 */
export function showsMountedCheckout(dom: CheckoutDom): boolean {
  return dom.anyElement || dom.adyenIframe;
}

/** Returns true for a document not served from an Adyen host, so hosted card fields do not count as merchant checkout. */
export function isMerchantDocument(url: string): boolean {
  return readAdyenEndpoint(url) === null;
}

function hasMountedTree(
  frame: Pick<FrameSignals, 'hasDropinDOM' | 'hasCardDOM' | 'componentMountCount'>
): boolean {
  return (
    frame.hasDropinDOM === true || frame.hasCardDOM === true || (frame.componentMountCount ?? 0) > 0
  );
}

/**
 * How strongly a frame's extraction shows checkout: captured options, then a
 * mounted tree's options, a Drop-in, SDK metadata, an Adyen script, and an
 * Adyen iframe, in falling weight.
 */
export function checkoutStrength(frame: FrameSignals): number {
  let strength = 0;
  if (frame.capturedConfig !== null) strength += 100;
  if (frame.componentConfig !== null) strength += 90;
  if (frame.hasDropinDOM === true) strength += 60;
  if (frame.adyenMetadata !== null) strength += 40;
  if (hasAdyenScriptHint(frame)) strength += 20;
  if (frame.iframes.some(isAdyenIframe)) strength += 10;
  return strength;
}

/** Returns true when a frame renders checkout itself: complete AdyenCheckout options, or a mounted Drop-in, Card, or Adyen tree. */
export function rendersCheckout(frame: FrameSignals): boolean {
  return hasCompleteCheckoutConfig(frame) || hasMountedTree(frame);
}

/**
 * Returns true when the Checkout page shows checkout activity: configuration,
 * a mounted Drop-in, Card, or Adyen tree, an Adyen iframe, checkout analytics,
 * or Checkout API traffic. SDK presence alone is not activity.
 */
export function hasCheckoutActivity(payload: ScanPayload): boolean {
  const { page } = payload;
  return (
    checkoutConfigSources(page).size > 0 ||
    hasMountedTree(page) ||
    page.iframes.some(isAdyenIframe) ||
    payload.analyticsData !== null ||
    payload.capturedRequests.some((request) => isCheckoutApiRequest(request.url))
  );
}
