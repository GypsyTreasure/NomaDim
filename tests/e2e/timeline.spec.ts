import { expect, test } from '@playwright/test';

/**
 * M3 acceptance (MASTER_DOCUMENT §8), browser end-to-end: sketch a profile,
 * extrude it into a solid (the RegenScheduler boots the worker, the mesh
 * comes back and renders), then RE-ENTER the sketch and edit its entities —
 * the timeline regenerates the solid live without error. The exact-geometry
 * correctness of that regen is proven deterministically in the services +
 * kernel golden tests; this proves the whole browser pipeline is wired.
 */

test('sketch → extrude → edit sketch entity regenerates the solid', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();

  // A single Ø20 circle at the origin — one profile (sketch starts in Select, #2).
  await page.keyboard.press('c');
  await expect(page.getByTestId('hud-field-diameter')).toBeVisible();
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  // Extrude it: open the dialog, select the one profile, accept the defaults.
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Extrude' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'OK' }).click();

  // The worker builds the solid → one live body, extrude chip green.
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });
  const extrudeChip = page.getByTestId('timeline-chip').filter({ hasText: 'Extrude1' });
  await expect(extrudeChip).toHaveAttribute('data-status', 'ok');

  // Re-enter the sketch from its timeline chip and edit its entities: add a
  // second, larger concentric circle. The solid regenerates live and stays
  // valid (the extruded inner profile survives the edit).
  await page
    .getByTestId('timeline-chip')
    .filter({ hasText: 'Sketch1' })
    .getByRole('button')
    .first()
    .click();
  await page.keyboard.press('c');
  await expect(page.getByTestId('hud-field-diameter')).toBeVisible();
  await page.keyboard.type('40');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  // Regen after the sketch-entity edit still yields a valid body, no error.
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });
  await expect(page.getByTestId('timeline-chip').filter({ hasText: 'Extrude1' })).toHaveAttribute(
    'data-status',
    'ok'
  );
});
