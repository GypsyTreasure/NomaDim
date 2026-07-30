import { expect, test } from '@playwright/test';

/**
 * Post-M12 personalization surfaces: the header logo links home, the project can
 * be named, and the Admin/Settings panel opens with live preferences. (The
 * export filename that consumes the project name is unit-tested in
 * tests/app/export-name.spec.ts.)
 */

test('the header logo links to the landing page', async ({ page }) => {
  await page.goto('/app/');
  const logoLink = page.locator('a[title="NomaDim home"]');
  await expect(logoLink).toBeVisible();
  await expect(logoLink).toHaveAttribute('href', /\/$/);
});

test('the project can be named in the header', async ({ page }) => {
  await page.goto('/app/');
  const field = page.getByTestId('project-name');
  await expect(field).toBeVisible();
  await field.fill('My Widget');
  await field.blur();
  // Survives a reload via autosave (the name is document state).
  await page.reload();
  await expect(page.getByTestId('project-name')).toHaveValue('My Widget');
});

test('the Settings panel opens and lists preferences', async ({ page }) => {
  await page.goto('/app/');
  await page.getByTestId('admin-open').click();
  await expect(page.getByTestId('admin-overlay')).toBeVisible();
  await expect(page.getByTestId('admin-stl-format')).toBeVisible();
  await expect(page.getByTestId('admin-ttl')).toBeVisible();
  await expect(page.getByTestId('admin-name-preview')).toContainText('.stl');
  await page.getByTestId('admin-close').click();
  await expect(page.getByTestId('admin-overlay')).toBeHidden();
});
