import { expect, test } from '@playwright/test';

/**
 * Through-All cut (#7): a sketched profile can cut clean through an existing
 * body via Extrude → operation Cut, extent Through All. The kernel math
 * (volume of the through-cut) is unit-tested in executors.spec; this drives the
 * dialog end-to-end and confirms the body survives the cut.
 */

test('a sketch cuts through a body with Cut + Through All', async ({ page }) => {
  await page.goto('/');

  // Body 1: a Ø30 disc, 10 mm tall.
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await page.keyboard.press('c');
  await page.keyboard.type('30');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  const extrude1 = page.getByRole('dialog', { name: 'Extrude' });
  await extrude1.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });

  // A Ø10 hole sketched on the same plane, cut Through All.
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await page.keyboard.press('c');
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  const extrude2 = page.getByRole('dialog', { name: 'Extrude' });
  await extrude2.getByRole('checkbox').first().check();
  await extrude2.getByLabel('Operation').selectOption('Cut');
  await extrude2.getByLabel('Direction').selectOption('all');
  await extrude2.getByLabel('Target Body').selectOption({ index: 0 });
  await page.getByRole('button', { name: 'OK' }).click();

  // The cut applied to the existing body — still exactly one body.
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });
});
