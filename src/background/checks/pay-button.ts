/**
Pay button visibility — the Scan's reading of which payment methods that
need their own button (PayPal, Klarna, Click to Pay) would render without
it, for the custom pay button check. Evidence, strongest first: the
showPayButton a component reported in its analytics `rendered` event, a
`paymentMethodsConfiguration` entry, then AdyenCheckout's showPayButton for
offered methods. Drop-in renders a method only once the shopper selects it,
so configuration stands in for methods that did not render. Click to Pay
without its own rendered component runs inside Card and follows Card's pay
button, unless Card disabled it.
*/

import { EMPTY_CHECKOUT_ANALYTICS } from '../../shared/checkout-analytics.js';
import { readCheckoutField } from '../../shared/scan-evidence.js';
import type { ScanPayload } from '../../shared/types.js';

/**
Payment methods that need the pay button their component renders.
*/
type ButtonRequiredMethod = 'paypal' | 'klarna' | 'clicktopay';

/**
What hides a method's pay button.
*/
export type HiddenBy = 'rendered' | 'method-config' | 'checkout-config';

interface HiddenPayButton {
  readonly method: ButtonRequiredMethod;
  readonly hiddenBy: HiddenBy;
}

interface PayButtonVisibility {
  /**
  Methods that would render without their own pay button, one entry per method.
  */
  readonly hidden: readonly HiddenPayButton[];
  /**
  True when components reported the showPayButton they rendered with.
  */
  readonly reported: boolean;
}

const CAPTURED_ONLY = { includeInferred: false } as const;

function buttonRequiredMethod(type: string): ButtonRequiredMethod | null {
  if (type === 'paypal' || type === 'clicktopay') return type;
  return type.startsWith('klarna') ? 'klarna' : null;
}

/**
Drop-in configures the Card component under `card`; it renders as `scheme`.
*/
function configKeys(type: string): readonly string[] {
  return type === 'scheme' ? ['scheme', 'card'] : [type];
}

/**
Reads which button-required payment methods would render without their own pay button.
*/
export function readPayButtonVisibility(payload: ScanPayload): PayButtonVisibility {
  const events = payload.analytics ?? EMPTY_CHECKOUT_ANALYTICS;
  const rendered = new Map(events.rendered.map((component) => [component.type, component]));
  const methodConfig = readCheckoutField(payload, 'hiddenPayButtonMethods', CAPTURED_ONLY);
  const configuredHidden = methodConfig.state === 'present' ? methodConfig.value : [];
  const checkoutConfig = readCheckoutField(payload, 'showPayButton', CAPTURED_ONLY);
  const isHiddenEverywhere = checkoutConfig.state === 'present' && !checkoutConfig.value;

  function hiddenBy(type: string): HiddenBy | null {
    const component = rendered.get(type);
    if (component !== undefined) return component.showPayButton ? null : 'rendered';
    if (configKeys(type).some((key) => configuredHidden.includes(key))) return 'method-config';
    if (type === 'clicktopay') {
      return rendered.get('scheme')?.clickToPayDisabled === true ? null : hiddenBy('scheme');
    }
    return isHiddenEverywhere && events.paymentMethods.includes(type) ? 'checkout-config' : null;
  }

  const hidden = new Map<ButtonRequiredMethod, HiddenBy>();
  const candidates = new Set([...rendered.keys(), ...events.paymentMethods, ...configuredHidden]);
  for (const type of candidates) {
    const method = buttonRequiredMethod(type);
    if (method === null || hidden.has(method)) continue;
    const reason = hiddenBy(type);
    if (reason !== null) hidden.set(method, reason);
  }

  return {
    hidden: [...hidden].map(([method, reason]) => ({ method, hiddenBy: reason })),
    reported: events.rendered.length > 0,
  };
}
