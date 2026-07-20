import { expect, test } from '@playwright/test';

/**
 * Sketch tool workflow: entry starts in Select/navigate (#2), the toolbar leads
 * with Finish (#3b), shape tools are single-shot while Line chains as the
 * free-shape tool (#3a), and the Intersect toggle (#1) exposes a body's section
 * on the sketch plane.
 */

test('Select default, single-shot tools, Line chains, Finish leads', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();

  // Entry is Select: no drawing HUD until a tool is picked (#2).
  await expect(page.getByTestId('numeric-hud')).toBeHidden();
  // Finish leads the toolbar (#3b).
  await expect(page.getByTestId('finish-sketch')).toBeVisible();

  // A shape tool (Circle) is single-shot: after one commit it returns to Select (#3a).
  await page.keyboard.press('c');
  await expect(page.getByTestId('numeric-hud')).toBeVisible();
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('numeric-hud')).toBeHidden();

  // Line is the continuous free-shape tool — it stays armed across segments (#3a).
  await page.keyboard.press('l');
  await expect(page.getByTestId('numeric-hud')).toBeVisible();
  await page.keyboard.type('30');
  await page.keyboard.press('Tab');
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  // Still armed (chained) → HUD remains for the next segment.
  await expect(page.getByTestId('numeric-hud')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('Intersect toggle is present and catalogued', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XZ').click();

  const intersect = page.getByTestId('sketch-intersect');
  await expect(intersect).toBeVisible();
  await expect(intersect).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('j'); // shortcut (ADR-0032)
  await expect(intersect).toHaveAttribute('aria-pressed', 'true');

  // Documented in the shortcuts overlay.
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts-overlay')).toContainText('Intersect');
});
