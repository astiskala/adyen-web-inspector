/**
Frame merge — turns every accessible frame's page extraction into the
Checkout page. It owns frame selection and the scope each Checkout page
field is read from: the selected frame, merchant frames, or all frames.
*/

import {
  checkoutStrength,
  isMerchantDocument,
  isRenderingCheckout,
} from '../shared/checkout-signals.js';
import { mergeCheckoutAnalytics } from '../shared/checkout-analytics.js';
import { mergeObservedConfigs } from '../shared/scan-evidence.js';
import type { CheckoutPage, PageExtractResult } from '../shared/types.js';
import type { FrameExtraction } from './scan-browser.js';

const TOP_FRAME_ID = 0;

type FieldScope =
  'selected' | 'selected-or-first' | 'selected-or-merchant' | 'merchant-frames' | 'all-frames';

/**
Where each Checkout page field is read from. Merchant frames are frames not
served from an Adyen host, so hosted card fields do not count as checkout.
*/
const FIELD_SCOPE = {
  adyenMetadata: 'selected-or-first',
  observedConfig: 'all-frames',
  analytics: 'all-frames',
  componentMountCount: 'selected',
  hasDropinDOM: 'selected-or-merchant',
  hasCardDOM: 'selected-or-merchant',
  hasNewCardFormDOM: 'selected-or-merchant',
  hasCardHolderNameDOM: 'selected-or-merchant',
  scripts: 'selected',
  links: 'selected',
  iframes: 'selected',
  observedRequests: 'selected',
  checkoutInitCount: 'selected',
  apiKeyDetected: 'all-frames',
  adyenStyles: 'selected',
  isInsideIframe: 'merchant-frames',
  pageUrl: 'selected',
  pageProtocol: 'selected',
} as const satisfies Record<keyof PageExtractResult, FieldScope>;

type ScopedField<S extends FieldScope> = {
  [K in keyof typeof FIELD_SCOPE]: (typeof FIELD_SCOPE)[K] extends S ? K : never;
}[keyof typeof FIELD_SCOPE];

interface ExtractedFrame {
  readonly frameId: number;
  readonly result: PageExtractResult;
}

function fieldsWithScope<S extends FieldScope>(scope: S): ScopedField<S>[] {
  return (Object.keys(FIELD_SCOPE) as (keyof typeof FIELD_SCOPE)[]).filter(
    (field): field is ScopedField<S> => FIELD_SCOPE[field] === scope
  );
}

const SELECTED_FIELDS = fieldsWithScope('selected');
const MERCHANT_FLAGS = fieldsWithScope('selected-or-merchant');

/**
Picks the frame with the strongest checkout signals; the top frame wins ties.
*/
function selectFrame(first: ExtractedFrame, rest: readonly ExtractedFrame[]): ExtractedFrame {
  let selected = first;
  for (const frame of rest) {
    const selectedStrength = checkoutStrength(selected.result);
    const strength = checkoutStrength(frame.result);
    if (
      strength > selectedStrength ||
      (strength === selectedStrength && frame.frameId === TOP_FRAME_ID)
    ) {
      selected = frame;
    }
  }
  return selected;
}

function isMerchantFrame(frame: ExtractedFrame): boolean {
  return isMerchantDocument(frame.result.pageUrl);
}

function readSelectedFields(
  result: PageExtractResult
): Pick<CheckoutPage, ScopedField<'selected'>> {
  const entries = SELECTED_FIELDS.filter((field) => result[field] !== undefined).map(
    (field) => [field, result[field]] as const
  );
  return Object.fromEntries(entries) as Pick<CheckoutPage, ScopedField<'selected'>>;
}

function mergeMerchantFlags(
  selected: PageExtractResult,
  merchantFrames: readonly PageExtractResult[]
): Pick<CheckoutPage, ScopedField<'selected-or-merchant'>> {
  const flags: Partial<Record<ScopedField<'selected-or-merchant'>, true>> = {};
  for (const flag of MERCHANT_FLAGS) {
    if (selected[flag] === true || merchantFrames.some((frame) => frame[flag] === true)) {
      flags[flag] = true;
    }
  }
  return flags;
}

/**
Merges frame extractions into the Checkout page, or returns null when no
frame produced a result. Configuration merges across all frames with earlier
frames winning per field; absence is provable when any frame captured
AdyenCheckout options whole.
*/
export function mergeFrames(frames: readonly FrameExtraction[]): CheckoutPage | null {
  const extracted = frames.filter((frame): frame is ExtractedFrame => frame.result !== null);
  const [first, ...rest] = extracted;
  if (first === undefined) return null;

  const selected = selectFrame(first, rest);
  const results = extracted.map((frame) => frame.result);
  const merchantFrames = extracted.filter(isMerchantFrame);
  const analytics = mergeCheckoutAnalytics(results.map((result) => result.analytics));
  const isCheckoutInChildFrame = merchantFrames.some(
    (frame) => frame.frameId !== TOP_FRAME_ID && isRenderingCheckout(frame.result)
  );

  return {
    ...readSelectedFields(selected.result),
    adyenMetadata:
      selected.result.adyenMetadata ??
      results.find((result) => result.adyenMetadata !== null)?.adyenMetadata ??
      null,
    observedConfig: mergeObservedConfigs(results),
    ...(analytics !== undefined && { analytics }),
    ...mergeMerchantFlags(
      selected.result,
      merchantFrames.map((frame) => frame.result)
    ),
    ...(results.some((result) => result.apiKeyDetected === true) && { apiKeyDetected: true }),
    checkoutInIframe:
      (selected.frameId !== TOP_FRAME_ID && merchantFrames.includes(selected)) ||
      isCheckoutInChildFrame,
  };
}
