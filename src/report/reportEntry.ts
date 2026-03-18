import {
  buildPrintableHtml,
  getPdfReportStorageKey,
  PDF_REPORT_TOKEN_PARAM,
  type PrintableReportMetadata,
} from '~shared/export-pdf';
import type { ScanResult } from '~shared/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isScanResult(value: unknown): value is ScanResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['pageUrl'] === 'string' &&
    typeof value['scannedAt'] === 'string' &&
    Array.isArray(value['checks']) &&
    isRecord(value['health']) &&
    isRecord(value['payload'])
  );
}

function showError(message: string): void {
  document.title = 'Adyen Web Inspector - PDF Export Failed';
  document.body.replaceChildren();

  const container = document.createElement('main');
  container.style.cssText =
    'font-family:system-ui,sans-serif;padding:24px;color:#111827;max-width:720px;';

  const heading = document.createElement('h1');
  heading.textContent = 'Unable to prepare PDF export';
  heading.style.cssText = 'font-size:20px;margin:0 0 8px;';

  const detail = document.createElement('p');
  detail.textContent = message;
  detail.style.cssText = 'font-size:14px;line-height:1.5;margin:0;';

  container.append(heading, detail);
  document.body.append(container);
}

async function loadStoredResult(token: string): Promise<ScanResult | null> {
  const storageKey = getPdfReportStorageKey(token);

  try {
    const stored = await chrome.storage.session.get(storageKey);
    const value = stored[storageKey];
    await chrome.storage.session.remove(storageKey).catch(() => {});
    return isScanResult(value) ? value : null;
  } catch {
    return null;
  }
}

function renderReportHtml(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.title = parsed.title;
  document.documentElement.lang = parsed.documentElement.lang || 'en';
  document.head.replaceChildren(...Array.from(parsed.head.childNodes));
  document.body.replaceChildren(...Array.from(parsed.body.childNodes));
}

function triggerPrint(): void {
  globalThis.requestAnimationFrame(() => {
    globalThis.requestAnimationFrame(() => {
      globalThis.focus();
      globalThis.print();
    });
  });
}

interface NavigatorBrand {
  readonly brand: string;
  readonly version: string;
}

interface NavigatorUserAgentDataLike {
  readonly brands?: readonly NavigatorBrand[];
  readonly platform?: string;
}

function getUserAgentData(): NavigatorUserAgentDataLike | null {
  const navigatorWithUserAgentData = navigator as Navigator & {
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
  const userAgent = navigator.userAgent;
  const userAgentData = getUserAgentData();
  const platform =
    userAgentData?.platform === undefined || userAgentData.platform === ''
      ? detectPlatformFromUserAgent(userAgent)
      : normalizePlatform(userAgentData.platform);
  const browserInfo =
    userAgentData?.brands === undefined || userAgentData.brands.length === 0
      ? detectBrowserFromUserAgent(userAgent)
      : (detectBrowserFromBrands(userAgentData.brands) ?? detectBrowserFromUserAgent(userAgent));
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

function buildPrintableReportMetadata(): PrintableReportMetadata {
  return {
    extensionVersion: getExtensionVersion(),
    browser: buildBrowserLabel(),
  };
}

const url = new URL(globalThis.location.href);
const token = url.searchParams.get(PDF_REPORT_TOKEN_PARAM);

if (token === null || token === '') {
  showError('The PDF export request was missing its report token. Please try again.');
} else {
  try {
    const result = await loadStoredResult(token);
    if (result === null) {
      showError('The export data was unavailable. Please rerun the scan and try again.');
    } else {
      renderReportHtml(buildPrintableHtml(result, buildPrintableReportMetadata()));
      triggerPrint();
    }
  } catch {
    showError('An unexpected error occurred while building the export report.');
  }
}
