import { expect, test } from '@playwright/test';

/**
 * Mouse-selectable numeric fields (#4a): a field can be focused by clicking it
 * (not only Tab), then typed into — the value lands in the clicked field.
 */

test('clicking a numeric field focuses it, then typing fills that field', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();

  // Sketch starts in Select (#2); pick Line — its fields are Length + Angle.
  await page.keyboard.press('l');
  await expect(page.getByTestId('numeric-hud')).toBeVisible();
  const angle = page.getByTestId('hud-field-angleAbs');
  await expect(angle).toBeVisible();

  // Click the Angle field (the second one) and type — it must land there.
  await angle.click();
  await page.keyboard.type('45');
  await expect(angle).toHaveValue('45');

  // Length stays untouched.
  await expect(page.getByTestId('hud-field-length')).toHaveValue('');
});
