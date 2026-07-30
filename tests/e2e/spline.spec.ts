import { expect, test } from '@playwright/test';

/**
 * B-spline sketch tool (ADR-0075), browser end-to-end: pick the Spline tool,
 * click fit points, close the curve on the first point, Finish Sketch, then
 * Extrude — a closed spline bounds a region on its own, so it builds a solid.
 * Proves the whole pipeline (draw → close → profile detect → kernel wire).
 */

test('draw a closed spline and extrude it into a body', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();

  const overlay = page.getByTestId('sketch-overlay');
  await expect(overlay).toBeVisible();
  // Let the normal-to-plane camera fly-in settle so pixel→plane mapping is
  // stable (closing the curve matches the first fit point's plane coords).
  await page.waitForTimeout(700);

  // Select the Spline tool.
  await page.getByRole('button', { name: 'Spline', exact: true }).click();

  // Click four fit points, then click back on the first to close + finish.
  // Hover before each click so the snap engine sees the live cursor (a bare
  // click doesn't emit a preceding pointermove, unlike a real user's pointer).
  const at = async (x: number, y: number): Promise<void> => {
    await overlay.hover({ position: { x, y } });
    await overlay.click({ position: { x, y } });
  };
  const first = { x: 300, y: 220 };
  await at(first.x, first.y);
  await at(400, 230);
  await at(420, 340);
  await at(290, 350);
  await at(first.x, first.y); // close on the first fit point

  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  // Extrude the closed-spline profile → one solid body.
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Extrude' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'OK' }).click();

  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });
});
