import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Some sandboxes ship a fixed Chromium build (e.g. 1194) rather than the shell
// Playwright pins; when that binary is present, launch it explicitly. In CI the
// path is absent, so this is skipped and the installed browser is used.
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
if (existsSync(LOCAL_CHROMIUM)) {
  test.use({ launchOptions: { executablePath: LOCAL_CHROMIUM } });
}

/**
 * Sketch edit-tool parameters live in the numeric parameters window (#1,
 * ADR-0134), like circle/line — not on the toolbar. Offset exposes a Distance
 * field; Move/Stretch expose ΔX/ΔY. Geometry is unit-tested; this checks the
 * tools surface their value fields in the HUD in-browser.
 */

test('Offset tool shows a Distance field in the parameters window', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();

  await page.keyboard.press('w'); // Offset
  await expect(page.getByTestId('numeric-hud')).toBeVisible();
  await expect(page.getByTestId('hud-field-distance')).toBeVisible();
});

test('Move and Stretch show ΔX/ΔY fields in the parameters window', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();

  await page.keyboard.press('v'); // Move
  await expect(page.getByTestId('hud-field-moveDx')).toBeVisible();
  await expect(page.getByTestId('hud-field-moveDy')).toBeVisible();

  await page.keyboard.press('e'); // Stretch
  await expect(page.getByTestId('hud-field-moveDx')).toBeVisible();
  await expect(page.getByTestId('hud-field-moveDy')).toBeVisible();
});
