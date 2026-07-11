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
type OcctFactory = (options: { locateFile: LocateFile }) => Promise<OpenCascadeInstance>;

let occtInstancePromise: Promise<OpenCascadeInstance> | null = null;

export function loadOcct(): Promise<OpenCascadeInstance> {
  occtInstancePromise ??= initialize();
  return occtInstancePromise;
}

async function initialize(): Promise<OpenCascadeInstance> {
  const wasmDir = `${import.meta.env.BASE_URL}wasm/`;
  const glueUrl = `${wasmDir}opencascade.full.js`;
  const wasmUrl = `${wasmDir}opencascade.full.wasm`;

  const imported = (await import(/* @vite-ignore */ glueUrl)) as unknown as {
    default: OcctFactory;
  };

  return imported.default({
    locateFile(path) {
      return path.endsWith('.wasm') ? wasmUrl : path;
    },
  });
}
