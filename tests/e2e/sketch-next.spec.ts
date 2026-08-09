import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
if (existsSync(LOCAL_CHROMIUM)) {
  test.use({ launchOptions: { executablePath: LOCAL_CHROMIUM } });
}

/**
 * Group tool (#4, ADR-0135) and responsive toolbars (#5, ADR-0136).
 */

test('Group tool is selectable, HUD-less, and catalogued', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();

  await page.keyboard.press('u'); // Group
  await expect(page.getByRole('button', { name: /^Group/ })).toHaveClass(/iconBtnActive/);
  // It picks existing geometry, so no numeric HUD.
  await expect(page.getByTestId('numeric-hud')).toBeHidden();

  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts-overlay')).toContainText('Group');
});

test('Offset applies on Enter from the parameters window', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await page.waitForTimeout(300);
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Draw a circle.
  await page.keyboard.press('c');
  await page.mouse.click(cx, cy);
  const dia = page.getByTestId('hud-field-diameter');
  await dia.click();
  await dia.fill('60');
  await page.getByTestId('hud-commit').click();
  await page.waitForTimeout(150);
  // Offset it: box-select, type a distance, press Enter (no side click).
  await page.keyboard.press('w');
  await page.mouse.move(cx - 250, cy - 250);
  await page.mouse.down();
  await page.mouse.move(cx + 250, cy + 250);
  await page.mouse.up();
  const dist = page.getByTestId('hud-field-distance');
  await dist.click();
  await dist.fill('15');
  await page.mouse.move(cx + 200, cy);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  // A concentric offset circle now exists → the section has two profiles.
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(page.getByTestId('finish-summary')).toContainText('Profiles: 2');
});

test('the modeling ribbon slides horizontally instead of wrapping', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/app/');
  // The inline modeling actions ribbon must be a single, horizontally
  // scrollable row (no wrap to a second line that would grow the header).
  const ribbon = page.getByTestId('app-actions');
  await expect(ribbon).toBeVisible();
  const wrap = await ribbon.evaluate((el) => getComputedStyle(el).flexWrap);
  expect(wrap).toBe('nowrap');
  const overflowX = await ribbon.evaluate((el) => getComputedStyle(el).overflowX);
  expect(overflowX).toBe('auto');
});
