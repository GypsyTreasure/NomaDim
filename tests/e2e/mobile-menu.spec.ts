import { expect, test } from '@playwright/test';

/**
 * Restyle (ADR-0044): on phone-width screens the app-action cluster collapses
 * behind a hamburger so the top of the canvas isn't a cramped button row;
 * every action stays reachable once opened. On desktop the hamburger is hidden
 * and the actions show inline.
 */

test('phone: app actions collapse behind a hamburger and open on tap', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/');

  // Collapsed by default: the hamburger shows, the actions are hidden.
  await expect(page.getByTestId('app-menu-toggle')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Sketch' })).toBeHidden();

  // Tap opens the menu; every action becomes reachable.
  await page.getByTestId('app-menu-toggle').click();
  await expect(page.getByRole('button', { name: 'New Sketch' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export STL' })).toBeVisible();

  // Choosing an action also closes the menu (it starts the New Sketch flow).
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await expect(page.getByTestId('plane-picker')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeHidden();
  await ctx.close();
});

test('desktop: the hamburger is hidden and actions show inline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('app-menu-toggle')).toBeHidden();
  await expect(page.getByRole('button', { name: 'New Sketch' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Shortcuts' })).toBeVisible();
});
