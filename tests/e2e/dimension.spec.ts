import { expect, test } from '@playwright/test';

/**
 * Dim tool: adds associative reference dimensions (solver-free, ADR-0002)
 * between two picked pool points. Selectable by button and by its 'D'
 * shortcut, HUD-less (it annotates existing points rather than drawing), with
 * a kind chooser (defaulting to Auto H/V, AutoCAD-like), and catalogued in the shortcuts
 * overlay. The measure/label/render math is unit-tested in dimensions.spec and
 * the command flow in sketch-dimensions.spec.
 */

test('the Dim tool is selectable, offers a kind chooser, is HUD-less and catalogued', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();

  // Select the Dim tool by its shortcut; its button reads active…
  await page.keyboard.press('d');
  await expect(page.getByRole('button', { name: 'Dimension' })).toHaveClass(/buttonActive/);
  // …the numeric HUD hides (it annotates existing points, not new geometry)…
  await expect(page.getByTestId('numeric-hud')).toBeHidden();

  // …and a kind chooser appears, defaulting to Auto (H/V) like AutoCAD, with
  // Parallel/Radius/Diameter/Angle available to override.
  const chooser = page.getByLabel('Dimension type');
  await expect(chooser).toBeVisible();
  await expect(chooser).toHaveValue('auto');
  await expect(chooser.locator('option')).toHaveText([
    'Auto (H/V)',
    'Parallel',
    'Horizontal',
    'Vertical',
    'Radius',
    'Diameter',
    'Angle',
  ]);
  await chooser.selectOption('radius');
  await expect(chooser).toHaveValue('radius');

  // It's documented in the shortcuts overlay.
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts-overlay')).toContainText('Dimension tool');
});
