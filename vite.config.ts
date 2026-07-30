import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Base path is intentionally NOT hardcoded here. The GitHub Actions deploy
// workflow passes --base=/${{ github.event.repository.name }}/ at build time;
// local dev and `vite preview` fall back to Vite's default '/'. Runtime code
// must read the base via import.meta.env.BASE_URL, never a literal.

/**
 * Emits a build-time gzip of the OCCT WASM (M8): the app fetches the `.wasm.gzc`
 * and gunzips it natively in the browser, cutting the wire cost ~50 MB → ~13 MB
 * without relying on GitHub Pages to negotiate compression (it won't for large
 * `.wasm`). The plain `.wasm` is kept as a fallback for the worker's own fetch.
 *
 * The neutral `.gzc` extension (not `.gz`) is deliberate: static servers such
 * as `vite preview`/sirv apply "gzip-static" to a real `.gz` — they add
 * `Content-Encoding: gzip`, so the browser transparently inflates and the
 * declared (compressed) Content-Length then mismatches the inflated body and
 * the fetch aborts. `.gzc` is served as opaque bytes everywhere, so we control
 * decompression ourselves and local `preview` matches GitHub Pages.
 */
function gzipWasm(): Plugin {
  return {
    name: 'nomadim-gzip-wasm',
    apply: 'build',
    closeBundle() {
      const wasm = resolve('dist/wasm/opencascade.full.wasm');
      if (!existsSync(wasm)) return;
      const gz = gzipSync(readFileSync(wasm), { level: 9 });
      writeFileSync(`${wasm}.gzc`, gz);
      const mb = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`;
      this.info(`${mb(statSync(wasm).size)} → ${mb(gz.length)} (.wasm.gzc)`);
    },
  };
}

export default defineConfig({
  plugins: [react(), gzipWasm()],
  build: {
    // Multi-page (M10): the marketing landing at `/` (index.html) and the CAD
    // app at `/app/` (app/index.html). The landing loads zero WASM/app code.
    rollupOptions: {
      input: {
        landing: resolve('index.html'),
        app: resolve('app/index.html'),
      },
    },
  },
});
