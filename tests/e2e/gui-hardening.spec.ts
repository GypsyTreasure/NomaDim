import { expect, test } from '@playwright/test';

/**
 * M9 GUI hardening: no action button renders enabled with an unmet precondition,
 * and tooltips are descriptive ("Label (Shortcut)"), not a bare shortcut char.
 */

test('op buttons are disabled with an explanatory tooltip when preconditions are unmet', async ({
  page,
}) => {
  await page.goto('/app/');
  await expect(page.getByRole('button', { name: 'New Sketch' })).toBeVisible();

  // Empty document: no sketch, no body.
  const fillet = page.getByRole('button', { name: 'Fillet', exact: true });
  await expect(fillet).toBeDisabled();
  await expect(fillet).toHaveAttribute('title', 'Create a body first');

  const combine = page.getByRole('button', { name: 'Combine', exact: true });
  await expect(combine).toBeDisabled();
  await expect(combine).toHaveAttribute('title', 'Needs two or more bodies');

  const extrude = page.getByRole('button', { name: 'Extrude', exact: true });
  await expect(extrude).toBeDisabled();
  await expect(extrude).toHaveAttribute('title', 'Create a sketch first');
});

test('enabled buttons carry a descriptive "Label (Shortcut)" tooltip', async ({ page }) => {
  await page.goto('/app/');
  const newSketch = page.getByRole('button', { name: 'New Sketch' });
  await expect(newSketch).toBeVisible();
  await expect(newSketch).toHaveAttribute('title', 'New Sketch (N)');
});
