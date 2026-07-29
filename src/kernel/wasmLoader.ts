/**
 * Main-thread OCCT WASM delivery (M8, ADR-pending). The kernel is ~50 MB
 * uncompressed; we ship a build-time gzipped `.wasm.gz` and decompress it in
 * the browser with the native `DecompressionStream` (no extra deps, GitHub
 * Pages serves the `.gz` verbatim without transparent re-inflation). Fetching
 * on the main thread lets us stream real download progress to the loading bar,
 * then the decompressed bytes are handed to the worker as a Transferable so
 * emscripten instantiates from memory instead of fetching the raw 50 MB again.
 *
 * Every failure path returns `null` — the worker then falls back to its own
 * `locateFile` fetch of the plain `.wasm`, so an old browser or a missing
 * `.gz` degrades to "works, just larger", never "broken".
 */

export interface WasmLoadProgress {
  /** Compressed bytes downloaded so far. */
  readonly loaded: number;
  /** Total compressed bytes (0 if the server sent no Content-Length). */
  readonly total: number;
  /** 0..1 download fraction (0 when total is unknown). */
  readonly ratio: number;
}

/** Concatenates the streamed chunks into one contiguous ArrayBuffer. */
function concat(chunks: readonly Uint8Array[], length: number): ArrayBuffer {
  const buffer = new ArrayBuffer(length);
  const out = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer;
}

/**
 * Downloads and gunzips the OCCT WASM, reporting download progress. Returns the
 * decompressed WASM bytes, or `null` to signal "fall back to the worker's own
 * fetch" (no `.gz` on the host, no `DecompressionStream`, or any fetch error).
 */
export async function loadOcctWasmBinary(
  baseUrl: string,
  onProgress?: (progress: WasmLoadProgress) => void
): Promise<ArrayBuffer | null> {
  if (typeof DecompressionStream === 'undefined' || typeof fetch === 'undefined') return null;
  // `.gzc`, not `.gz`: avoids static servers' "gzip-static" auto Content-Encoding
  // (which breaks manual decompression). See the vite gzip plugin for detail.
  const gzUrl = `${baseUrl}wasm/opencascade.full.wasm.gzc`;
  try {
    const response = await fetch(gzUrl);
    if (!response.ok || !response.body) return null;
    const total = Number(response.headers.get('content-length') ?? 0);

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress?.({ loaded, total, ratio: total > 0 ? loaded / total : 0 });
    }
    onProgress?.({ loaded, total: total || loaded, ratio: 1 });

    const gzipped = concat(chunks, loaded);
    const stream = new Blob([gzipped]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).arrayBuffer();
  } catch {
    return null;
  }
}
