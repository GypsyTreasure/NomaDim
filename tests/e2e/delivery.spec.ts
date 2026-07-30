import { expect, test } from '@playwright/test';

/**
 * M8 delivery: the kernel boots from the gzipped `.gzc` payload (decompressed
 * in-browser) and is never downloaded as the raw 50 MB `.wasm`; a service
 * worker registers so repeat/offline visits are instant. Runs against the
 * production `preview` build (SW + gzc only exist in a real build).
 */

test('boots the kernel from the gzipped .gzc payload, never the raw .wasm', async ({ page }) => {
  const wasmFetches: string[] = [];
  page.on('response', (r) => {
    const url = r.url();
    if (url.includes('opencascade.full.wasm'))
      wasmFetches.push(url.endsWith('.gzc') ? 'gzc' : 'raw');
  });

  await page.goto('/app/');
  // The loading bar clears once the kernel is ready (initial regen done).
  await expect(page.getByTestId('kernel-loading')).toBeHidden({ timeout: 60_000 });

  expect(wasmFetches).toContain('gzc');
  expect(wasmFetches).not.toContain('raw');
});

test('registers a service worker and links a web manifest', async ({ page }) => {
  await page.goto('/app/');

  const active = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    return reg.active !== null;
  });
  expect(active).toBe(true);

  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  expect(manifestHref).toContain('manifest.webmanifest');
  const res = await page.request.get(manifestHref ?? '');
  expect(res.ok()).toBe(true);
});
