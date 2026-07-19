import { expect, test } from '@playwright/test';

/**
 * Autosave / restore: the document is mirrored into localStorage on every
 * change and restored on load, so a page refresh resumes the project instead of
 * dropping to a blank state (the reported bug — especially annoying on mobile
 * where the browser can silently discard a backgrounded tab). The whole-document
 * codec + load→regen path is shared with File → Open (save-load.spec).
 */

test('the project survives a page reload (autosave restores it)', async ({ page }) => {
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

  // Refresh: the body comes back on its own — no manual Open, no blank project.
  // Body count > 0 after reload proves the restored timeline actually regenerated
  // (bodies exist only as regen output), not merely that data was stored.
  await page.reload();
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 30_000 });
});

test('a returning sketch (no feature yet) is restored too', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await expect(page.getByTestId('numeric-hud')).toBeVisible();
  await page.keyboard.press('c');
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  // Back in the browser, open the tree — the sketch is listed; after a reload
  // it is still there (the document persisted even without a downstream feature).
  await page.getByTestId('browser-toggle').click();
  await expect(page.getByTestId('tree-sketch')).toContainText('Sketch1');
  await page.reload();
  await page.getByTestId('browser-toggle').click();
  await expect(page.getByTestId('tree-sketch')).toContainText('Sketch1', { timeout: 30_000 });
});
