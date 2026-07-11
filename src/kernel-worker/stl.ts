import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';

export interface StlExportOptions {
  format: 'binary' | 'ascii';
  linearDeflectionMm: number;
  angularDeflectionDeg: number;
}

const STL_SCRATCH_PATH = '/export.stl';

/** BRepMesh_IncrementalMesh at export-quality deflection + StlAPI.Write via
 * the Emscripten virtual FS, read back as a Transferable ArrayBuffer (F6). */
export function exportShapeToStl(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  options: StlExportOptions
): ArrayBuffer {
  const angularDeflectionRad = (options.angularDeflectionDeg * Math.PI) / 180;
  const mesh = new oc.BRepMesh_IncrementalMesh_2(
    shape,
    options.linearDeflectionMm,
    false,
    angularDeflectionRad,
    false
  );

  const wroteOk = oc.StlAPI.Write(shape, STL_SCRATCH_PATH, options.format === 'ascii');
  mesh.delete();
  if (!wroteOk) {
    throw new Error('STL export failed: StlAPI.Write returned false');
  }

  const bytes = oc.FS.readFile(STL_SCRATCH_PATH);
  oc.FS.unlink(STL_SCRATCH_PATH);

  // Uint8Array.slice() always allocates a fresh, right-sized ArrayBuffer
  // (never a view over FS's larger underlying allocation, never shared).
  return bytes.slice().buffer;
}
