import { expect, test, type Page } from '@playwright/test';

/**
 * M2 acceptance (MASTER_DOCUMENT §8): a bracket sketch drawn to exact
 * dimensions via keyboard only, and a plate-with-hole detected as one
 * profile with an inner loop. The finish summary counting closed profiles
 * IS the topology proof: loop detection only closes when the keyboard-drawn
 * segments share pool points (endpoint merge), so "Profiles: 1, open: 0"
 * cannot appear otherwise.
 */

async function typeSegment(page: Page, length: string, angleDeg: string): Promise<void> {
  await page.keyboard.type(length);
  await page.keyboard.press('Tab');
  await page.keyboard.type(angleDeg);
  await page.keyboard.press('Enter');
}

test('bracket drawn to exact dimensions via keyboard only', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await expect(page.getByTestId('numeric-hud')).toBeVisible();

  // L-bracket outline, 60x40 with a 40x20 step, closing exactly at the origin.
  await typeSegment(page, '60', '0');
  await typeSegment(page, '20', '90');
  await typeSegment(page, '40', '180');
  await typeSegment(page, '20', '90');
  await typeSegment(page, '20', '180');
  await typeSegment(page, '40', '270');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(page.getByTestId('finish-summary')).toContainText('Profiles: 1');
  await expect(page.getByTestId('finish-summary')).toContainText('open: 0');
});

test('plate with hole: hexagon plate + circular cutout = profile with inner loop', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await expect(page.getByTestId('numeric-hud')).toBeVisible();

  // Polygon tool (G): 6 sides inscribed in Ø50, centered on the origin.
  await page.keyboard.press('g');
  await expect(page.getByTestId('hud-field-sides')).toBeVisible();
  await page.keyboard.type('6');
  await page.keyboard.press('Tab');
  await page.keyboard.type('50');
  await page.keyboard.press('Enter');

  // Circle tool (C): Ø20 at the origin — a hole inside the plate.
  await page.keyboard.press('c');
  await expect(page.getByTestId('hud-field-diameter')).toBeVisible();
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  // Ring profile (with the hole) + the disk itself, Fusion-like.
  await expect(page.getByTestId('finish-summary')).toContainText('Profiles: 2');
  await expect(page.getByTestId('finish-summary')).toContainText('with holes: 1');
  await expect(page.getByTestId('finish-summary')).toContainText('open: 0');
});
