import { afterEach, describe, expect, it } from 'vitest';
import { buildPrintableReportMetadata } from '../../../src/shared/export-metadata';

interface NavigatorBrand {
  readonly brand: string;
  readonly version: string;
}

interface NavigatorUserAgentDataLike {
  readonly brands?: readonly NavigatorBrand[];
  readonly platform?: string;
}

const originalChromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
const originalUserAgentDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.navigator,
  'userAgent'
);
const originalUserAgentDataDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.navigator,
  'userAgentData'
);

function restoreProperty(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, property);
    return;
  }

  Object.defineProperty(target, property, descriptor);
}

function setUserAgent(userAgent: string): void {
  Object.defineProperty(globalThis.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });
}

function setUserAgentData(userAgentData?: NavigatorUserAgentDataLike): void {
  if (userAgentData === undefined) {
    Reflect.deleteProperty(globalThis.navigator, 'userAgentData');
    return;
  }

  Object.defineProperty(globalThis.navigator, 'userAgentData', {
    configurable: true,
    value: userAgentData,
  });
}

function clearUserAgentData(): void {
  Reflect.deleteProperty(globalThis.navigator, 'userAgentData');
}

function setManifestVersion(version: string): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        getManifest: () => ({ version }),
      },
    },
  });
}

function setFailingManifestLookup(): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        getManifest: () => {
          throw new Error('manifest lookup failed');
        },
      },
    },
  });
}

afterEach(() => {
  restoreProperty(globalThis, 'chrome', originalChromeDescriptor);
  restoreProperty(globalThis.navigator, 'userAgent', originalUserAgentDescriptor);
  restoreProperty(globalThis.navigator, 'userAgentData', originalUserAgentDataDescriptor);
});

describe('buildPrintableReportMetadata', () => {
  it('prefers userAgentData brand and platform metadata when available', () => {
    setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
    );
    setUserAgentData({
      brands: [
        { brand: 'Not A(Brand)', version: '99' },
        { brand: 'Google Chrome', version: '135.0.4890.17' },
      ],
      platform: 'macOS',
    });
    setManifestVersion('1.2.3');

    expect(buildPrintableReportMetadata()).toEqual({
      extensionVersion: '1.2.3',
      browser: 'Google Chrome 135.0.4890.17 on macOS',
    });
  });

  it('falls back to the user agent for Edge on Windows', () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
    );
    clearUserAgentData();
    setManifestVersion('9.9.9');

    expect(buildPrintableReportMetadata()).toEqual({
      extensionVersion: '9.9.9',
      browser: 'Microsoft Edge 120.0.0.0 on Windows',
    });
  });

  it('falls back to the user agent for Opera on Android', () => {
    setUserAgent(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 OPR/116.0.0.0'
    );
    clearUserAgentData();
    setManifestVersion('2.0.0');

    expect(buildPrintableReportMetadata()).toEqual({
      extensionVersion: '2.0.0',
      browser: 'Opera 116.0.0.0 on Android',
    });
  });

  it('detects Safari on iPhone and handles missing extension metadata', () => {
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1'
    );
    clearUserAgentData();
    setFailingManifestLookup();

    expect(buildPrintableReportMetadata()).toEqual({
      extensionVersion: 'Unknown',
      browser: 'Safari 17.3 on iOS',
    });
  });

  it('detects Firefox on iPad from the user agent string', () => {
    setUserAgent(
      'Mozilla/5.0 (iPad; CPU OS 17_3 like Mac OS X; rv:123.0) Gecko/20100101 Firefox/123.0'
    );
    clearUserAgentData();
    setManifestVersion('3.0.0');

    expect(buildPrintableReportMetadata()).toEqual({
      extensionVersion: '3.0.0',
      browser: 'Firefox 123.0 on iPadOS',
    });
  });

  it('falls back to the first non-placeholder brand and preserves unknown platforms', () => {
    setUserAgent('CustomBrowser/1.0');
    setUserAgentData({
      brands: [
        { brand: 'Not A(Brand)', version: '99' },
        { brand: 'Brave', version: '1.65.123' },
      ],
      platform: 'Haiku',
    });
    setManifestVersion('4.0.0');

    expect(buildPrintableReportMetadata()).toEqual({
      extensionVersion: '4.0.0',
      browser: 'Brave 1.65.123 on Haiku',
    });
  });

  it('returns unknown values when neither browser nor platform can be inferred', () => {
    setUserAgent('MysteryAgent/9.0');
    setUserAgentData({
      brands: [{ brand: 'Not;A Brand', version: '99' }],
    });
    setManifestVersion('5.0.0');

    expect(buildPrintableReportMetadata()).toEqual({
      extensionVersion: '5.0.0',
      browser: 'Unknown Browser on Unknown platform',
    });
  });
});
