import { expect, test } from '@playwright/test';

/**
 * Sample projects (M12): the first-run "Load a sample" affordance and the
 * Samples gallery both load a built-in `.nomadim.xml` through the ordinary
 * document load path, producing a real body via full regen.
 */

test('the onboarding "Load a sample" builds a body', async ({ page }) => {
  await page.goto('/app/');

  await page.getByTestId('onboarding-load-sample').click();

  // The sample gallery opens; pick the tutorial project.
  await expect(page.getByTestId('sample-list')).toBeVisible();
  await page.getByTestId('sample-plate-with-hole').click();

  // Loading runs the full write path → regen → exactly one body.
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });
});

test('the Samples gallery loads a plate', async ({ page }) => {
  await page.goto('/app/');
  await page.getByTestId('onboarding-dismiss').click();

  await page.getByTestId('samples-open').click();
  await expect(page.getByTestId('sample-list')).toBeVisible();
  await page.getByTestId('sample-plate').click();

  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });
});
