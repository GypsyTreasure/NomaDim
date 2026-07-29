import type { OpenCascadeInstance } from 'opencascade.js';

/**
 * Loads the OCCT WASM module from static assets in `public/wasm/` (never
 * from `node_modules` at runtime) — CLAUDE.md deployment: "WASM in
 * public/wasm/". Runtime paths go through `import.meta.env.BASE_URL` so the
 * GitHub Pages base path (derived from the repo name at build time) is
 * never hardcoded here. See ADR-0011 for why the published untrimmed
 * opencascade.js binary stands in for the custom trimmed build in M1.
 */

type LocateFile = (path: string) => string;
type OcctFactory = (options: {
  locateFile: LocateFile;
  wasmBinary?: ArrayBuffer;
}) => Promise<OpenCascadeInstance>;

let occtInstancePromise: Promise<OpenCascadeInstance> | null = null;

/**
 * Instantiates OCCT. When `wasmBinary` is supplied (M8: the main thread
 * pre-fetched + gunzipped it and transferred the bytes here), emscripten
 * instantiates from memory and never fetches the 50 MB `.wasm`. Otherwise it
 * falls back to fetching the plain `.wasm` via `locateFile`.
 */
export function loadOcct(wasmBinary?: ArrayBuffer): Promise<OpenCascadeInstance> {
  occtInstancePromise ??= initialize(wasmBinary);
  return occtInstancePromise;
}

async function initialize(wasmBinary?: ArrayBuffer): Promise<OpenCascadeInstance> {
  const wasmDir = `${import.meta.env.BASE_URL}wasm/`;
  const glueUrl = `${wasmDir}opencascade.full.js`;
  // Prefer the pre-fetched + decompressed bytes (M8): expose them as an
  // in-memory blob: URL so emscripten "fetches" from memory and never pulls the
  // raw 50 MB `.wasm` over the network (emscripten does not reliably honour the
  // `wasmBinary` option here — it still calls locateFile). Fall back to the
  // static `.wasm` when no binary was supplied.
  const wasmUrl = wasmBinary
    ? URL.createObjectURL(new Blob([wasmBinary], { type: 'application/wasm' }))
    : `${wasmDir}opencascade.full.wasm`;

  const imported = (await import(/* @vite-ignore */ glueUrl)) as unknown as {
    default: OcctFactory;
  };

  const instance = await imported.default({
    ...(wasmBinary ? { wasmBinary } : {}),
    locateFile(path) {
      return path.endsWith('.wasm') ? wasmUrl : path;
    },
  });
  if (wasmBinary) URL.revokeObjectURL(wasmUrl);
  return instance;
}
