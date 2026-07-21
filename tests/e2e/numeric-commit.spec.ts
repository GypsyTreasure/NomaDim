import { expect, test } from '@playwright/test';

/**
 * Committing typed HUD values (ADR-0054). The iOS `decimal` soft keypad has no
 * Return key, so a phone user could never apply typed values — the ✓ commit
 * button is the touch affordance for Enter. Both paths must drive geometry: a
 * closed 40mm square only forms if each segment used the typed length/angle.
 */

test('the HUD commit button applies typed values (no Enter key)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await page.keyboard.press('l');
  await expect(page.getByTestId('numeric-hud')).toBeVisible();

  const len = page.getByTestId('hud-field-length');
  const ang = page.getByTestId('hud-field-angleAbs');
  const commit = page.getByTestId('hud-commit');
  const seg = async (l: string, a: string): Promise<void> => {
    await len.click();
    await len.fill(l);
    await ang.click();
    await ang.fill(a);
    await commit.click(); // NOT Enter — the touch affordance
  };
  await seg('40', '0');
  await seg('40', '90');
  await seg('40', '180');
  await seg('40', '270');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(page.getByTestId('finish-summary')).toContainText('Profiles: 1');
  await expect(page.getByTestId('finish-summary')).toContainText('open: 0');
});
