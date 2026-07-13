import type {
  BRepBuilderAPI_MakeWire,
  OpenCascadeInstance,
  TopoDS_Face,
  TopoDS_Wire,
  gp_Dir,
  gp_Pnt,
} from 'opencascade.js';
import type { Vec2 } from '../core';
import { ProfileError } from '../core';
import type { LoopGeometry, LoopSegment } from '../document';
import type { PlanePlacement, PlanProfile } from '../kernel/protocol';

/**
 * PlanProfile → planar TopoDS_Face with holes (ARCHITECTURE R7, CLAUDE.md
 * OCCT recipe): outer wire → ShapeFix_Wire → MakeFace, then inner wires
 * added reversed as holes. Profiles arrive pre-resolved from the main
 * thread; open or unbuildable wires raise ProfileError with entity context
 * upstream (the executor maps it to the op's error state).
 */

type V3 = readonly [number, number, number];

function crossV3(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Plane normal = xAxis × yAxis (plan axes are unit + orthogonal by construction). */
export function planeNormal(plane: PlanePlacement): V3 {
  return crossV3(plane.xAxis, plane.yAxis);
}

function to3d(oc: OpenCascadeInstance, plane: PlanePlacement, p: Vec2): gp_Pnt {
  return new oc.gp_Pnt_3(
    plane.origin[0] + plane.xAxis[0] * p.x + plane.yAxis[0] * p.y,
    plane.origin[1] + plane.xAxis[1] * p.x + plane.yAxis[1] * p.y,
    plane.origin[2] + plane.xAxis[2] * p.x + plane.yAxis[2] * p.y
  );
}

function normalDir(oc: OpenCascadeInstance, plane: PlanePlacement, flip: boolean): gp_Dir {
  const n = planeNormal(plane);
  const s = flip ? -1 : 1;
  return new oc.gp_Dir_4(n[0] * s, n[1] * s, n[2] * s);
}

/** Builds one edge; every temporary gp_* object is freed here. */
function addSegmentEdge(
  oc: OpenCascadeInstance,
  wireMaker: BRepBuilderAPI_MakeWire,
  plane: PlanePlacement,
  segment: LoopSegment
): void {
  switch (segment.kind) {
    case 'line': {
      const a = to3d(oc, plane, segment.a);
      const b = to3d(oc, plane, segment.b);
      const maker = new oc.BRepBuilderAPI_MakeEdge_3(a, b);
      const edge = maker.Edge();
      wireMaker.Add_1(edge);
      edge.delete();
      maker.delete();
      a.delete();
      b.delete();
      return;
    }
    case 'arc': {
      // A circle whose axis is +normal for CCW travel (−normal for CW)
      // traverses a→b along its positive orientation, so MakeEdge(circ, a, b)
      // yields exactly the requested arc.
      const center = to3d(oc, plane, segment.center);
      const axisDir = normalDir(oc, plane, !segment.ccw);
      const xDir = new oc.gp_Dir_4(plane.xAxis[0], plane.xAxis[1], plane.xAxis[2]);
      const ax2 = new oc.gp_Ax2_2(center, axisDir, xDir);
      const r = Math.hypot(segment.a.x - segment.center.x, segment.a.y - segment.center.y);
      const circ = new oc.gp_Circ_2(ax2, r);
      const a = to3d(oc, plane, segment.a);
      const b = to3d(oc, plane, segment.b);
      const maker = new oc.BRepBuilderAPI_MakeEdge_10(circ, a, b);
      const edge = maker.Edge();
      wireMaker.Add_1(edge);
      edge.delete();
      maker.delete();
      circ.delete();
      ax2.delete();
      xDir.delete();
      axisDir.delete();
      center.delete();
      a.delete();
      b.delete();
      return;
    }
    case 'circle': {
      const center = to3d(oc, plane, segment.center);
      const axisDir = normalDir(oc, plane, false);
      const xDir = new oc.gp_Dir_4(plane.xAxis[0], plane.xAxis[1], plane.xAxis[2]);
      const ax2 = new oc.gp_Ax2_2(center, axisDir, xDir);
      const circ = new oc.gp_Circ_2(ax2, segment.r);
      const maker = new oc.BRepBuilderAPI_MakeEdge_8(circ);
      const edge = maker.Edge();
      wireMaker.Add_1(edge);
      edge.delete();
      maker.delete();
      circ.delete();
      ax2.delete();
      xDir.delete();
      axisDir.delete();
      center.delete();
      return;
    }
    default: {
      const exhaustive: never = segment;
      return exhaustive;
    }
  }
}

const WIRE_FIX_PRECISION_MM = 1e-6;

/** Ordered segments → closed wire, healed by ShapeFix_Wire. */
function buildWire(
  oc: OpenCascadeInstance,
  plane: PlanePlacement,
  loop: LoopGeometry,
  profileId: string
): TopoDS_Wire {
  const wireMaker = new oc.BRepBuilderAPI_MakeWire_1();
  for (const segment of loop) {
    addSegmentEdge(oc, wireMaker, plane, segment);
  }
  if (!wireMaker.IsDone()) {
    wireMaker.delete();
    throw new ProfileError(`Profile ${profileId}: loop does not form a closed wire`, []);
  }
  const rawWire = wireMaker.Wire();
  wireMaker.delete();

  const fixer = new oc.ShapeFix_Wire_1();
  fixer.SetPrecision(WIRE_FIX_PRECISION_MM);
  fixer.Load_1(rawWire);
  fixer.Perform();
  const fixed = fixer.Wire();
  fixer.delete();
  rawWire.delete();
  return fixed;
}

/** Full recipe: outer wire → face, inner wires added reversed (holes). */
export function buildProfileFace(oc: OpenCascadeInstance, profile: PlanProfile): TopoDS_Face {
  const outerWire = buildWire(oc, profile.plane, profile.outer, profile.id);
  const faceMaker = new oc.BRepBuilderAPI_MakeFace_15(outerWire, true);
  if (!faceMaker.IsDone()) {
    faceMaker.delete();
    outerWire.delete();
    throw new ProfileError(`Profile ${profile.id}: outer loop is not planar/closed`, []);
  }

  for (const inner of profile.inner) {
    const innerWire = buildWire(oc, profile.plane, inner, profile.id);
    // Inner loops arrive CCW like the outer — reverse so they cut holes.
    const reversed = innerWire.Reversed();
    faceMaker.Add(oc.TopoDS.Wire_1(reversed));
    reversed.delete();
    innerWire.delete();
  }

  const face = faceMaker.Face();
  faceMaker.delete();
  outerWire.delete();
  return face;
}
