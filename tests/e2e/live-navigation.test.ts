/** Reproduces MyStore's hash-route navigation without depending on its live backend. */
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
  test.fail(
    true,
    'Hash navigation clears tab state but the detector suppresses unchanged activity.'
  );
  await expect(popup.getByText('Adyen Web SDK detected')).toBeVisible();
});
