import type { PrintableReportMetadata } from './export-pdf.js';

interface NavigatorBrand {
  readonly brand: string;
  readonly version: string;
}

interface NavigatorUserAgentDataLike {
  readonly brands?: readonly NavigatorBrand[];
  readonly platform?: string;
}

function getUserAgentData(): NavigatorUserAgentDataLike | null {
  const navigatorWithUserAgentData = globalThis.navigator as Navigator & {
    userAgentData?: NavigatorUserAgentDataLike;
  };
  return navigatorWithUserAgentData.userAgentData ?? null;
}

function detectBrowserFromBrands(brands: readonly NavigatorBrand[]): NavigatorBrand | null {
  const preferredBrandNames = [
    'Microsoft Edge',
    'Google Chrome',
    'Chromium',
    'Opera',
    'Safari',
    'Firefox',
  ];

  for (const preferredBrandName of preferredBrandNames) {
    const matchedBrand = brands.find((brand) => brand.brand === preferredBrandName);
    if (matchedBrand !== undefined) {
      return matchedBrand;
    }
  }

  return brands.find((brand) => !brand.brand.startsWith('Not')) ?? null;
}

function detectBrowserFromUserAgent(userAgent: string): NavigatorBrand {
  const browserPatterns = [
    { brand: 'Microsoft Edge', pattern: /Edg\/([0-9.]+)/ },
    { brand: 'Opera', pattern: /OPR\/([0-9.]+)/ },
    { brand: 'Google Chrome', pattern: /Chrome\/([0-9.]+)/ },
    { brand: 'Firefox', pattern: /Firefox\/([0-9.]+)/ },
  ];

  for (const browserPattern of browserPatterns) {
    const match = browserPattern.pattern.exec(userAgent);
    if (match?.[1] !== undefined) {
      return { brand: browserPattern.brand, version: match[1] };
    }
  }

  if (userAgent.includes('Safari/')) {
    const safariVersionMatch = /Version\/([0-9.]+)/.exec(userAgent);
    if (safariVersionMatch?.[1] !== undefined) {
      return { brand: 'Safari', version: safariVersionMatch[1] };
    }
  }

  return { brand: 'Unknown Browser', version: '' };
}

function normalizePlatform(platform: string): string {
  if (platform === '') {
    return 'Unknown platform';
  }

  const normalizedPlatform = platform.toLowerCase();

  if (normalizedPlatform.includes('mac')) {
    return 'macOS';
  }
  if (normalizedPlatform.includes('win')) {
    return 'Windows';
  }
  if (normalizedPlatform.includes('android')) {
    return 'Android';
  }
  if (normalizedPlatform.includes('iphone')) {
    return 'iOS';
  }
  if (normalizedPlatform.includes('ipad')) {
    return 'iPadOS';
  }
  if (normalizedPlatform.includes('linux')) {
    return 'Linux';
  }

  return platform;
}

function detectPlatformFromUserAgent(userAgent: string): string {
  const normalizedUserAgent = userAgent.toLowerCase();

  if (normalizedUserAgent.includes('macintosh') || normalizedUserAgent.includes('mac os')) {
    return 'macOS';
  }
  if (normalizedUserAgent.includes('windows')) {
    return 'Windows';
  }
  if (normalizedUserAgent.includes('android')) {
    return 'Android';
  }
  if (normalizedUserAgent.includes('iphone')) {
    return 'iOS';
  }
  if (normalizedUserAgent.includes('ipad')) {
    return 'iPadOS';
  }
  if (normalizedUserAgent.includes('linux')) {
    return 'Linux';
  }

  return 'Unknown platform';
}

function buildBrowserLabel(): string {
  const userAgent = globalThis.navigator.userAgent;
  const userAgentData = getUserAgentData();

  let platform = detectPlatformFromUserAgent(userAgent);
  if (userAgentData?.platform !== undefined && userAgentData.platform !== '') {
    platform = normalizePlatform(userAgentData.platform);
  }

  let browserInfo = detectBrowserFromUserAgent(userAgent);
  if (userAgentData?.brands !== undefined && userAgentData.brands.length > 0) {
    browserInfo = detectBrowserFromBrands(userAgentData.brands) ?? browserInfo;
  }

  const versionSuffix = browserInfo.version === '' ? '' : ` ${browserInfo.version}`;
  return `${browserInfo.brand}${versionSuffix} on ${platform}`;
}

function getExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return 'Unknown';
  }
}

/** Collects extension and browser metadata for exported reports. */
export function buildPrintableReportMetadata(): PrintableReportMetadata {
  return {
    extensionVersion: getExtensionVersion(),
    browser: buildBrowserLabel(),
  };
}
