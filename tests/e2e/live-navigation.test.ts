/**
Reproduces MyStore's hash-route navigation without depending on its live backend.
*/
import { test, expect, getBadgeText, openFixture, openPopupFor } from './fixtures';

test('keeps detecting mounted checkout after same-document navigation', async ({
  context,
  extensionId,
}) => {
  const page = await openFixture(context, 'adyen-merchant.html');
  await expect.poll(() => getBadgeText(context, extensionId, page)).toBe('✓');
  // Let all startup retries finish, as when a shopper spends time on the page.
  // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- The isolated-world detector retries through 6000 ms; they would mask this regression.
  await page.waitForTimeout(6500);
  await page.evaluate(() => {
    globalThis.location.hash = 'checkout';
  });
  await expect(page).toHaveURL(/#checkout$/);
  const popup = await openPopupFor(context, extensionId, page);
  await expect(popup.getByText('Adyen Web SDK detected')).toBeVisible();
});

test('clears detection after navigating to a page without checkout', async ({
  context,
  extensionId,
}) => {
  const page = await openFixture(context, 'adyen-merchant.html');
  await expect.poll(() => getBadgeText(context, extensionId, page)).toBe('✓');
  await page.goto('http://localhost:4321/no-adyen.html');
  // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- The re-report is sent on load; give it time to arrive before asserting it stayed clear.
  await page.waitForTimeout(500);
  await expect.poll(() => getBadgeText(context, extensionId, page)).toBe('');
});
