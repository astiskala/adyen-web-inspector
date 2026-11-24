/* eslint-disable jsdoc/check-tag-names -- Vitest reads this docblock to set the jsdom URL. */
/**
@vitest-environment-options {"url": "https://checkoutshopper-test.adyen.com/checkoutshopper/securedfields/K/6.31.0/securedFields.html"}
*/
import { expect, it, vi } from 'vitest';

it('stays silent in Adyen-hosted frames, which belong to the merchant frame embedding them', async () => {
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const addListener = vi.fn();
  vi.stubGlobal('chrome', { runtime: { sendMessage, onMessage: { addListener } } });
  document.body.innerHTML = '<div class="adyen-checkout__card-input"></div>';

  await import('../../../src/content/detector');

  expect(sendMessage).not.toHaveBeenCalled();
  expect(addListener).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
