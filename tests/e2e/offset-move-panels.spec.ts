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
 * Offset multi/loop + typed Move/Stretch dialogs (#2/#3, ADR-0132). The Offset
 * tool exposes a Distance + Side panel; Move/Stretch expose a ΔX/ΔY panel. Both
 * take exact keyboard values (AutoCAD parity). Geometry is unit-tested; this
 * checks the tools are selectable and surface their value dialogs in-browser.
 */

test('Offset tool shows a distance + side panel', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();

  await page.keyboard.press('w'); // Offset
  // The panel only renders while the Offset tool is active, so its visibility
  // confirms the tool is selected.
  await expect(page.getByTestId('offset-panel')).toBeVisible();
  await expect(page.getByTestId('offset-distance')).toBeVisible();
  await expect(page.getByTestId('offset-side')).toBeVisible();
  // Apply is disabled until geometry is selected.
  await expect(page.getByTestId('offset-apply')).toBeDisabled();
});

test('Move and Stretch tools show a ΔX/ΔY panel', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();

  await page.keyboard.press('v'); // Move
  await expect(page.getByTestId('move-panel')).toBeVisible();
  await expect(page.getByTestId('move-dx')).toBeVisible();
  await expect(page.getByTestId('move-dy')).toBeVisible();
  // No point set captured yet → Apply disabled.
  await expect(page.getByTestId('move-apply')).toBeDisabled();

  await page.keyboard.press('e'); // Stretch
  await expect(page.getByTestId('move-panel')).toBeVisible();
  await expect(page.getByTestId('move-apply')).toBeDisabled();
});
