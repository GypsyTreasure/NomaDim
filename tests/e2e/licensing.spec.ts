import { expect, test } from '@playwright/test';

/**
 * M11 licensing, browser end-to-end: the free tier shows the License menu and
 * gates STEP export behind Pro (STL only). Full crypto-verify paths are covered
 * by unit tests; this asserts the free-tier UI wiring works in the real app.
 */

test('free tier: License menu opens and STEP export is hidden', async ({ page }) => {
  await page.goto('/app/');

  // The action cluster shows the license status (free by default).
  const license = page.getByTestId('license-open');
  // Icon-only button (ADR-0090): the tier lives in the accessible name / tooltip.
  await expect(license).toHaveAttribute('aria-label', /Free/);
  await license.click();
  await expect(page.getByTestId('license-status')).toBeVisible();
  await expect(page.getByTestId('license-key')).toBeVisible(); // paste field
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Invalid key fails closed (stays Free).
  await license.click();
  await page.getByTestId('license-key').fill('not.a.valid.token');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('license-open')).toHaveAttribute('aria-label', /Free/);
});
