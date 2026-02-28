import { describe, it, expect } from 'vitest';
import { RISK_CHECKS } from '../../../src/background/checks/risk-module';
import { makeScanPayload, makePageExtract } from '../../fixtures/makeScanPayload';
import { DF_IFRAME_NAME } from '../../../src/shared/constants';
import { requireCheck } from './requireCheck';

const riskIframe = requireCheck(RISK_CHECKS, 'risk-df-iframe');
const riskNotDisabled = requireCheck(RISK_CHECKS, 'risk-module-not-disabled');

describe('risk-df-iframe', () => {
  it('passes when dfIframe is present', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        iframes: [{ name: DF_IFRAME_NAME, src: 'https://live.adyen.com/dfIframe' }],
      }),
    });
    expect(riskIframe.run(payload).severity).toBe('pass');
  });

  it('warns when dfIframe is absent', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ iframes: [] }),
    });
    expect(riskIframe.run(payload).severity).toBe('warn');
  });
});

describe('risk-module-not-disabled', () => {
  it('skips when checkout config is not detected', () => {
    const payload = makeScanPayload({
      page: makePageExtract({ checkoutConfig: null }),
    });
    expect(riskNotDisabled.run(payload).severity).toBe('skip');
  });

  it('passes when riskEnabled is not explicitly false', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: {
          clientKey: 'test_X',
          environment: 'test',
        },
      }),
    });
    expect(riskNotDisabled.run(payload).severity).toBe('pass');
  });

  it('warns when riskEnabled is false', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: {
          clientKey: 'test_X',
          environment: 'test',
          riskEnabled: false,
        },
      }),
    });
    expect(riskNotDisabled.run(payload).severity).toBe('warn');
  });

  it('notices when riskEnabled is undefined but inferred config exists', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        checkoutConfig: null,
        inferredConfig: {
          clientKey: 'test_X',
          environment: 'test',
        },
      }),
    });
    expect(riskNotDisabled.run(payload).severity).toBe('notice');
  });
});
