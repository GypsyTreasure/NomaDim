import { expect, test } from '@playwright/test';

/**
 * SVG/DXF reference import (ADR-0076), browser end-to-end: open a sketch, feed
 * the hidden file input an SVG, and confirm the toast reports the imported
 * shapes. The input is populated via setInputFiles (no OS file picker), so this
 * exercises the real read → parse → construction-geometry pipeline.
 */

test('import an SVG into a sketch and see the confirmation toast', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();

  await expect(page.getByRole('button', { name: 'Finish Sketch' })).toBeVisible();

  const svg =
    '<svg viewBox="0 0 100 100">' +
    '<rect x="10" y="10" width="30" height="20" />' +
    '<circle cx="60" cy="60" r="15" />' +
    '</svg>';
  await page.getByTestId('sketch-import-input').setInputFiles({
    name: 'reference.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg, 'utf-8'),
  });

  // rect (1) + circle (1) = 2 imported reference shapes.
  const toast = page.getByTestId('toast');
  await expect(toast).toContainText('Imported reference shapes: 2');
});

test('import a DXF whose geometry is inside a block (INSERT)', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'New Sketch' }).click();
  await page.getByTestId('plane-choice-XY').click();
  await expect(page.getByRole('button', { name: 'Finish Sketch' })).toBeVisible();

  // A block "B" holding two lines, INSERTed once — the common real-world shape
  // (AutoCAD keeps geometry in blocks). The importer must resolve the INSERT.
  const dxf = [
    '0', 'SECTION', '2', 'BLOCKS',
    '0', 'BLOCK', '2', 'B', '10', '0', '20', '0',
    '0', 'LINE', '10', '0', '20', '0', '11', '10', '21', '0',
    '0', 'LINE', '10', '10', '20', '0', '11', '10', '21', '10',
    '0', 'ENDBLK',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'INSERT', '2', 'B', '10', '5', '20', '5',
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\n'); // prettier-ignore
  await page.getByTestId('sketch-import-input').setInputFiles({
    name: 'part.dxf',
    mimeType: 'image/vnd.dxf',
    buffer: Buffer.from(dxf, 'utf-8'),
  });

  await expect(page.getByTestId('toast')).toContainText('Imported reference shapes: 2');
});
