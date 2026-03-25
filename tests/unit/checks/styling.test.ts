import { describe, it, expect } from 'vitest';
import { STYLING_CHECKS } from '../../../src/background/checks/styling';
import {
  makeAdyenPayload,
  makePageExtract,
  makeAdyenMetadata,
  makeCheckoutConfig,
  makeScanPayload,
} from '../../fixtures/makeScanPayload';
import { requireCheck } from './requireCheck';

const cssCustomProps = requireCheck(STYLING_CHECKS, 'styling-css-custom-props');

describe('Styling Checks', () => {
  describe('styling-css-custom-props', () => {
    it('skips when no custom styling is detected', () => {
      const payload = makeAdyenPayload();
      const result = cssCustomProps.run(payload);
      expect(result.severity).toBe('skip');
      expect(result.id).toBe('styling-css-custom-props');
    });

    it('passes when only CSS custom properties are used', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          adyenMetadata: makeAdyenMetadata(),
          checkoutConfig: makeCheckoutConfig(),
          adyenStyles: {
            classOverrideCount: 0,
            classOverrideSelectors: [],
            customPropertyCount: 3,
          },
        }),
      });
      const result = cssCustomProps.run(payload);
      expect(result.severity).toBe('pass');
      expect(result.title).toContain('CSS custom properties');
      expect(result.title).toContain('3 rules');
    });

    it('passes with singular "rule" for 1 custom property', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          adyenStyles: {
            classOverrideCount: 0,
            classOverrideSelectors: [],
            customPropertyCount: 1,
          },
        }),
      });
      const result = cssCustomProps.run(payload);
      expect(result.severity).toBe('pass');
      expect(result.title).toContain('1 rule found');
    });

    it('returns notice when class overrides are detected', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          adyenMetadata: makeAdyenMetadata(),
          checkoutConfig: makeCheckoutConfig(),
          adyenStyles: {
            classOverrideCount: 2,
            classOverrideSelectors: ['.adyen-checkout__button', '.adyen-checkout__input'],
            customPropertyCount: 0,
          },
        }),
      });
      const result = cssCustomProps.run(payload);
      expect(result.severity).toBe('notice');
      expect(result.detail).toContain('Examples:');
      expect(result.detail).toContain('.adyen-checkout__button');
      expect(result.detail).toContain('.adyen-checkout__input');
      expect(result.docsUrl).toContain('upgrade-to-web-v6');
    });

    it('returns notice when both overrides and custom properties are detected', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          adyenStyles: {
            classOverrideCount: 1,
            classOverrideSelectors: ['.adyen-checkout__label'],
            customPropertyCount: 5,
          },
        }),
      });
      const result = cssCustomProps.run(payload);
      expect(result.severity).toBe('notice');
      expect(result.detail).toContain('5 rules');
    });

    it('includes remediation guidance', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          adyenStyles: {
            classOverrideCount: 1,
            classOverrideSelectors: ['.adyen-checkout__button'],
            customPropertyCount: 0,
          },
        }),
      });
      const result = cssCustomProps.run(payload);
      expect(result.remediation).toContain('--adyen-sdk-*');
    });

    it('uses singular "rule" for 1 override', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          adyenStyles: {
            classOverrideCount: 1,
            classOverrideSelectors: ['.adyen-checkout__button'],
            customPropertyCount: 0,
          },
        }),
      });
      const result = cssCustomProps.run(payload);
      expect(result.detail).toContain('1 rule overriding');
    });

    it('reports true count even when selector samples are capped', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          adyenStyles: {
            classOverrideCount: 12,
            classOverrideSelectors: [
              '.adyen-checkout__button',
              '.adyen-checkout__input',
              '.adyen-checkout__label',
              '.adyen-checkout__card',
              '.adyen-checkout__field',
            ],
            customPropertyCount: 0,
          },
        }),
      });
      const result = cssCustomProps.run(payload);
      expect(result.detail).toContain('12 rules overriding');
      expect(result.detail).toContain('.adyen-checkout__button');
      expect(result.detail).toContain('.adyen-checkout__input');
      expect(result.detail).toContain('.adyen-checkout__label');
      expect(result.detail).not.toContain('.adyen-checkout__card');
      expect(result.detail).not.toContain('.adyen-checkout__field');
      expect(result.detail).toContain('9 more selectors omitted.');
    });

    it('caps examples to 3 individual selectors when a rule contains comma-separated selectors', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          adyenStyles: {
            classOverrideCount: 564,
            classOverrideSelectors: [
              '.adyen-checkout__status--success, .adyen-checkout__status__icon',
              '.adyen-checkout__status__text, .adyen-checkout__payment-method',
              '.adyen-checkout__field--cardNumber, .adyen-checkout__label',
            ],
            customPropertyCount: 0,
          },
        }),
      });

      const result = cssCustomProps.run(payload);
      expect(result.detail).toContain('.adyen-checkout__status--success');
      expect(result.detail).toContain('.adyen-checkout__status__icon');
      expect(result.detail).toContain('.adyen-checkout__status__text');
      expect(result.detail).not.toContain('.adyen-checkout__payment-method');
      expect(result.detail).not.toContain('.adyen-checkout__field--cardNumber');
      expect(result.detail).not.toContain('.adyen-checkout__label');
      expect(result.detail).toContain('561 more selectors omitted.');
    });

    it('focuses examples on the Adyen override target instead of the full ancestor chain', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          adyenStyles: {
            classOverrideCount: 564,
            classOverrideSelectors: [
              '.vd-cmp-payment .vd-cmp-payment__modal .adyenComponentLightBox .modal_container .lightBoxPositon .adyenDialog .modal_content .modal_body .adyen-checkout__status--success',
              '.vd-cmp-payment .vd-cmp-payment__modal .adyenComponentLightBox .modal_container .lightBoxPositon .payment-dialog .modal_content .modal_body .adyen-checkout__status--success',
              '.vd-cmp-payment .vd-cmp-payment__modal .adyenComponentLightBox .modal_container .lightBoxPositon .adyenDialog .modal_content .modal_body .adyen-checkout__status--success .adyen-checkout__status__icon',
              '.vd-cmp-payment .vd-cmp-payment__modal .adyenComponentLightBox .modal_container .lightBoxPositon .payment-dialog .modal_content .modal_body .adyen-checkout__status--success .adyen-checkout__status__icon',
              '.vd-cmp-payment .vd-cmp-payment__modal .adyenComponentLightBox .modal_container .lightBoxPositon .adyenDialog .modal_content .modal_body .adyen-checkout__status--success .adyen-checkout__status__text',
            ],
            customPropertyCount: 0,
          },
        }),
      });

      const result = cssCustomProps.run(payload);
      expect(result.detail).toContain(
        'Examples: .adyen-checkout__status--success, .adyen-checkout__status--success .adyen-checkout__status__icon, .adyen-checkout__status--success .adyen-checkout__status__text.'
      );
      expect(result.detail).not.toContain('.vd-cmp-payment');
      expect(result.detail).toContain('561 more selectors omitted.');
    });
  });
});
