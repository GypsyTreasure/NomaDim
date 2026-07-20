import { expect, test } from '@playwright/test';

/**
 * Revolve axis (F3): the sketch has a dedicated Axis tool (a named centerline),
 * and the Revolve dialog offers origin X/Y/Z plus any axis lines. This draws a
 * profile beside an axis line and revolves the profile around that axis into a
 * solid — proving the axis tool → revolve-axis pipeline end to end.
 */

test('draw an axis line and revolve a profile around it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();

  // Axis tool: a vertical centerline through the origin (keyboard: length 40, 90°).
  await page.getByRole('button', { name: 'Axis', exact: true }).click();
  await expect(page.getByTestId('numeric-hud')).toBeVisible();
  await page.keyboard.type('40');
  await page.keyboard.press('Tab');
  await page.keyboard.type('90');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  // A rectangle profile offset to the +X side of the axis.
  await page.getByRole('button', { name: 'Rectangle (2-Point)', exact: true }).click();
  await page.mouse.click(400, 300);
  await page.keyboard.type('10');
  await page.keyboard.press('Tab');
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  // Revolve around the axis line ("Axis 1" in the dropdown) → one solid.
  await page.getByRole('button', { name: 'Revolve', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Revolve' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox').first().check(); // select the profile
  // The axis dropdown lists the centerline as "Axis 1".
  await expect(dialog.getByRole('option', { name: 'Axis 1' })).toHaveCount(1);
  await dialog.getByRole('combobox', { name: 'Axis' }).selectOption({ label: 'Axis 1' });
  await page.getByRole('button', { name: 'OK' }).click();

  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });
});
