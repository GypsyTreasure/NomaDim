import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';

/**
 * Booleans, fillets and chamfers occasionally emit a solid with a slightly
 * invalid face (a bad pcurve / wire) that `BRepMesh_IncrementalMesh` then
 * silently fails to triangulate. The face drops out of the mesh, leaving a hole
 * in BOTH the viewport render (a see-through "fake wall") AND the exported STL
 * (a non-manifold, unprintable part). `BRepCheck_Analyzer` flags the shape
 * invalid; `ShapeFix_Shape` repairs the offending face so it meshes.
 *
 * Valid shapes are returned untouched — no repair cost, no geometry change — so
 * this stays off the common path. When a repair happens the ORIGINAL shape is
 * `.delete()`d and the fixed one returned; the caller must `trackShapeAllocation`
 * exactly once for the returned shape (R8), same as before. If the repair yields
 * nothing usable, the original is kept (a hole beats a crash).
 */
export function healInvalidSolid(oc: OpenCascadeInstance, shape: TopoDS_Shape): TopoDS_Shape {
  const analyzer = new oc.BRepCheck_Analyzer(shape, true, false);
  const valid = analyzer.IsValid_2();
  analyzer.delete();
  if (valid) return shape;

  const fixer = new oc.ShapeFix_Shape_2(shape);
  const progress = new oc.Message_ProgressRange_1();
  fixer.Perform(progress);
  const fixed = fixer.Shape();
  fixer.delete();
  progress.delete();
  if (fixed.IsNull()) {
    fixed.delete();
    return shape; // repair produced nothing usable — keep the original
  }
  shape.delete(); // caller had not yet tracked `shape`; free the WASM handle now
  return fixed;
}
