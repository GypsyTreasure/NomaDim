import { expect, test } from '@playwright/test';

/**
 * Project master rule (ADR-0032): menu actions are reachable by keyboard.
 * Spot-checks a few representative bindings end-to-end — New Sketch (N),
 * Measure (M), and a sketch tool hotkey — the full map is documented in the
 * shortcuts overlay and unit-covered in shortcuts.spec.
 */

test('menu actions respond to their keyboard shortcuts', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'New Sketch' })).toBeVisible();
  // Focus the app so window keydown listeners receive the presses.
  await page.mouse.click(3, 3);

  // N → New Sketch (opens the plane picker).
  await page.keyboard.press('n');
  await expect(page.getByTestId('plane-picker')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('plane-picker')).toBeHidden();

  // M → Measure mode on.
  await page.keyboard.press('m');
  await expect(page.getByTestId('measure-hud')).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByTestId('measure-hud')).toBeHidden();

  // In a sketch, tool hotkeys switch the active tool (Axis = I).
  await page.keyboard.press('n');
  await page.getByTestId('plane-choice-XY').click();
  await page.keyboard.press('i');
  await expect(page.getByRole('button', { name: 'Axis' })).toHaveClass(/buttonActive/);
});
