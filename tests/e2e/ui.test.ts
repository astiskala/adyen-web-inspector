/**
UI tests — the built popup and DevTools panel must target the inspected tab and render its scan.
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
    await expect(popup.getByRole('button', { name: 'Run scan', exact: true })).toBeEnabled();
    await expect(popup.getByText('Adyen not detected')).toHaveCount(0);
  });

  test('attempts a scan of the inspected page when Adyen is not detected', async ({
    context,
    extensionId,
  }) => {
    const page = await openFixture(context, 'no-adyen.html');
    const popup = await openPopupFor(context, extensionId, page);

    await expect(popup.getByText('Adyen not detected')).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Run scan', exact: true })).toHaveCount(0);

    await popup.getByRole('button', { name: 'Attempt scan', exact: true }).click();
    await expect
      .poll(
        async () => {
          const stored = await getStoredScanResult(context, extensionId, page);
          return stored?.pageUrl;
        },
        { timeout: SCAN_TIMEOUT_MS }
      )
      .toBe(page.url());

    const result = await requireStoredResult(context, extensionId, page);
    expect(requireCheck(result, 'sdk-detected').severity).toBe('fail');
    await expect(popup.getByRole('button', { name: 'Attempt scan', exact: true })).toBeEnabled();
    await expect(popup.getByText('Health score')).toHaveCount(0);
    expect(await getBadgeText(context, extensionId, page)).toBe('');
  });

  test('renders health, attributes and findings after scanning the inspected page', async ({
    context,
    extensionId,
  }) => {
    const page = await openFixture(context, CHECKOUT_FIXTURE);
    await expect.poll(() => getBadgeText(context, extensionId, page)).toBe('✓');
    const popup = await openPopupFor(context, extensionId, page);

    await popup.getByRole('button', { name: 'Run scan', exact: true }).click();
    await expect(popup.getByRole('button', { name: 'Re-run scan', exact: true })).toBeEnabled({
      timeout: SCAN_TIMEOUT_MS,
    });

    const result = await requireStoredResult(context, extensionId, page);
    const { score, passing, total } = result.health;
    expect(await getBadgeText(context, extensionId, page)).toBe(score.toString());
    await expect(popup.getByRole('meter', { name: 'Health score' })).toHaveAttribute(
      'aria-valuenow',
      score.toString()
    );
    await expect(
      popup.getByText(`${passing} of ${total} checks passing`, { exact: true })
    ).toBeVisible();
    await expect(popup.getByText('Implementation attributes')).toHaveCount(0);

    await popup.getByRole('button', { name: 'Settings' }).click();
    await popup.getByRole('radio', { name: /^Detailed/ }).check();
    await popup.getByRole('button', { name: 'Back' }).click();
    await expect(popup.getByText('Implementation attributes')).toBeVisible();
    await expect(popup.getByText('6.31.0', { exact: true })).toBeVisible();
    await expect(popup.getByText('Sessions', { exact: true })).toBeVisible();
    await expect(popup.getByText('Drop-in', { exact: true })).toBeVisible();

    const cspFinding = requireCheck(result, 'security-csp-present');
    expect(cspFinding.severity).toBe('warn');
    const warnings = popup.locator('summary', { hasText: 'Warning' }).first();
    const warningCount = result.checks.filter((check) => check.severity === 'warn').length;
    await expect(warnings).toContainText(warningCount.toString());
    const issue = popup.getByText(cspFinding.title, { exact: true });
    await expect(warnings.locator('..')).toHaveAttribute('open', '');
    await expect(issue).toBeVisible();
    await issue.press('Enter');
    await expect(
      issue.locator('..').getByRole('link', { name: 'Read documentation' })
    ).toBeVisible();

    const bounds = await popup.getByRole('main').boundingBox();
    expect(bounds?.width).toBe(380);
    expect(bounds?.height).toBeLessThanOrEqual(600);
    await expect(
      popup.getByRole('button', { name: 'Open full report', exact: true })
    ).toBeVisible();
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

    await expect(panel.getByRole('heading', { name: 'Adyen Web SDK detected' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Export JSON' })).toBeDisabled();
    await panel.getByRole('button', { name: 'Run scan', exact: true }).first().click();
    await expect(panel.getByRole('button', { name: 'Re-run scan', exact: true })).toBeEnabled({
      timeout: SCAN_TIMEOUT_MS,
    });

    const result = await requireStoredResult(context, extensionId, page);
    const { score, passing, total } = result.health;
    await expect(panel.getByText(`Score: ${score} · ${passing}/${total} passing`)).toBeVisible();
    await expect(panel.getByText('Implementation attributes')).toBeVisible();

    await panel.getByRole('tab', { name: 'Overview', exact: true }).press('ArrowRight');
    await expect(panel.getByRole('tab', { name: 'Best practices' })).toBeFocused();
    await panel.getByRole('tab', { name: 'Best practices' }).press('ArrowRight');
    const cspFinding = requireCheck(result, 'security-csp-present');
    await expect(panel.getByText(cspFinding.title, { exact: true })).toBeVisible();

    await panel.getByRole('tab', { name: 'Skipped checks', exact: true }).click();
    const skippedFinding = requireCheck(result, 'auth-client-key-rejected');
    expect(skippedFinding.severity).toBe('skip');
    await expect(panel.getByText(skippedFinding.title, { exact: true })).toBeVisible();

    await panel.getByRole('tab', { name: 'Extracted config', exact: true }).click();
    await expect(panel.locator('pre').first()).toContainText('"clientKey": "test_dummy"');
  });
});

test('opens the full report, filters findings and exports at narrow widths', async ({
  context,
  extensionId,
}, testInfo) => {
  const page = await openFixture(context, 'dummy-merchant.html?scenario=advanced-components');
  await expect.poll(() => getBadgeText(context, extensionId, page)).toBe('✓');
  const popup = await openPopupFor(context, extensionId, page);
  const panel = await openDevtoolsPanelFor(context, extensionId, page);

  await popup.getByRole('button', { name: 'Settings' }).click();
  await popup.getByRole('radio', { name: 'Match system' }).press('ArrowRight');
  await popup.getByRole('radio', { name: 'Light', exact: true }).press('ArrowRight');
  await expect(popup.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await expect(panel.locator('html')).toHaveAttribute('data-theme', 'dark');
  await popup.getByRole('radio', { name: /^Detailed/ }).check();
  await popup.getByRole('button', { name: 'Back' }).click();
  await expect(popup.getByRole('button', { name: 'Settings' })).toBeFocused();
  const reopened = await openPopupFor(context, extensionId, page);
  await expect(reopened.locator('html')).toHaveAttribute('data-theme', 'dark');

  await reopened.getByRole('button', { name: 'Run scan', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'Open full report' })).toBeVisible({
    timeout: SCAN_TIMEOUT_MS,
  });
  await expect(reopened.getByRole('heading', { name: 'Implementation attributes' })).toBeAttached();

  await context.addInitScript(() => {
    Object.assign(globalThis, {
      print: (): void => {
        document.documentElement.dataset['printRequested'] = 'true';
      },
    });
  });
  const reportOpened = context.waitForEvent('page');
  await reopened.getByRole('button', { name: 'Open full report' }).click();
  const report = await reportOpened;
  await expect(report.getByRole('heading', { name: 'Integration health report' })).toBeVisible();
  await expect(report.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(report.locator('html')).not.toHaveAttribute('data-print-requested');

  await report.setViewportSize({ width: 375, height: 720 });
  await expect.poll(() => report.evaluate(() => document.documentElement.scrollWidth)).toBe(375);

  const findings = report.getByRole('region', { name: 'Findings', exact: true });
  const warningRows = findings.locator('tr[data-severity="warn"]');
  const failRows = findings.locator('tr[data-severity="fail"]');
  const noticeRows = findings.locator('tr[data-severity="notice"]');
  await expect(warningRows.first()).toBeVisible();
  await expect(failRows.first()).toBeVisible();
  await findings.getByRole('button', { name: /^Notice/ }).click();
  await expect(noticeRows.first()).toBeVisible();
  await expect(warningRows.first()).toBeHidden();
  await expect(failRows.first()).toBeHidden();

  const downloaded = report.waitForEvent('download');
  await report.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^adyen-inspector-\d+\.json$/);
  await report.getByRole('button', { name: 'Export PDF' }).click();
  await expect(report.locator('html')).toHaveAttribute('data-print-requested', 'true');

  await report.emulateMedia({ media: 'print' });
  await expect(report.getByRole('button', { name: 'Export PDF' })).toBeHidden();
  await expect(warningRows.first()).toBeVisible();
  await expect(failRows.first()).toBeVisible();
  await expect(report.getByText('SDK Metadata', { exact: true })).toBeVisible();
  const pdf = await report.pdf({
    path: testInfo.outputPath('integration-report.pdf'),
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
});
