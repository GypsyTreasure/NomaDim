import { expect, test } from '@playwright/test';

/**
 * Split tool (#6, ADR-0099): a sketch tool that divides a picked line wherever
 * other lines cross it, inserting shared joint points. Selectable by button and
 * by its 'T' shortcut, HUD-less (it picks existing geometry), and catalogued in
 * the shortcuts overlay. (The split geometry is unit-tested in split-line.spec.)
 */

test('the Split tool is selectable, HUD-less, and catalogued', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();

  // Select the Split tool by its shortcut; its button reads active…
  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: /^Split/ })).toHaveClass(/iconBtnActive/);
  // …and the numeric HUD hides (it picks existing lines, not new dimensions).
  await expect(page.getByTestId('numeric-hud')).toBeHidden();

  // It's documented in the shortcuts overlay.
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts-overlay')).toContainText('Split');
});
