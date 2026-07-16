import { expect, test } from '@playwright/test';

/**
 * Keyboard-shortcuts help overlay (F11): opens from the toolbar button and via
 * the "?" key, closes with Esc, and lists the tool hotkeys.
 */

test('the shortcuts overlay opens, lists hotkeys, and closes', async ({ page }) => {
  await page.goto('/');

  const overlay = page.getByTestId('shortcuts-overlay');
  await expect(overlay).toBeHidden();

  // Open from the toolbar.
  await page.getByTestId('shortcuts-open').click();
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Line tool');
  await expect(overlay).toContainText('Undo');

  // Esc closes.
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();

  // "?" toggles it open again, and the close button dismisses it.
  await page.keyboard.press('?');
  await expect(overlay).toBeVisible();
  await page.getByTestId('shortcuts-close').click();
  await expect(overlay).toBeHidden();
});
