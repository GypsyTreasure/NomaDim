import { expect, test } from '@playwright/test';

/**
 * M4 browser wiring (F4/F5): after a body exists, the Fillet dialog opens and
 * flips the viewport into edge-pick mode. The geometric correctness of the
 * fillet and the "survives upstream edit / errors gracefully" acceptance are
 * proven deterministically in the kernel golden tests (finishing.spec.ts) —
 * in-browser edge raycasting is not clicked here (non-deterministic screen
 * projection), so this asserts the UI wiring end to end.
 */

test('finishing: fillet dialog opens with edge picking once a body exists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await expect(page.getByTestId('numeric-hud')).toBeVisible();

  await page.keyboard.press('c');
  await expect(page.getByTestId('hud-field-diameter')).toBeVisible();
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  // Extrude → one live body.
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.getByRole('dialog', { name: 'Extrude' }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });

  // Fillet dialog + edge-pick toggle.
  await page.getByRole('button', { name: 'Fillet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Fillet' });
  await expect(dialog).toBeVisible();
  const toggle = page.getByTestId('edge-pick-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveText('Pick edges in the viewport');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});
