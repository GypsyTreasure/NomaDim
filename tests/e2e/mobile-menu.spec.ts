import { expect, test } from '@playwright/test';

/**
 * App bar (ADR-0044/0045): New Sketch is always visible (primary action); the
 * rest of the actions collapse behind a hamburger on phone-width screens. The
 * menu closes on an outside tap — but NOT when an item opens a decision dialog
 * (e.g. New Project), so the choice can be made with the menu still open.
 */

test('phone: New Sketch stays visible; the rest collapse behind a hamburger', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/');

  // New Sketch is always reachable; the hamburger holds the rest.
  await expect(page.getByRole('button', { name: 'New Sketch' })).toBeVisible();
  await expect(page.getByTestId('app-menu-toggle')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeHidden();

  // Open the menu → the rest become reachable.
  await page.getByTestId('app-menu-toggle').click();
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export STL' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Shortcuts' })).toBeVisible();

  // Tapping outside (the canvas) closes the menu.
  await page.mouse.click(195, 600);
  await expect(page.getByRole('button', { name: 'Save' })).toBeHidden();
});

test('phone: opening New Project from the menu keeps the menu open for the decision', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/');

  // Build a body so New Project is enabled.
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await page.keyboard.press('c');
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.getByRole('dialog', { name: 'Extrude' }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });

  // Open the menu and start New Project — the confirm dialog appears and the
  // menu does not roll up (the decision buttons stay reachable).
  await page.getByTestId('app-menu-toggle').click();
  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('new-project-dialog')).toBeVisible();
  await expect(page.getByTestId('app-actions')).toBeVisible();
  await expect(page.getByTestId('new-project-discard')).toBeVisible();
  await ctx.close();
});

test('desktop: the hamburger is hidden and actions show inline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('app-menu-toggle')).toBeHidden();
  await expect(page.getByRole('button', { name: 'New Sketch' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Shortcuts' })).toBeVisible();
});
