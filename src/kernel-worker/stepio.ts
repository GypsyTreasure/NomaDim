import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import { healInvalidSolid } from './healShape';

/**
 * STEP import (roadmap P1). A STEP file is parsed to a solid, then serialized to
 * OCCT's BREP text and base64-encoded so the Import op can embed it directly in
 * the document — the model round-trips through save/load with no external file
 * (the shape is reconstructed at regen by `brepBase64ToShape`). BREP is ASCII,
 * so `btoa`/`atob` (available in the worker and in Node) suffice.
 */

const STEP_PATH = '/import.step';
const BREP_PATH = '/import.brep';

/** Parse STEP bytes → the imported solid as a base64 BREP payload. Throws on a
 * malformed/empty file. All OCCT temporaries + FS files are cleaned up. */
export function readStepToBrepBase64(oc: OpenCascadeInstance, bytes: ArrayBuffer): string {
  oc.FS.writeFile(STEP_PATH, new Uint8Array(bytes));
  const reader = new oc.STEPControl_Reader_1();
  try {
    reader.ReadFile(STEP_PATH);
    reader.TransferRoots(new oc.Message_ProgressRange_1());
    const shape = reader.OneShape();
    if (shape.IsNull()) {
      shape.delete();
      throw new Error('STEP file contains no shape');
    }
    const healed = healInvalidSolid(oc, shape); // deletes `shape` if it repairs
    oc.BRepTools.Write_3(healed, BREP_PATH, new oc.Message_ProgressRange_1());
    healed.delete();
    const brep = oc.FS.readFile(BREP_PATH, { encoding: 'utf8' });
    oc.FS.unlink(BREP_PATH);
    return btoa(brep);
  } finally {
    reader.delete();
    try {
      oc.FS.unlink(STEP_PATH);
    } catch {
      /* already gone */
    }
  }
}

/** Reconstruct the imported solid from its base64 BREP payload (regen path). */
export function brepBase64ToShape(oc: OpenCascadeInstance, brepBase64: string): TopoDS_Shape {
  oc.FS.writeFile(BREP_PATH, atob(brepBase64));
  const shape = new oc.TopoDS_Shape();
  const builder = new oc.BRep_Builder();
  try {
    oc.BRepTools.Read_2(shape, BREP_PATH, builder, new oc.Message_ProgressRange_1());
    return shape;
  } finally {
    builder.delete();
    try {
      oc.FS.unlink(BREP_PATH);
    } catch {
      /* already gone */
    }
  }
}
