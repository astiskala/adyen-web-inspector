import { describe, it, expect } from 'vitest';
import { SDK_VERSION_CHECKS } from '../../../src/background/checks/sdk-version';
import { makeScanPayload, makeVersionInfo } from '../../fixtures/makeScanPayload';
import { requireCheck } from './requireCheck';

const versionDetected = requireCheck(SDK_VERSION_CHECKS, 'version-detected');
const versionLatest = requireCheck(SDK_VERSION_CHECKS, 'version-latest');

describe('version-detected', () => {
  it('returns info when version is detected', () => {
    const payload = makeScanPayload({ versionInfo: makeVersionInfo({ detected: '5.67.0' }) });
    expect(versionDetected.run(payload).severity).toBe('info');
  });

  it('returns warn when version cannot be detected', () => {
    const payload = makeScanPayload({ versionInfo: makeVersionInfo({ detected: null }) });
    expect(versionDetected.run(payload).severity).toBe('warn');
  });
});

describe('version-latest', () => {
  it('returns pass when on latest version', () => {
    const payload = makeScanPayload({
      versionInfo: makeVersionInfo({ detected: '5.68.0', latest: '5.68.0' }),
    });
    expect(versionLatest.run(payload).severity).toBe('pass');
  });

  it('returns notice when behind on patch version', () => {
    const payload = makeScanPayload({
      versionInfo: makeVersionInfo({ detected: '5.68.1', latest: '5.68.3' }),
    });
    expect(versionLatest.run(payload).severity).toBe('notice');
  });

  it('returns warn when behind on minor version', () => {
    const payload = makeScanPayload({
      versionInfo: makeVersionInfo({ detected: '5.67.5', latest: '5.68.0' }),
    });
    const result = versionLatest.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.docsUrl).toBe('https://docs.adyen.com/online-payments/upgrade-your-integration/');
  });

  it('returns warn when significantly behind', () => {
    const payload = makeScanPayload({
      versionInfo: makeVersionInfo({ detected: '5.60.0', latest: '5.68.0' }),
    });
    expect(versionLatest.run(payload).severity).toBe('warn');
  });

  it('returns skip when detected version unknown', () => {
    const payload = makeScanPayload({
      versionInfo: makeVersionInfo({ detected: null, latest: '5.68.0' }),
    });
    expect(versionLatest.run(payload).severity).toBe('skip');
  });

  it('returns skip when latest is unknown', () => {
    const payload = makeScanPayload({
      versionInfo: makeVersionInfo({ detected: '5.67.0', latest: null }),
    });
    expect(versionLatest.run(payload).severity).toBe('skip');
  });
});
