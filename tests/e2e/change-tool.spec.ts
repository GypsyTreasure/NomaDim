import { expect, test } from '@playwright/test';

/**
 * Change tool (#3): a dedicated sketch tool for repositioning points, selectable
 * by button and by its 'M' shortcut and listed in the shortcuts overlay. It
 * edits existing points (drag / properties) rather than drawing, so it carries
 * no numeric-HUD fields. (The grab/drag math is unit-tested in tool-logic.spec
 * via nearestPointId; exact-coordinate editing via the properties panel is
 * covered by the Select-mode flow.)
 */

test('the Change tool is selectable, HUD-less, and catalogued', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await expect(page.getByTestId('numeric-hud')).toBeVisible();

  // Select the Change tool by its shortcut; its button reads active…
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Change' })).toHaveClass(/buttonActive/);
  // …and the numeric HUD hides (it edits existing points, not new dimensions).
  await expect(page.getByTestId('numeric-hud')).toBeHidden();

  // It's documented in the shortcuts overlay.
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts-overlay')).toContainText('Change');
});
