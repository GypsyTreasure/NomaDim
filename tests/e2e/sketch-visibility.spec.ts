import { expect, test } from '@playwright/test';

/**
 * Sketch visibility (Fusion parity): a sketch's preview is shown after you
 * finish it, auto-hides the moment a feature consumes it, and can be brought
 * back from the browser tree. Exercised end-to-end through the tree's
 * per-sketch visibility checkbox.
 */

test('sketch preview shows, auto-hides on extrude, and can be re-shown', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await expect(page.getByTestId('numeric-hud')).toBeVisible();

  await page.keyboard.press('c');
  await expect(page.getByTestId('hud-field-diameter')).toBeVisible();
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  // Freshly finished sketch: its preview is visible (checkbox checked).
  const sketchRow = page.getByTestId('tree-sketch');
  await expect(sketchRow).toHaveCount(1);
  const eye = sketchRow.getByRole('checkbox');
  await expect(eye).toBeChecked();

  // Extrude consumes the sketch → its preview auto-hides.
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.getByRole('dialog', { name: 'Extrude' }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });
  await expect(eye).not.toBeChecked();

  // The user can make the preview visible again from the tree.
  await eye.check();
  await expect(eye).toBeChecked();
});
