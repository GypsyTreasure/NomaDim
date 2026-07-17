import { expect, test } from '@playwright/test';

/**
 * Save / Load .nomadim.xml (M6, F7): build a body, save the document, then open
 * the saved file in a FRESH browser context (empty autosave storage → blank) —
 * the timeline replays and the body comes back. Proves the whole document codec
 * + load→regen path. (A same-context reload would now restore via autosave, so
 * the file-open path is verified in a clean context instead — see
 * persistence.spec for the reload-restore behavior.)
 */

test('save a document, then open it back in a fresh session', async ({ page, browser }) => {
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

  // A brand-new session starts blank (no autosaved document)…
  const ctx = await browser.newContext();
  const fresh = await ctx.newPage();
  await fresh.goto('/');
  await expect(fresh.getByTestId('body-count')).toHaveText('0', { timeout: 30_000 });

  // …and opening the saved file replays the timeline, bringing the body back.
  await fresh.getByTestId('doc-file-input').setInputFiles(savedPath);
  await expect(fresh.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });
  await ctx.close();
});
