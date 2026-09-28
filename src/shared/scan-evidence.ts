import type { CheckoutConfig, ScanPayload } from './types.js';

type ConfigSource = 'captured' | 'component' | 'inferred' | 'unknown';

interface ConfigObservation<K extends keyof CheckoutConfig> {
  readonly value: CheckoutConfig[K] | undefined;
  readonly source: ConfigSource;
}

export const observeCheckoutField = <K extends keyof CheckoutConfig>(
  payload: ScanPayload,
  key: K
): ConfigObservation<K> => {
  const configs = [
    { source: 'captured', config: payload.page.checkoutConfig },
    { source: 'component', config: payload.page.componentConfig },
    { source: 'inferred', config: payload.page.inferredConfig },
  ] as const;

  for (const { source, config } of configs) {
    const value = config?.[key];
    if (value !== undefined && value !== '') return { value, source };
  }

  return { value: undefined, source: 'unknown' };
};

export const hasCapturedCheckoutConfig = (payload: ScanPayload): boolean =>
  payload.page.checkoutConfig !== null || payload.page.componentConfig !== null;

export const hasVerifiedCheckoutConfig = (payload: ScanPayload): boolean =>
  payload.page.checkoutConfigComplete === true && payload.page.checkoutConfig !== null;

export const resolveCapturedCheckoutConfig = (payload: ScanPayload): CheckoutConfig | null => {
  const { checkoutConfig, componentConfig } = payload.page;
  if (checkoutConfig === null) return componentConfig;
  if (componentConfig === null) return checkoutConfig;

  const capturedFields = Object.fromEntries(
    Object.entries(checkoutConfig).filter(([, value]) => value !== undefined && value !== '')
  ) as CheckoutConfig;
  return { ...componentConfig, ...capturedFields };
};
