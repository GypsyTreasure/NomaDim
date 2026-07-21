import { expect, test } from '@playwright/test';

/**
 * Start-point fields (#4b): a shape's first anchor can be typed as exact X/Y
 * coordinates (mouse-selected via #4a) instead of clicked. A circle placed by
 * typed centre + diameter must commit as a closed profile.
 */

test('a circle placed by typed start coordinates + diameter commits', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();

  // Circle tool; type its centre via the Start X / Start Y fields, then Ø.
  await page.keyboard.press('c');
  await page.getByTestId('hud-field-startX').click();
  await page.keyboard.type('15');
  await page.getByTestId('hud-field-startY').click();
  await page.keyboard.type('0');
  await page.getByTestId('hud-field-diameter').click();
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(page.getByTestId('finish-summary')).toContainText('Profiles: 1');
});
