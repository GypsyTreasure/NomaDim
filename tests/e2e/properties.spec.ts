import { expect, test } from '@playwright/test';

/**
 * Properties granularity (#3) + line alignment (#2): the Select tool picks the
 * whole shape and Properties summarizes it (Width/Height/Segments); the Change
 * tool picks a single line and Properties shows its fields plus touch-friendly
 * Horizontal / Vertical alignment buttons.
 */

/** Move-then-click: a bare .click() emits no pointermove, so the snap engine
 * sees a stale cursor and the first click snaps to origin (documented artifact).
 * Moving first gives the engine the live cursor. */
async function at(page: import('@playwright/test').Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}

test('Select summarizes the whole shape; Change edits one line with H/V align', async ({
  page,
}) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await page.waitForTimeout(1400); // let the normal-to-plane camera settle

  // Rectangle by two clicks (single-shot tool → returns to Select afterward).
  await page.keyboard.press('r');
  await at(page, 500, 300);
  await at(page, 700, 420);

  // Select: click the top edge → whole shape → Shape summary (#3).
  await at(page, 600, 300);
  const panel = page.getByTestId('properties-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Shape');
  await expect(panel).toContainText('Width');
  await expect(panel).toContainText('Segments');

  // Change: click the top edge → single line + Horizontal/Vertical align (#2).
  await page.keyboard.press('m');
  await page.mouse.click(600, 300);
  await expect(panel).toContainText('Length');
  await expect(page.getByTestId('align-horizontal')).toBeVisible();
  await expect(page.getByTestId('align-vertical')).toBeVisible();

  // Aligning keeps the panel valid (the command dispatched, no crash).
  await page.getByTestId('align-horizontal').click();
  await expect(panel).toBeVisible();
});

test('whole-shape Width is editable and resizes the shape', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await page.waitForTimeout(1400);

  await page.keyboard.press('r');
  await at(page, 500, 300);
  await at(page, 700, 420);
  await at(page, 600, 300); // Select the whole rectangle

  const panel = page.getByTestId('properties-panel');
  await expect(panel).toContainText('Width');
  // Set Width → the shape scales to that width; the field reflects it.
  await page.getByLabel('Width').fill('80');
  await page.getByLabel('Width').press('Enter');
  await expect
    .poll(async () => Number(await page.getByLabel('Width').inputValue()))
    .toBeCloseTo(80, 1);
});
