import { expect, test } from '@playwright/test';

/**
 * Standard view controls (F11): the Home + 6-face buttons snap the camera and
 * the scene keeps rendering — a body stays live throughout. (Camera
 * orientation math is unit-tested in view-orientation.spec; this asserts the
 * buttons wire up and render without error.)
 */

test('the view buttons snap the camera without disturbing the model', async ({ page }) => {
  await page.goto('/');

  // One body.
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await expect(page.getByTestId('numeric-hud')).toBeVisible();
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

  // Cycle through every standard view.
  for (const id of ['home', 'front', 'back', 'left', 'right', 'top', 'bottom']) {
    await page.getByTestId(`view-${id}`).click();
  }

  // The scene still renders and the body is untouched.
  await expect(page.getByTestId('sketch-overlay')).toBeVisible();
  await expect(page.getByTestId('body-count')).toHaveText('1');
});
