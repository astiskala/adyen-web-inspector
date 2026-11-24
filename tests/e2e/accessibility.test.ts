/**
Accessibility tests — axe-core checks the built popup and DevTools panel against WCAG 2.2 AA
after a scan, in light and dark colour schemes, with every expandable finding opened.
*/

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, openDevtoolsPanelFor, openFixture, openPopupFor } from './fixtures';

const CHECKOUT_FIXTURE = 'dummy-merchant.html?scenario=sessions-dropin';
const SCAN_TIMEOUT_MS = 15_000;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const COLOR_SCHEMES = ['light', 'dark'] as const;

async function scan(view: Page): Promise<void> {
  await view.getByRole('button', { name: 'Run Scan', exact: true }).click();
  await expect(view.getByRole('button', { name: 'Re-run Scan', exact: true })).toBeEnabled({
    timeout: SCAN_TIMEOUT_MS,
  });
}

/**
Opens every collapsed section so axe also checks the findings inside them.
*/
async function expandAll(view: Page): Promise<void> {
  await view.evaluate(() => {
    for (const details of document.querySelectorAll('details')) details.open = true;
  });
}

async function expectNoViolations(view: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page: view }).withTags(WCAG_TAGS).analyze();
  expect(
    violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))
  ).toEqual([]);
}

for (const colorScheme of COLOR_SCHEMES) {
  test(`popup meets WCAG 2.2 AA after a scan (${colorScheme})`, async ({
    context,
    extensionId,
  }) => {
    const page = await openFixture(context, CHECKOUT_FIXTURE);
    const popup = await openPopupFor(context, extensionId, page);
    await popup.emulateMedia({ colorScheme });

    await scan(popup);
    await expandAll(popup);
    await expectNoViolations(popup);
  });

  test(`DevTools panel meets WCAG 2.2 AA on every tab (${colorScheme})`, async ({
    context,
    extensionId,
  }) => {
    const page = await openFixture(context, CHECKOUT_FIXTURE);
    const panel = await openDevtoolsPanelFor(context, extensionId, page);
    await panel.emulateMedia({ colorScheme });

    await scan(panel);
    const tabs = await panel.getByRole('tab').all();
    for (const tab of tabs) {
      await tab.click();
      await expandAll(panel);
      await expectNoViolations(panel);
    }
  });
}
