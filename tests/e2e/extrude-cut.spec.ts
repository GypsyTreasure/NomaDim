import { expect, test } from '@playwright/test';

/**
 * Boolean ops in the Extrude dialog (#6): choosing Cut (or Join/Intersect)
 * auto-selects a target body so OK is immediately actionable — previously it
 * looked "dead" because no target was chosen and OK stayed disabled.
 */

test('choosing Cut in Extrude auto-selects a target and enables OK', async ({ page }) => {
  await page.goto('/');

  // A body to cut into: Ø30 disc extruded.
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await page.keyboard.press('c');
  await page.keyboard.type('30');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.getByRole('dialog', { name: 'Extrude' }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });

  // A Ø10 hole to cut through it.
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await page.keyboard.press('c');
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Extrude' });
  await dialog.getByRole('checkbox').first().check();

  // Switch to Cut → the target body auto-fills and OK becomes clickable.
  await dialog.getByLabel('Operation').selectOption('Cut');
  await expect(dialog.getByLabel('Target Body')).not.toHaveValue('');
  const ok = page.getByRole('button', { name: 'OK' });
  await expect(ok).toBeEnabled();
  await ok.click();

  // The cut applied (still one body, now with a hole) — no error.
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });
});
