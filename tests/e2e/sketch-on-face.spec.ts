import { expect, test } from '@playwright/test';

/**
 * Sketch on a body face (#1b): "New Sketch" → "Pick a face" → click a planar
 * body face → the worker resolves it into a sketch plane → draw + extrude on
 * it. Proves the whole pipeline: face-pick raycast → resolveFace → FacePlaneRef
 * → offset-plane sketching → a second body built off the first.
 */

test('pick a body face and sketch + extrude on it', async ({ page }) => {
  await page.goto('/');

  // Build a 40×40×10 box centred on the origin (planar faces, easy to hit).
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await page.getByRole('button', { name: 'Rectangle (Center)', exact: true }).click();
  await page.getByTestId('sketch-overlay').click(); // centre at the origin
  await page.keyboard.type('40');
  await page.keyboard.press('Tab');
  await page.keyboard.type('40');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.getByRole('dialog', { name: 'Extrude' }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });

  // New Sketch → Pick a face → click the box.
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-face').click();
  await expect(page.getByTestId('face-pick-hint')).toBeVisible();
  await page.getByTestId('sketch-overlay').click(); // hits the box → resolve a planar face
  // The sketch environment opens on the resolved face (Select default) — pick Circle.
  await page.keyboard.press('c');
  await expect(page.getByTestId('hud-field-diameter')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.getByRole('dialog', { name: 'Extrude' }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('2', { timeout: 30_000 });
});
