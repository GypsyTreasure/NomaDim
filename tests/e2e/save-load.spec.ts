import { expect, test } from '@playwright/test';

/**
 * Save / Load .nomadim.xml (M6, F7): build a body, save the document, reload
 * the app to a blank state, then open the saved file — the timeline replays
 * and the body comes back. Proves the whole document codec + load→regen path.
 */

test('save a document, reload, and open it back', async ({ page }) => {
  await page.goto('/');

  // Build one body.
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await expect(page.getByTestId('numeric-hud')).toBeVisible();
  await page.keyboard.press('c');
  await expect(page.getByTestId('hud-field-diameter')).toBeVisible();
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.getByRole('dialog', { name: 'Extrude' }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });

  // Save → capture the downloaded .nomadim.xml.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('doc-save').click(),
  ]);
  const savedPath = await download.path();

  // Reload to a blank document (no bodies).
  await page.reload();
  await expect(page.getByTestId('body-count')).toHaveText('0', { timeout: 30_000 });

  // Open the saved file → the timeline replays and the body returns.
  await page.getByTestId('doc-file-input').setInputFiles(savedPath);
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });
});
