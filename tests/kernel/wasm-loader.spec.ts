import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadOcctWasmBinary } from '../../src/kernel/wasmLoader';

/**
 * M8 WASM delivery: the loader streams a gzipped `.gzc`, reports download
 * progress, and gunzips it natively. It must degrade to `null` (→ the worker's
 * own fetch) on any failure. Node 22 provides fetch/Blob/DecompressionStream.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** A Response whose body streams `bytes` in two chunks, with a Content-Length. */
function streamedResponse(bytes: Uint8Array): Response {
  const mid = Math.floor(bytes.length / 2);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, mid));
      controller.enqueue(bytes.slice(mid));
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-length': String(bytes.length) } });
}

describe('loadOcctWasmBinary', () => {
  it('downloads, reports progress, and gunzips the payload', async () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const gz = new Uint8Array(gzipSync(Buffer.from(original)));
    globalThis.fetch = vi.fn().mockResolvedValue(streamedResponse(gz));

    const ratios: number[] = [];
    const result = await loadOcctWasmBinary('/', (p) => ratios.push(p.ratio));

    expect(result).not.toBeNull();
    expect(new Uint8Array(result ?? new ArrayBuffer(0))).toEqual(original);
    // Progress ends at 1 and is monotonic.
    expect(ratios.at(-1)).toBe(1);
    expect(ratios).toEqual([...ratios].sort((a, b) => a - b));
  });

  it('requests the neutral .gzc extension (not .gz, which servers gzip-static)', async () => {
    const gz = new Uint8Array(gzipSync(Buffer.from([0])));
    const fetchMock = vi.fn().mockResolvedValue(streamedResponse(gz));
    globalThis.fetch = fetchMock;
    await loadOcctWasmBinary('/base/');
    expect(fetchMock).toHaveBeenCalledWith('/base/wasm/opencascade.full.wasm.gzc');
  });

  it('returns null when the fetch fails (→ worker fallback)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    expect(await loadOcctWasmBinary('/')).toBeNull();
  });

  it('returns null when the fetch rejects', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await loadOcctWasmBinary('/')).toBeNull();
  });
});
