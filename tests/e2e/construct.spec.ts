import { expect, test } from '@playwright/test';

/**
 * Construction geometry (ADR-0073), browser end-to-end: create a construction
 * plane from the Construct menu (via its G shortcut), then confirm it becomes
 * reusable — it shows in the browser tree's Construction section AND is offered
 * as a sketch base in the New Sketch plane picker. Proves the whole datum
 * pipeline (command → store → viewport/tree/picker) is wired in a real browser.
 */

test('create a construction plane → reusable in the tree and the plane picker', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'New Sketch' })).toBeVisible();

  // Create a construction plane from the Construct menu, accepting the
  // defaults (offset 10 mm off XY). The action cluster is shown inline on
  // desktop (the hamburger is mobile-only).
  await page.getByTestId('construct-plane').click();
  const dialog = page.getByRole('dialog', { name: 'Plane' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();

  // It appears in the browser tree's Construction section.
  await page.getByTestId('browser-toggle').click();
  await expect(page.getByTestId('tree-datum')).toHaveCount(1);

  // …and is offered as a sketch base in the plane picker.
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await expect(page.getByTestId('plane-choice-datums')).toBeVisible();
});
