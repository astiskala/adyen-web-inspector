/**
 * UI tests — the built popup and DevTools panel must target the inspected tab and render its scan.
 */

import type { BrowserContext, Page } from '@playwright/test';
import {
  DEVTOOLS_PANEL_ICON_PATH,
  DEVTOOLS_PANEL_PAGE,
  DEVTOOLS_PANEL_TITLE,
} from '../../src/shared/constants';
import type { ScanResult } from '../../src/shared/types';
import {
  test,
  expect,
  getBadgeText,
  getStoredScanResult,
  openDevtoolsPanelFor,
  openFixture,
  openPopupFor,
  requireCheck,
} from './fixtures';

const CHECKOUT_FIXTURE = 'dummy-merchant.html?scenario=sessions-dropin';
const SCAN_TIMEOUT_MS = 15_000;

async function requireStoredResult(
  context: BrowserContext,
  extensionId: string,
  page: Page
): Promise<ScanResult> {
  const result = await getStoredScanResult(context, extensionId, page);
  if (result === null) throw new Error(`No stored scan result for ${page.url()}`);
  expect(result.pageUrl).toBe(page.url());
  return result;
}

test.describe('Popup', () => {
  test('shows the detected state for the inspected Adyen page', async ({
    context,
    extensionId,
  }) => {
    const page = await openFixture(context, 'adyen-merchant.html');
    await expect.poll(() => getBadgeText(context, extensionId, page)).toBe('✓');

    const popup = await openPopupFor(context, extensionId, page);

    await expect(popup.getByText('Adyen Web SDK detected')).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Run Scan', exact: true })).toBeEnabled();
    await expect(popup.getByText('Adyen not detected')).toHaveCount(0);
  });

  test('attempts a scan of the inspected page when Adyen is not detected', async ({
    context,
    extensionId,
  }) => {
    const page = await openFixture(context, 'no-adyen.html');
    const popup = await openPopupFor(context, extensionId, page);

    await expect(popup.getByText('Adyen not detected')).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Run Scan', exact: true })).toHaveCount(0);

    await popup.getByRole('button', { name: 'Attempt Scan', exact: true }).click();
    await expect
      .poll(async () => (await getStoredScanResult(context, extensionId, page))?.pageUrl, {
        timeout: SCAN_TIMEOUT_MS,
      })
      .toBe(page.url());

    const result = await requireStoredResult(context, extensionId, page);
    expect(requireCheck(result, 'sdk-detected').severity).toBe('fail');
    await expect(popup.getByRole('button', { name: 'Attempt Scan', exact: true })).toBeEnabled();
    await expect(popup.getByText('Health Score')).toHaveCount(0);
    expect(await getBadgeText(context, extensionId, page)).toBe('');
  });

  test('renders health, attributes and findings after scanning the inspected page', async ({
    context,
    extensionId,
  }) => {
    const page = await openFixture(context, CHECKOUT_FIXTURE);
    await expect.poll(() => getBadgeText(context, extensionId, page)).toBe('✓');
    const popup = await openPopupFor(context, extensionId, page);

    await popup.getByRole('button', { name: 'Run Scan', exact: true }).click();
    await expect(popup.getByRole('button', { name: 'Re-run Scan', exact: true })).toBeEnabled({
      timeout: SCAN_TIMEOUT_MS,
    });

    const result = await requireStoredResult(context, extensionId, page);
    const { score, passing, total } = result.health;
    expect(await getBadgeText(context, extensionId, page)).toBe(`${score}`);
    const passRatio = popup.getByText(`${passing}/${total} checks passing`, { exact: true });
    await expect(passRatio).toBeVisible();
    await expect(passRatio.locator('xpath=following-sibling::span')).toHaveText(`${score}`);

    await expect(popup.getByText('Implementation Attributes')).toBeVisible();
    await expect(popup.getByText('6.31.0', { exact: true })).toBeVisible();
    await expect(popup.getByText('Sessions', { exact: true })).toBeVisible();
    await expect(popup.getByText('Drop-in', { exact: true })).toBeVisible();

    const cspFinding = requireCheck(result, 'security-csp-present');
    expect(cspFinding.severity).toBe('warn');
    const warningCount = result.checks.filter((check) => check.severity === 'warn').length;
    const warnings = popup.locator('summary', { hasText: 'Warnings' });
    await expect(warnings).toContainText(`${warningCount}`);
    await expect(popup.getByText(cspFinding.title, { exact: true })).toBeHidden();
    await warnings.click();
    await expect(popup.getByText(cspFinding.title, { exact: true })).toBeVisible();

    await expect(popup.getByRole('button', { name: 'Export PDF', exact: true })).toBeVisible();
  });
});

test.describe('DevTools panel', () => {
  test('DevTools page registers the Adyen Inspector panel', async ({ context, extensionId }) => {
    const devtoolsPage = await context.newPage();
    await devtoolsPage.addInitScript(() => {
      Object.assign(chrome, {
        devtools: {
          panels: {
            create: (title: string, iconPath: string, pagePath: string): void => {
              Object.assign(globalThis, { registeredPanel: { title, iconPath, pagePath } });
            },
          },
        },
      });
    });
    await devtoolsPage.goto(`chrome-extension://${extensionId}/devtools/devtools.html`);

    await expect
      .poll(() =>
        devtoolsPage.evaluate(
          () => (globalThis as { registeredPanel?: unknown }).registeredPanel ?? null
        )
      )
      .toEqual({
        title: DEVTOOLS_PANEL_TITLE,
        iconPath: DEVTOOLS_PANEL_ICON_PATH,
        pagePath: DEVTOOLS_PANEL_PAGE,
      });
  });

  test('renders scan findings for the inspected tab across panel tabs', async ({
    context,
    extensionId,
  }) => {
    const page = await openFixture(context, CHECKOUT_FIXTURE);
    const panel = await openDevtoolsPanelFor(context, extensionId, page);

    await expect(panel.getByText('Click "Run Scan" to inspect this page.')).toBeVisible();
    await panel.getByRole('button', { name: 'Run Scan', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Re-run Scan', exact: true })).toBeEnabled({
      timeout: SCAN_TIMEOUT_MS,
    });

    const result = await requireStoredResult(context, extensionId, page);
    const { score, passing, total } = result.health;
    await expect(panel.getByText(`Score: ${score} · ${passing}/${total} passing`)).toBeVisible();
    await expect(panel.getByText('Implementation Attributes')).toBeVisible();

    await panel.getByRole('button', { name: 'Security', exact: true }).click();
    const cspFinding = requireCheck(result, 'security-csp-present');
    await expect(panel.getByText(cspFinding.title, { exact: true })).toBeVisible();

    await panel.getByRole('button', { name: 'Skipped Checks', exact: true }).click();
    const skippedFinding = requireCheck(result, 'auth-client-key-rejected');
    expect(skippedFinding.severity).toBe('skip');
    await expect(panel.getByText(skippedFinding.title, { exact: true })).toBeVisible();

    await panel.getByRole('button', { name: 'Extracted Config', exact: true }).click();
    await expect(panel.locator('pre').first()).toContainText('"clientKey": "test_dummy"');
  });
});
