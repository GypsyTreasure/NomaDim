import { expect, test } from '@playwright/test';

/**
 * First-run onboarding hint (F11): shown on an empty document, dismissible and
 * remembered, and out of the way once the New Sketch flow begins.
 */

test('the onboarding hint shows on an empty document and dismisses', async ({ page }) => {
  await page.goto('/');

  const hint = page.getByTestId('onboarding-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('New Sketch');

  // Dismiss it, and it stays gone across a reload (localStorage).
  await page.getByTestId('onboarding-dismiss').click();
  await expect(hint).toBeHidden();
  await page.reload();
  await expect(hint).toBeHidden();
});

test('the onboarding hint steps aside for the plane picker', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('onboarding-hint')).toBeVisible();

  await page.getByRole('button', { name: 'New Sketch' }).click();
  await expect(page.getByTestId('plane-picker')).toBeVisible();
  await expect(page.getByTestId('onboarding-hint')).toBeHidden();
});
