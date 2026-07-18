import { expect, test, type Page } from '@playwright/test';

/**
 * New Project (F7): clears the current model AND its autosaved copy, guarded by
 * an export prompt so work isn't lost silently. Disabled when the document is
 * already empty; Discard clears without export; Export downloads the
 * `.nomadim.xml` first. The cleared state must survive a reload (autosave was
 * erased, not re-mirrored).
 */

async function buildBody(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await expect(page.getByTestId('numeric-hud')).toBeVisible();
  await page.keyboard.press('c');
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.getByRole('dialog', { name: 'Extrude' }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });
}

test('New Project (Discard) clears the model and the clearance survives reload', async ({
  page,
}) => {
  await page.goto('/');

  // Nothing to clear yet → the button is disabled.
  await expect(page.getByTestId('new-project')).toBeDisabled();

  await buildBody(page);

  // Now enabled: clicking asks about export before discarding.
  await expect(page.getByTestId('new-project')).toBeEnabled();
  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('new-project-dialog')).toBeVisible();
  await page.getByTestId('new-project-discard').click();

  // Model cleared…
  await expect(page.getByTestId('new-project-dialog')).toBeHidden();
  await expect(page.getByTestId('body-count')).toHaveText('0', { timeout: 30_000 });

  // …and it stays cleared across a reload (autosave was erased, not restored).
  await page.reload();
  await expect(page.getByTestId('body-count')).toHaveText('0', { timeout: 30_000 });
  await expect(page.getByTestId('new-project')).toBeDisabled();
});

test('New Project (Export) downloads the model before clearing', async ({ page }) => {
  await page.goto('/');
  await buildBody(page);

  await page.getByTestId('new-project').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('new-project-export').click(),
  ]);
  expect(download.suggestedFilename()).toContain('.nomadim.xml');
  await expect(page.getByTestId('body-count')).toHaveText('0', { timeout: 30_000 });
});

test('New Project can be cancelled, leaving the model intact', async ({ page }) => {
  await page.goto('/');
  await buildBody(page);

  await page.getByTestId('new-project').click();
  await page.getByTestId('new-project-cancel').click();
  await expect(page.getByTestId('new-project-dialog')).toBeHidden();
  await expect(page.getByTestId('body-count')).toHaveText('1');
});
