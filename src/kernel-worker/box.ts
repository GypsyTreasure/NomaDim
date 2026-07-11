import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import { trackShapeAllocation, trackShapeDisposal } from './handleCounter';

/** M1 acceptance test fixture (MASTER_DOCUMENT §8): a hardcoded box, nothing
 * op-driven yet — the registry/BodyStateMap pipeline proper lands in M3. */
const HARDCODED_BOX_SIZE_MM = 40;

export function createHardcodedBox(oc: OpenCascadeInstance): TopoDS_Shape {
  const builder = new oc.BRepPrimAPI_MakeBox_2(
    HARDCODED_BOX_SIZE_MM,
    HARDCODED_BOX_SIZE_MM,
    HARDCODED_BOX_SIZE_MM
  );
  const shape = builder.Shape();
  builder.delete();
  trackShapeAllocation();
  return shape;
}

export function disposeShape(shape: TopoDS_Shape): void {
  shape.delete();
  trackShapeDisposal();
}
