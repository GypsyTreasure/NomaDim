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
const STEP_OUT_PATH = '/export.step';

/**
 * Minimal typed view of the STEP writer (not on the generated instance type) —
 * an `unknown` cast to a named shape, never `any` (same gap as ADR-0011).
 */
interface StepWriterApi {
  readonly STEPControl_Writer_1: new () => {
    Transfer(shape: TopoDS_Shape, mode: unknown, compound: boolean, progress: unknown): unknown;
    Write(file: string): unknown;
    delete(): void;
  };
  readonly STEPControl_StepModelType: { readonly STEPControl_AsIs: unknown };
}

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

/**
 * STEP export (roadmap P1): writes the given solids to a single STEP file and
 * returns its bytes as a fresh ArrayBuffer (Transferable). Multiple bodies are
 * combined into a compound first — STEP preserves them as separate solids. The
 * FS scratch file is removed.
 */
export function writeStepBytes(
  oc: OpenCascadeInstance,
  shapes: readonly TopoDS_Shape[]
): ArrayBuffer {
  const writerApi = oc as unknown as StepWriterApi;
  const writer = new writerApi.STEPControl_Writer_1();
  const asIs = writerApi.STEPControl_StepModelType.STEPControl_AsIs;
  const compound = new oc.TopoDS_Compound();
  const builder = new oc.BRep_Builder();
  builder.MakeCompound(compound);
  for (const shape of shapes) builder.Add(compound, shape);
  try {
    writer.Transfer(compound, asIs, true, new oc.Message_ProgressRange_1());
    writer.Write(STEP_OUT_PATH);
    const bytes = oc.FS.readFile(STEP_OUT_PATH);
    return bytes.slice().buffer;
  } finally {
    writer.delete();
    builder.delete();
    compound.delete();
    try {
      oc.FS.unlink(STEP_OUT_PATH);
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
