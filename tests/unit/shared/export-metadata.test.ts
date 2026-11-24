import { afterEach, describe, expect, it } from 'vitest';
import { describeBrowser } from '../../../src/shared/export-metadata';

interface NavigatorBrand {
  readonly brand: string;
  readonly version: string;
}

interface NavigatorUserAgentDataLike {
  readonly brands?: readonly NavigatorBrand[];
  readonly platform?: string;
}

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

afterEach(() => {
  restoreProperty(globalThis.navigator, 'userAgent', originalUserAgentDescriptor);
  restoreProperty(globalThis.navigator, 'userAgentData', originalUserAgentDataDescriptor);
});

describe('describeBrowser', () => {
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

    expect(describeBrowser()).toBe('Google Chrome 135.0.4890.17 on macOS');
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

    expect(describeBrowser()).toBe('Brave 1.65.123 on Haiku');
  });

  it('returns unknown values when neither browser nor platform can be inferred', () => {
    setUserAgent('MysteryAgent/9.0');
    setUserAgentData({
      brands: [{ brand: 'Not;A Brand', version: '99' }],
    });

    expect(describeBrowser()).toBe('Unknown Browser on Unknown platform');
  });
});

describe('describeBrowser user-agent fallbacks', () => {
  it.each([
    [
      'Edge on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      'Microsoft Edge 120.0.0.0 on Windows',
    ],
    [
      'Opera on Android',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 OPR/116.0.0.0',
      'Opera 116.0.0.0 on Android',
    ],
    [
      'Safari on iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
      'Safari 17.3 on iOS',
    ],
    [
      'Firefox on iPad',
      'Mozilla/5.0 (iPad; CPU OS 17_3 like Mac OS X; rv:123.0) Gecko/20100101 Firefox/123.0',
      'Firefox 123.0 on iPadOS',
    ],
    [
      'Chrome on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      'Google Chrome 134.0.0.0 on macOS',
    ],
    [
      'Firefox on Linux',
      'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
      'Firefox 124.0 on Linux',
    ],
    [
      'a Safari web view without a version',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1',
      'Unknown Browser on iOS',
    ],
  ])('reads %s from the user agent', (_label, userAgent, browser) => {
    setUserAgent(userAgent);
    clearUserAgentData();

    expect(describeBrowser()).toBe(browser);
  });
});
