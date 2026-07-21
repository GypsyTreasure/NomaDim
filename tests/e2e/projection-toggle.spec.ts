import { expect, test } from '@playwright/test';

/**
 * Perspective/orthographic toggle (F11): the button swaps projection, keeps the
 * scene rendering, and leaves the model untouched. (The framing math is
 * unit-tested in camera-rig.spec; this asserts the button rebinds the camera
 * without error and the label reflects the active projection.)
 */

test('the projection toggle swaps camera without disturbing the model', async ({ page }) => {
  await page.goto('/');

  // One body.
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await page.keyboard.press('c');
  await expect(page.getByTestId('hud-field-diameter')).toBeVisible();
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.getByRole('dialog', { name: 'Extrude' }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });

  // Reveal the view bar (collapsed behind the View menu).
  await page.getByTestId('view-toggle').click();

  const toggle = page.getByTestId('projection-toggle');
  await expect(toggle).toHaveText('Perspective');

  await toggle.click();
  await expect(toggle).toHaveText('Orthographic');

  await toggle.click();
  await expect(toggle).toHaveText('Perspective');

  // The scene still renders and the body is untouched.
  await expect(page.getByTestId('sketch-overlay')).toBeVisible();
  await expect(page.getByTestId('body-count')).toHaveText('1');
});
