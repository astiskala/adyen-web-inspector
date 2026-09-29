import { describe, it, expect } from 'vitest';
import { SDK_VERSION_CHECKS } from '../../../src/background/checks/sdk-version';
import {
  makeAdyenPayload,
  makeCheckoutPage,
  makeScanPayload,
  makeVersionInfo,
} from '../../fixtures/makeScanPayload';
import { requireCheck } from './requireCheck';

const versionDetected = requireCheck(SDK_VERSION_CHECKS, 'version-detected');
const versionLatest = requireCheck(SDK_VERSION_CHECKS, 'version-latest');
const upliftCobadgedVersion = requireCheck(SDK_VERSION_CHECKS, 'uplift-cobadged-version');

describe('version-detected', () => {
  it('returns info when version is detected', () => {
    const payload = makeScanPayload({ versionInfo: makeVersionInfo({ detected: '5.67.0' }) });
    expect(versionDetected.run(payload).severity).toBe('info');
  });

  it('reports which signal established the version', () => {
    const fromBundle = makeScanPayload({
      versionInfo: makeVersionInfo({ detected: '6.20.0', source: 'bundle' }),
    });
    const fromMetadata = makeScanPayload({
      versionInfo: makeVersionInfo({ detected: '6.20.0', source: 'metadata' }),
    });

    expect(versionDetected.run(fromBundle).detail).toContain('same-origin bundle');
    expect(versionDetected.run(fromMetadata).detail).toContain('AdyenWebMetadata');
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

  it('returns skip when a version string cannot be parsed', () => {
    const payload = makeScanPayload({
      versionInfo: makeVersionInfo({ detected: 'next', latest: '6.45.2' }),
    });
    expect(versionLatest.run(payload).severity).toBe('skip');
  });

  const scannedAt = '2026-09-28T12:00:00.000Z';

  it('returns a low-impact notice for minor drift on a release younger than 6 months', () => {
    const payload = makeScanPayload({
      scannedAt,
      versionInfo: makeVersionInfo({
        detected: '6.40.0',
        latest: '6.45.2',
        detectedReleasedAt: '2026-04-15T09:00:00.000Z',
      }),
    });
    const result = versionLatest.run(payload);
    expect(result).toMatchObject({ severity: 'notice', impact: 'low' });
    expect(result.title).toContain('released within the last 6 months');
  });

  it('warns when the detected release is older than 6 months, even for patch drift', () => {
    const payload = makeScanPayload({
      scannedAt,
      versionInfo: makeVersionInfo({
        detected: '6.45.1',
        latest: '6.45.2',
        detectedReleasedAt: '2026-03-01T09:00:00.000Z',
      }),
    });
    const result = versionLatest.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.title).toBe(
      'Version 6.45.1 was released on 2026-03-01, more than 6 months ago (latest: 6.45.2).'
    );
  });

  it('treats a release exactly 6 months old as recent', () => {
    const payload = makeScanPayload({
      scannedAt,
      versionInfo: makeVersionInfo({
        detected: '6.40.0',
        latest: '6.45.2',
        detectedReleasedAt: '2026-03-28T12:00:00.000Z',
      }),
    });
    expect(versionLatest.run(payload).severity).toBe('notice');
  });

  it('falls back to version drift when the release date is invalid', () => {
    const payload = makeScanPayload({
      scannedAt,
      versionInfo: makeVersionInfo({
        detected: '6.40.0',
        latest: '6.45.2',
        detectedReleasedAt: 'not-a-date',
      }),
    });
    expect(versionLatest.run(payload).title).toBe(
      'Version 6.40.0 is behind latest minor version (6.45.2).'
    );
  });

  it('warns on major drift for a recent release', () => {
    const payload = makeScanPayload({
      scannedAt,
      versionInfo: makeVersionInfo({
        detected: '6.45.2',
        latest: '7.0.0',
        detectedReleasedAt: '2026-09-01T00:00:00.000Z',
      }),
    });
    expect(versionLatest.run(payload).title).toContain('behind latest major version');
  });
});

describe('uplift-cobadged-version', () => {
  it('passes at the minimum supported version', () => {
    const payload = makeAdyenPayload(
      {},
      {},
      {
        versionInfo: makeVersionInfo({ detected: '6.16.0' }),
      }
    );
    expect(upliftCobadgedVersion.run(payload).severity).toBe('pass');
  });

  it('passes above the minimum supported version', () => {
    const payload = makeAdyenPayload(
      {},
      {},
      {
        versionInfo: makeVersionInfo({ detected: '6.30.0' }),
      }
    );
    expect(upliftCobadgedVersion.run(payload).severity).toBe('pass');
  });

  it('fails below the minimum supported version', () => {
    const payload = makeAdyenPayload(
      {},
      {},
      {
        versionInfo: makeVersionInfo({ detected: '6.15.9' }),
      }
    );
    const result = upliftCobadgedVersion.run(payload);
    expect(result.severity).toBe('fail');
    expect(result.docsUrl).toBe('https://docs.adyen.com/uplift/uplift-requirements/');
  });

  it('skips when the SDK version cannot be detected', () => {
    const payload = makeScanPayload({
      versionInfo: makeVersionInfo({ detected: null }),
    });
    expect(upliftCobadgedVersion.run(payload).severity).toBe('skip');
  });

  it('does not fail for a versioned SDK with no active checkout', () => {
    const payload = makeScanPayload({
      page: makeCheckoutPage({ adyenMetadata: { version: '6.15.9' } }),
      versionInfo: makeVersionInfo({ detected: '6.15.9' }),
    });
    expect(upliftCobadgedVersion.run(payload).severity).toBe('skip');
  });

  it('skips a custom integration not covered by the Drop-in/Components rule', () => {
    const payload = makeAdyenPayload(
      {},
      {},
      {
        analyticsData: { flavor: 'custom' },
        versionInfo: makeVersionInfo({ detected: '6.15.9' }),
      }
    );
    expect(upliftCobadgedVersion.run(payload).severity).toBe('skip');
  });
});
