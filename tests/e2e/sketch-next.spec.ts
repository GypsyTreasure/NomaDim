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

test('a preselection survives the tool switch (Offset on preselected shapes)', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await page.waitForTimeout(250);
  const canvas = page.locator('canvas').first();
  const b = await canvas.boundingBox();
  if (!b) throw new Error('no canvas');
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.keyboard.press('c');
  await page.mouse.click(cx, cy);
  const dia = page.getByTestId('hud-field-diameter');
  await dia.click();
  await dia.fill('60');
  await page.getByTestId('hud-commit').click();
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  // Preselect the circle in SELECT mode, THEN pick Offset — selection must persist.
  await page.mouse.move(cx - 250, cy - 250);
  await page.mouse.down();
  await page.mouse.move(cx + 250, cy + 250);
  await page.mouse.up();
  await page.waitForTimeout(120);
  await expect(page.getByTestId('sketch-delete')).toBeEnabled();
  await page.keyboard.press('w');
  await expect(page.getByTestId('sketch-delete')).toBeEnabled(); // still selected
  const dist = page.getByTestId('hud-field-distance');
  await dist.click();
  await dist.fill('15');
  await page.mouse.move(cx + 200, cy);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(page.getByTestId('finish-summary')).toContainText('Profiles: 2');
});

test('Group re-welds an exploded rectangle from a preselection', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await page.waitForTimeout(250);
  const canvas = page.locator('canvas').first();
  const b = await canvas.boundingBox();
  if (!b) throw new Error('no canvas');
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.keyboard.press('r');
  await page.mouse.click(cx - 120, cy - 80);
  await page.mouse.click(cx + 120, cy + 80);
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  // Explode the whole rectangle (preselect → BMB), then Group it back (preselect → GRP).
  const selectAll = async (): Promise<void> => {
    await page.mouse.move(cx - 260, cy - 200);
    await page.mouse.down();
    await page.mouse.move(cx + 260, cy + 200);
    await page.mouse.up();
    await page.waitForTimeout(100);
  };
  await selectAll();
  await page.keyboard.press('k'); // explode → 4 separate lines
  await page.waitForTimeout(120);
  await selectAll();
  await page.keyboard.press('u'); // group → welds the corners back
  await page.waitForTimeout(120);
  // Clicking one edge now selects the whole (re-welded) rectangle; Delete clears
  // all four lines → nothing open remains.
  await page.mouse.click(cx, cy - 80);
  await page.waitForTimeout(80);
  await page.getByTestId('sketch-delete').click();
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(page.getByTestId('finish-summary')).toContainText('open: 0');
  await expect(page.getByTestId('finish-summary')).toContainText('Profiles: 0');
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
