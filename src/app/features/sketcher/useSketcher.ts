import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createId,
  vec2,
  DEG_TO_RAD,
  type BodyId,
  type DatumId,
  type DimensionId,
  type EntityId,
  type PointId,
  type Vec2,
} from '../../../core';
import {
  datumPlaneWorld,
  findSketch,
  getDatum,
  isDatumPlane,
  pointMap,
  referencedPointIds,
  type Sketch,
  type SketchDimensionKind,
  type SketchPlaneRef,
} from '../../../document';
import {
  detectProfiles,
  dimensionRender,
  dimensionEndpoints,
  distanceToDimension,
  mirrorEntities,
  patternEntities,
  distanceToCurve,
  entitiesInMarquee,
  offsetSelection,
  explodeEntities,
  pointIdsInMarquee,
  evaluateSketch,
  fieldsForToolWithStart,
  initialInputState,
  parseField,
  parsedValues,
  pickLineDimension,
  planLineSplit,
  reduceInput,
  DEFAULT_DIMENSION_OFFSET_MM,
  SnapEngine,
  type DimensionRender,
  type NumericInputState,
  type SnapResult,
  type SnapKind,
  type SketchToolId,
  type OffsetSide,
} from '../../../sketch';
import {
  parseReferenceFile,
  importLayers,
  type ImportLayer,
  type ImportPrimitive,
} from '../../../sketch';
import { sectionPlanePoints, sectionPlaneSegments, type SketchModeProps } from '../../../viewport';
import { sketchPlaneBasis } from './planeBasis';
import { addImportedPrimitives } from './importGeometry';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { pushToast } from '../../store/toastStore';
import { resolveSketchFace, useKernelStore } from '../../store/kernelStore';
import { useSessionStore } from '../../store/sessionStore';
import { t } from '../../i18n/t';
import { GeometryPlan } from './geometryPlan';
import { connectedEntityIds } from './shapeSelection';
import {
  initialToolState,
  isChained,
  setConstructionMode,
  toolClick,
  toolEnter,
  toolPreview,
  nearestPointId,
  withStartPoint,
  type ToolState,
} from './toolLogic';

/**
 * The Dim tool's selected kind. `auto` is the AutoCAD-like default: at use it
 * resolves to a `horizontal` or `vertical` dimension from the span (whichever
 * axis dominates). The user overrides to parallel/radius/diameter/angle when
 * needed. Only concrete `SketchDimensionKind`s are ever stored.
 */
export type DimensionToolKind = 'auto' | SketchDimensionKind;

function resolveDimensionKind(kind: DimensionToolKind, a: Vec2, b: Vec2): SketchDimensionKind {
  if (kind !== 'auto') return kind;
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'horizontal' : 'vertical';
}

/** Snap tolerance in screen pixels — converted to mm per query (R11). Generous
 * so connecting new geometry to existing points is easy, including on touch (#5). */
const SNAP_TOLERANCE_PX = 16;
const ANGULAR_TOLERANCE_RAD = 2 * DEG_TO_RAD;
const GRID_SPACING_MM = 1;

const snapEngine = new SnapEngine();

/** startX/startY fields appended to every tool (F2 start-point entry). */
const START_FIELD_COUNT = 2;

/**
 * The typed start point (the last two coord fields). Each axis takes effect the
 * moment it's typed — a missing axis falls back to `fallback` (the live cursor),
 * so typing just startX moves the anchor's X immediately instead of waiting for
 * both fields (#5). Null only when NEITHER coordinate is set.
 */
function startPointOf(state: NumericInputState, fallback: Vec2): Vec2 | null {
  const n = state.fields.length;
  const xDef = state.fields[n - 2];
  const yDef = state.fields[n - 1];
  if (xDef?.id !== 'startX' || yDef?.id !== 'startY') return null;
  const x = parseField(xDef, state.values[n - 2] ?? '');
  const y = parseField(yDef, state.values[n - 1] ?? '');
  if (x === null && y === null) return null;
  return vec2(x ?? fallback.x, y ?? fallback.y);
}

/** Reference dimensions of a sketch, each paired with its id and live geometry. */
function dimensionHitsFor(sketch: Sketch): { id: DimensionId; render: DimensionRender }[] {
  const byId = new Map(sketch.points.map((pt) => [pt.id, pt]));
  const entById = new Map(sketch.entities.map((e) => [e.id, e]));
  const pointPos = (id: PointId): Vec2 | undefined => {
    const pt = byId.get(id);
    return pt ? vec2(pt.x, pt.y) : undefined;
  };
  const out: { id: DimensionId; render: DimensionRender }[] = [];
  for (const dim of sketch.dimensions) {
    const ends = dimensionEndpoints(dim, pointPos, (id) => entById.get(id));
    if (ends) out.push({ id: dim.id, render: dimensionRender(dim, ends[0], ends[1]) });
  }
  return out;
}

/** World-space basis of a sketch's plane (origin plane, or a body-face snapshot). */
export interface FinishSummary {
  readonly profiles: number;
  readonly withHoles: number;
  readonly open: number;
}

/** Base plane a new sketch can be created on (F2 plane selection). */
export type SketchPlaneChoice = 'XY' | 'XZ' | 'YZ';

/** Which line the sketch Mirror reflects across (#2). */
export type MirrorAxis = 'x' | 'y' | 'line';

/** Sketch Pattern parameters from the toolbar form (#2). */
export interface SketchPatternInput {
  readonly kind: 'linear' | 'circular';
  readonly count: number;
  /** Linear: spacing (mm) along `dirAxis`. */
  readonly spacingMm: number;
  readonly dirAxis: 'x' | 'y';
  /** Circular: total sweep (deg) about the sketch origin. */
  readonly angleDeg: number;
}

/** A parsed multi-layer reference import awaiting the user's layer choice (ADR-0088). */
export interface PendingImport {
  readonly fileName: string;
  readonly primitives: readonly ImportPrimitive[];
  readonly layers: readonly ImportLayer[];
  readonly warnings: readonly string[];
}

export interface SketcherApi {
  readonly activeSketch: Sketch | null;
  readonly viewportSketchMode: SketchModeProps | null;
  readonly tool: SketchToolId | null;
  readonly constructionMode: boolean;
  /** Which reference-dimension kind the Dim tool will create (F2). */
  readonly dimensionKind: DimensionToolKind;
  /** True once the Dim tool has its first point and is awaiting the second. */
  readonly dimensionArmed: boolean;
  readonly setDimensionKind: (kind: DimensionToolKind) => void;
  readonly inputState: NumericInputState;
  readonly lastFinish: FinishSummary | null;
  /** True after "New Sketch" until a plane is chosen (F2). */
  readonly choosingPlane: boolean;
  /** True while picking a body face to sketch on (F2). */
  readonly pickingFace: boolean;
  /** Hint shown when a face pick misses a planar face. */
  readonly faceError: string | null;
  readonly setTool: (tool: SketchToolId | null) => void;
  /** Mouse-select a numeric field by index (F2). */
  readonly focusField: (index: number) => void;
  /** Set a numeric field's raw text (DOM `<input>` → machine; raises the mobile keyboard). */
  readonly setFieldText: (index: number, text: string) => void;
  /** Commit the numeric input (Enter / input "Go"). */
  readonly submitInput: () => void;
  /** Cancel the numeric input (Esc). */
  readonly cancelInput: () => void;
  /** Advance to the next numeric field (Tab). */
  readonly cycleField: () => void;
  readonly toggleConstruction: () => void;
  readonly newSketch: () => void;
  readonly choosePlane: (plane: SketchPlaneChoice) => void;
  /** Create the new sketch on an existing construction plane (copy-on-use, #datum). */
  readonly sketchOnDatum: (datumId: DatumId) => void;
  readonly cancelPlaneChoice: () => void;
  readonly beginFacePick: () => void;
  readonly cancelFacePick: () => void;
  readonly pickFace: (
    bodyId: BodyId,
    point: readonly [number, number, number],
    normal: readonly [number, number, number] | null
  ) => void;
  readonly finishSketch: () => void;
  /** Import SVG/DXF reference geometry into the active sketch (#2). */
  readonly importReference: (fileName: string, text: string) => void;
  /** A multi-layer DXF awaiting the user's layer choice (ADR-0088), else null. */
  readonly pendingImport: PendingImport | null;
  /** Import only the chosen source layers, then close the picker. */
  readonly confirmImport: (selectedLayers: ReadonlySet<string>) => void;
  /** Dismiss the layer picker without importing. */
  readonly cancelImport: () => void;
  /** Delete the currently selected sketch entities (touch affordance for the Delete key). */
  readonly deleteSelection: () => void;
  /** Mirror the selected entities across the sketch X/Y axis or a selected line (#2). */
  readonly mirrorSelection: (axis: MirrorAxis) => void;
  /** Array the selected entities linearly or circularly (#2). */
  readonly patternSelection: (spec: SketchPatternInput) => void;
  /** Offset the whole selection by an exact distance + side (#2, AutoCAD). */
  readonly applyOffset: (distanceMm: number, side: OffsetSide) => void;
  /** Translate the box-captured Move/Stretch points by an exact ΔX/ΔY (#3). */
  readonly applyMove: (dx: number, dy: number) => void;
  /** True once a Move/Stretch box has captured a point set awaiting a value. */
  readonly moveArmed: boolean;
  /** True when one or more sketch entities are selected. */
  readonly hasSelection: boolean;
  /** True when exactly one selected entity is a line (enables Mirror-across-line). */
  readonly mirrorLineAvailable: boolean;
  /** Intersect view (#1): clip the near half of bodies + show the plane section. */
  readonly intersect: boolean;
  readonly toggleIntersect: () => void;
  /** Turn the Intersect cross-section into real sketch lines (#2). */
  readonly projectSection: () => void;
  /** True when Intersect is on and a section exists to project. */
  readonly canProjectSection: boolean;
  /** Increments after a reference import to request a one-shot zoom-to-fit. */
  readonly fitNonce: number;
}

export function useSketcher(): SketcherApi {
  const document = useDocumentStore((s) => s.document);
  const activeSketchId = useSessionStore((s) => s.activeSketchId);
  const activeTool = useSessionStore((s) => s.activeTool);
  const snapEnabled = useSessionStore((s) => s.snapEnabled);
  const orthoEnabled = useSessionStore((s) => s.orthoEnabled);
  const selectedEntityIds = useSessionStore((s) => s.selectedEntityIds);
  const selectedDimensionIds = useSessionStore((s) => s.selectedDimensionIds);

  const sketch = activeSketchId ? (findSketch(document, activeSketchId) ?? null) : null;
  const bodies = useKernelStore((s) => s.bodies);
  const basis = sketch ? sketchPlaneBasis(sketch) : null;

  /**
   * Always reads the LIVE document: Zustand updates synchronously on
   * dispatch while React re-renders asynchronously, so two commits inside
   * one frame (fast keyboard entry) must not plan against a stale sketch —
   * duplicate coordinates would break shared topology.
   */
  const liveSketch = useCallback((): Sketch | null => {
    const id = useSessionStore.getState().activeSketchId;
    return id ? (findSketch(useDocumentStore.getState().document, id) ?? null) : null;
  }, []);

  const [toolState, setToolState] = useState<ToolState>(() => initialToolState('line'));
  // Sketch entry starts in Select (activeTool null, #2), so the HUD begins
  // empty; picking a tool loads its fields.
  const [inputState, setInputState] = useState<NumericInputState>(() => initialInputState([]));
  const inputStateRef = useRef(inputState);
  useEffect(() => {
    inputStateRef.current = inputState;
  }, [inputState]);
  // Lets the keydown handler invoke Finish Sketch (defined later) by its 'F'
  // shortcut without a use-before-define cycle.
  const finishRef = useRef<() => void>(() => undefined);
  // Read by the keydown handler (Y), assigned once projectSection is defined.
  const projectSectionRef = useRef<() => void>(() => undefined);
  const [cursor, setCursor] = useState<Vec2>(() => vec2(0, 0));
  const [pxPerMm, setPxPerMm] = useState(1);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [lastFinish, setLastFinish] = useState<FinishSummary | null>(null);
  const [choosingPlane, setChoosingPlane] = useState(false);
  const [pickingFace, setPickingFace] = useState(false);
  const [faceError, setFaceError] = useState<string | null>(null);
  // Change tool: the point currently being dragged + its live position.
  // A Change-tool point drag: which point, and its ORIGINAL position (`base`),
  // used as the snap anchor so ortho / alignment work like drawing (#2). The
  // live target is the snapped cursor (`dragTarget`), not stored here.
  const [drag, setDrag] = useState<{ pointId: PointId; base: Vec2 } | null>(null);
  const dragRef = useRef(drag);
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  // Group point move shared by Stretch (#7) and Move (#3): the captured pool
  // points, the entities they belong to (excluded from snap so the moving
  // geometry can't snap to itself), and — once dragging — the grab `base`. The
  // live target is the snapped cursor (`dragTarget`). Stretch captures only the
  // points inside the box (partial → rubber-band); Move captures every point of
  // the selected whole shapes (rigid translation).
  const [stretch, setStretch] = useState<{
    pointIds: readonly PointId[];
    entityIds: readonly EntityId[];
    base: Vec2 | null;
  } | null>(null);
  const stretchRef = useRef(stretch);
  useEffect(() => {
    stretchRef.current = stretch;
  }, [stretch]);

  // Dim tool: the chosen dimension kind + the first picked point (awaiting the
  // second). Both are read via refs inside the stable click callback.
  const [dimensionKind, setDimensionKindState] = useState<DimensionToolKind>('auto');
  const dimensionKindRef = useRef(dimensionKind);
  useEffect(() => {
    dimensionKindRef.current = dimensionKind;
  }, [dimensionKind]);
  // Intersect view (#1): clip the near body half + show the plane section.
  const [intersect, setIntersect] = useState(false);
  // Bumped after a reference import to request a one-shot zoom-to-fit, so a
  // large DXF/SVG is framed rather than left off-screen (pro import UX).
  const [fitNonce, setFitNonce] = useState(0);
  // A parsed multi-layer import awaiting the user's layer selection (ADR-0088).
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [dimFirst, setDimFirst] = useState<PointId | null>(null);
  const dimFirstRef = useRef(dimFirst);
  useEffect(() => {
    dimFirstRef.current = dimFirst;
  }, [dimFirst]);
  // The first vertex of the active Line/Axis chain (#6): clicking back onto it
  // closes the loop and ends the chain (Fusion parity). Cleared when the chain
  // ends (commit-to-close, tool switch, Escape, Finish Sketch).
  const lineStartRef = useRef<Vec2 | null>(null);

  // Snapping while MOVING geometry (#2): a point/group drag runs the same snap
  // engine as drawing, so ortho H/V, alignment tracing and point/grid snap all
  // apply. Queried against the ORIGINAL sketch (never the moved preview, to
  // avoid a feedback loop) with the moving entities EXCLUDED so geometry can't
  // snap to itself, and `anchor = base` so ortho is measured from the grab.
  const baseEvaluated = useMemo(() => (sketch ? evaluateSketch(sketch) : []), [sketch]);
  const dragBase = drag?.base ?? stretch?.base ?? null;
  const dragExcludeIds = useMemo<ReadonlySet<EntityId>>(() => {
    if (!sketch) return new Set();
    if (stretch?.base) return new Set(stretch.entityIds);
    if (drag) {
      return new Set(
        sketch.entities.filter((e) => referencedPointIds(e).includes(drag.pointId)).map((e) => e.id)
      );
    }
    return new Set();
  }, [sketch, drag, stretch]);
  const dragSnap: SnapResult = useMemo(() => {
    if (!sketch || !dragBase || !snapEnabled || ctrlHeld) return { snap: null, guides: [] };
    const disabledKinds = orthoEnabled
      ? undefined
      : new Set<SnapKind>(['align-h', 'align-v', 'guide-intersection']);
    return snapEngine.query({
      sketch,
      evaluated: baseEvaluated,
      cursor,
      toleranceMm: SNAP_TOLERANCE_PX / Math.max(pxPerMm, 1e-6),
      angularToleranceRad: ANGULAR_TOLERANCE_RAD,
      gridSpacingMm: GRID_SPACING_MM,
      anchor: dragBase,
      excludeEntityIds: dragExcludeIds,
      disabledKinds,
    });
  }, [
    sketch,
    baseEvaluated,
    cursor,
    pxPerMm,
    snapEnabled,
    orthoEnabled,
    ctrlHeld,
    dragBase,
    dragExcludeIds,
  ]);
  // The live snapped target of a drag; null when not dragging. Held in a ref so
  // the pointer-up commit reads the same snapped value the preview showed.
  const dragTarget = dragBase ? (dragSnap.snap?.point ?? cursor) : null;
  const dragTargetRef = useRef(dragTarget);
  useEffect(() => {
    dragTargetRef.current = dragTarget;
  }, [dragTarget]);

  // While dragging (Change tool) render the grabbed point at its live position;
  // while stretching (#7) / moving (#3) translate every captured point by the
  // live delta. Either way the command only fires on drop.
  const displaySketch = useMemo(() => {
    if (!sketch) return sketch;
    if (drag && dragTarget) {
      return {
        ...sketch,
        points: sketch.points.map((pt) =>
          pt.id === drag.pointId ? { ...pt, x: dragTarget.x, y: dragTarget.y } : pt
        ),
      };
    }
    if (stretch?.base && dragTarget) {
      const dx = dragTarget.x - stretch.base.x;
      const dy = dragTarget.y - stretch.base.y;
      const moving = new Set(stretch.pointIds);
      return {
        ...sketch,
        points: sketch.points.map((pt) =>
          moving.has(pt.id) ? { ...pt, x: pt.x + dx, y: pt.y + dy } : pt
        ),
      };
    }
    return sketch;
  }, [sketch, drag, stretch, dragTarget]);

  const evaluated = useMemo(
    () => (displaySketch ? evaluateSketch(displaySketch) : []),
    [displaySketch]
  );

  // Reference-dimension geometry, measured live from the (possibly dragged)
  // point positions so annotations track the geometry (associative, ADR-0002).
  const dimensionHits = useMemo(() => {
    const src = displaySketch ?? sketch;
    return src ? dimensionHitsFor(src) : [];
  }, [displaySketch, sketch]);

  // Snap targets from the Intersect view's section / on-plane outline (#5): the
  // body cross-section projected into plane coords, so new geometry connects to
  // existing bodies. Only when Intersect is on; memoized off the cursor.
  const sectionSnapPoints = useMemo<Vec2[]>(() => {
    if (!intersect || !basis) return [];
    const pts: Vec2[] = [];
    for (const mesh of bodies) {
      for (const p of sectionPlanePoints(mesh.positions, mesh.indices, basis)) {
        pts.push(vec2(p.x, p.y));
      }
    }
    return pts;
    // basis identity is stable per plane; keying on its `key` avoids rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intersect, bodies, basis?.key]);

  // The Intersect cross-section as plane-space segment pairs (#2): the raw
  // material for "Project Section", which turns them into real sketch lines.
  const sectionSegments = useMemo<(readonly [Vec2, Vec2])[]>(() => {
    if (!intersect || !basis) return [];
    const segs: (readonly [Vec2, Vec2])[] = [];
    for (const mesh of bodies) {
      for (const [a, b] of sectionPlaneSegments(mesh.positions, mesh.indices, basis)) {
        segs.push([vec2(a.x, a.y), vec2(b.x, b.y)]);
      }
    }
    return segs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intersect, bodies, basis?.key]);
  const canProjectSection = intersect && sectionSegments.length > 0;
  const sectionSegmentsRef = useRef<readonly (readonly [Vec2, Vec2])[]>([]);
  useEffect(() => {
    sectionSegmentsRef.current = sectionSegments;
  }, [sectionSegments]);

  const snapResult: SnapResult = useMemo(() => {
    if (!sketch || !snapEnabled || ctrlHeld) return { snap: null, guides: [] };
    // Ortho off (#4): suppress the horizontal/vertical alignment guides + their
    // snap candidates (and the H∩V corner), leaving point/parallel/tangent snap.
    const disabledKinds = orthoEnabled
      ? undefined
      : new Set<SnapKind>(['align-h', 'align-v', 'guide-intersection']);
    return snapEngine.query({
      sketch,
      evaluated,
      cursor,
      toleranceMm: SNAP_TOLERANCE_PX / Math.max(pxPerMm, 1e-6),
      angularToleranceRad: ANGULAR_TOLERANCE_RAD,
      gridSpacingMm: GRID_SPACING_MM,
      anchor: toolState.chainAnchor?.p ?? toolState.clicks[toolState.clicks.length - 1]?.p,
      extraSnapPoints: sectionSnapPoints,
      disabledKinds,
    });
  }, [
    sketch,
    evaluated,
    cursor,
    pxPerMm,
    snapEnabled,
    orthoEnabled,
    ctrlHeld,
    toolState,
    sectionSnapPoints,
  ]);

  const effectiveCursor = snapResult.snap?.point ?? cursor;
  const typedValues = useMemo(() => parsedValues(inputState), [inputState]);

  const applyStep = useCallback(
    (step: { state: ToolState; commit: ((plan: GeometryPlan) => void) | null }) => {
      const current = liveSketch();
      if (step.commit && current) {
        const plan = new GeometryPlan(current);
        step.commit(plan);
        commandBus.dispatch({
          type: 'AddSketchGeometry',
          payload: { sketchId: current.id, ...plan.payload },
        });
      }
      // Single-shot workflow (#3a): after a shape commits, return to Select so
      // the tool doesn't stay armed. The Line tool is the exception — it chains
      // as the continuous free-shape tool for irregular polygons.
      if (step.commit !== null && step.state.tool !== 'line') {
        useSessionStore.getState().setActiveTool(null);
        setToolState((prev) => ({
          ...initialToolState('line'),
          constructionMode: prev.constructionMode,
        }));
        setInputState(initialInputState([]));
        return;
      }
      setToolState(step.state);
      // Fields track the tool's chain state (chained Line gains angleRel);
      // each step starts the next entry fresh, matching the machine's Enter reset.
      setInputState(
        initialInputState(fieldsForToolWithStart(step.state.tool, isChained(step.state)))
      );
    },
    [liveSketch]
  );

  // --- Numeric HUD input (shared by the global keydown handler AND the DOM
  // <input> fields, so a mobile soft keyboard drives the same machine) -------
  const submitInput = useCallback(() => {
    // Select/navigate mode (no active tool): Enter must not commit geometry.
    const activeTool = useSessionStore.getState().activeTool;
    if (activeTool === null) return;
    // Spline has no numeric fields — Enter finishes the OPEN curve through the
    // fit points placed so far.
    if (activeTool === 'spline') {
      applyStep(toolEnter(toolState, [], effectiveCursor));
      return;
    }
    const before = inputStateRef.current;
    const transition = reduceInput(before, { type: 'enter' });
    setInputState(transition.state);
    if (transition.effect.kind === 'commit') {
      // A typed segment commits and the chain continues (keyboard drawing).
      const start = startPointOf(before, effectiveCursor);
      const shapeValues = transition.effect.values.slice(
        0,
        before.fields.length - START_FIELD_COUNT
      );
      const armed = start ? withStartPoint(toolState, start) : toolState;
      applyStep(toolEnter(armed, shapeValues, effectiveCursor));
    } else if (activeTool === 'line' || activeTool === 'axis') {
      // Enter with nothing to commit FINISHES the Line/Axis run and returns to
      // Select so the view can be rotated (#5) — the segments drawn so far stay.
      useSessionStore.getState().setActiveTool(null);
      setToolState((prev) => ({
        ...initialToolState('line'),
        constructionMode: prev.constructionMode,
      }));
      setInputState(initialInputState([]));
      lineStartRef.current = null;
    }
  }, [applyStep, toolState, effectiveCursor]);

  // Esc always exits the active tool back to Select/navigate so the view can be
  // rotated (#6): it clears any in-progress chain/dimension AND deactivates the
  // tool (Line, Circle, …), rather than merely resetting the current tool.
  const cancelInput = useCallback(() => {
    useSessionStore.getState().setActiveTool(null);
    setToolState((prev) => ({
      ...initialToolState('line'),
      constructionMode: prev.constructionMode,
    }));
    setInputState(initialInputState([]));
    setDimFirst(null);
    lineStartRef.current = null;
  }, []);

  const setFieldText = useCallback((index: number, text: string) => {
    setInputState((s) => reduceInput(s, { type: 'setText', index, text }).state);
  }, []);

  const cycleField = useCallback(() => {
    setInputState((s) => reduceInput(s, { type: 'tab' }).state);
  }, []);

  // --- Viewport callbacks --------------------------------------------------
  const onCursor = useCallback((p: Vec2, scale: number) => {
    setCursor(p);
    setPxPerMm(scale);
  }, []);

  // AutoCAD-style marquee selection (#6), active as the default Select tool.
  // Left→right = window (wholly-enclosed only); right→left = crossing (touch).
  // Selects whole connected shapes, matching a single Select click.
  const onMarquee = useCallback(
    (a: Vec2, b: Vec2, crossing: boolean) => {
      const current = liveSketch();
      if (!current) return;
      const active = useSessionStore.getState().activeTool;
      // Stretch (#7): the box captures the pool points INSIDE it — the next
      // press-drag moves only those, so partially-boxed shapes rubber-band.
      if (active === 'stretch') {
        const pointIds = pointIdsInMarquee(current.points, a, b);
        const moving = new Set(pointIds);
        const entityIds = current.entities
          .filter((e) => referencedPointIds(e).some((id) => moving.has(id)))
          .map((e) => e.id);
        setStretch(pointIds.length > 0 ? { pointIds, entityIds, base: null } : null);
        return;
      }
      // Move (#3, AutoCAD): the box selects WHOLE shapes; every one of their
      // pool points is captured, so the next press-drag translates them rigidly.
      if (active === 'move') {
        const hits = entitiesInMarquee(evaluateSketch(current), a, b, crossing);
        const ids = new Set<EntityId>();
        for (const id of hits) for (const c of connectedEntityIds(current, id)) ids.add(c);
        const entityIds = [...ids];
        const pointSet = new Set<PointId>();
        for (const e of current.entities) {
          if (ids.has(e.id)) for (const pt of referencedPointIds(e)) pointSet.add(pt);
        }
        useSessionStore.getState().setSelection(entityIds);
        setStretch(pointSet.size > 0 ? { pointIds: [...pointSet], entityIds, base: null } : null);
        return;
      }
      const hits = entitiesInMarquee(evaluateSketch(current), a, b, crossing);
      const ids = new Set<EntityId>();
      for (const id of hits) for (const c of connectedEntityIds(current, id)) ids.add(c);
      useSessionStore.getState().setSelection([...ids]);
    },
    [liveSketch]
  );

  const onClickPoint = useCallback(
    (p: Vec2, scale: number) => {
      setCursor(p);
      setPxPerMm(scale);
      const current = liveSketch();
      if (!current) return;
      const tool = useSessionStore.getState().activeTool;
      if (!tool || tool === 'change') {
        // A click that didn't grab a point picks the nearest entity within
        // tolerance. Select (no tool) picks the WHOLE connected shape so
        // Properties summarizes it as drawn; Change keeps the single entity for
        // point/line editing (#3).
        const tolMm = SNAP_TOLERANCE_PX / Math.max(scale, 1e-6);
        let bestId: EntityId | null = null;
        let bestDist = tolMm;
        for (const entity of evaluateSketch(current)) {
          const d = distanceToCurve(entity.curve, p);
          if (d <= bestDist) {
            bestDist = d;
            bestId = entity.entityId;
          }
        }
        // A reference dimension can be picked too (so it can be deleted).
        // Whichever is nearest within tolerance — geometry or dimension — wins.
        let bestDimId: DimensionId | null = null;
        let bestDimDist = tolMm;
        for (const hit of dimensionHitsFor(current)) {
          const d = distanceToDimension(hit.render, p);
          if (d <= bestDimDist) {
            bestDimDist = d;
            bestDimId = hit.id;
          }
        }
        if (bestDimId && bestDimDist <= bestDist) {
          useSessionStore.getState().setSelectedDimensions([bestDimId]);
          return;
        }
        const selection = bestId
          ? tool === 'change'
            ? [bestId]
            : connectedEntityIds(current, bestId)
          : [];
        useSessionStore.getState().setSelection(selection);
        return;
      }
      if (tool === 'dimension') {
        // Reference dimensions annotate two existing pool points: each click must
        // land on a point (snap-assisted). First click arms; second commits.
        const tolMm = SNAP_TOLERANCE_PX / Math.max(scale, 1e-6);
        // Fusion: clicking a circle/arc RIM dimensions its size in one click,
        // even though the centre is a snappable pool point that would otherwise
        // capture the click (#10). Detect the rim from the RAW cursor and prefer
        // it whenever the click is nearer the rim than the centre.
        if (!dimFirstRef.current) {
          let radialEnt: (typeof current.entities)[number] | null = null;
          let bestRadial = tolMm;
          for (const ev of evaluateSketch(current)) {
            const ent = current.entities.find((e) => e.id === ev.entityId);
            if (ent?.type !== 'circle' && ent?.type !== 'arc') continue;
            const d = distanceToCurve(ev.curve, p);
            if (d > bestRadial) continue;
            const centerPt = current.points.find((pt) => pt.id === ent.center);
            const centerDist = centerPt ? Math.hypot(p.x - centerPt.x, p.y - centerPt.y) : Infinity;
            if (d < centerDist) {
              bestRadial = d;
              radialEnt = ent;
            }
          }
          if (radialEnt) {
            const chosen = dimensionKindRef.current;
            const radialKind: SketchDimensionKind =
              chosen === 'radius' || chosen === 'diameter'
                ? chosen
                : radialEnt.type === 'circle'
                  ? 'diameter'
                  : 'radius';
            const existingRadial = new Set<string>(current.dimensions.map((d) => d.id));
            commandBus.dispatch({
              type: 'AddSketchDimension',
              payload: {
                sketchId: current.id,
                dimension: {
                  id: createId<'DimensionId'>(existingRadial),
                  kind: radialKind,
                  a: radialEnt.center,
                  b: radialEnt.center,
                  offset: DEFAULT_DIMENSION_OFFSET_MM,
                  entityId: radialEnt.id,
                },
              },
            });
            setDimFirst(null);
            return;
          }
        }
        const dimTarget = snapResult.snap?.point ?? p;
        const picked = nearestPointId(current.points, dimTarget, tolMm);
        if (!picked) {
          // No pool point under the cursor — a click on a circle/arc rim creates
          // a radial (radius/diameter) dimension in one click (#1): a full circle
          // has no rim pool point, so the rim endpoint is derived from the entity.
          if (dimFirstRef.current) return;
          let radialId: EntityId | null = null;
          let bestRadial = tolMm;
          for (const ev of evaluateSketch(current)) {
            const ent = current.entities.find((e) => e.id === ev.entityId);
            if (ent?.type !== 'circle' && ent?.type !== 'arc') continue;
            const d = distanceToCurve(ev.curve, dimTarget);
            if (d <= bestRadial) {
              bestRadial = d;
              radialId = ev.entityId;
            }
          }
          const radialEntity = current.entities.find((e) => e.id === radialId);
          if (!radialEntity || (radialEntity.type !== 'circle' && radialEntity.type !== 'arc')) {
            // Line pick (#6c): no point/rim under the cursor → dimension the
            // LENGTH of the nearest straight line in one click.
            const linePick = pickLineDimension(current, dimTarget, tolMm, dimensionKindRef.current);
            if (!linePick) return;
            const existingLine = new Set<string>(current.dimensions.map((d) => d.id));
            commandBus.dispatch({
              type: 'AddSketchDimension',
              payload: {
                sketchId: current.id,
                dimension: {
                  id: createId<'DimensionId'>(existingLine),
                  kind: linePick.kind,
                  a: linePick.a,
                  b: linePick.b,
                  offset: DEFAULT_DIMENSION_OFFSET_MM,
                },
              },
            });
            setDimFirst(null);
            return;
          }
          const chosen = dimensionKindRef.current;
          const radialKind: SketchDimensionKind =
            chosen === 'radius' || chosen === 'diameter'
              ? chosen
              : radialEntity.type === 'circle'
                ? 'diameter'
                : 'radius';
          const existingRadial = new Set<string>(current.dimensions.map((d) => d.id));
          commandBus.dispatch({
            type: 'AddSketchDimension',
            payload: {
              sketchId: current.id,
              dimension: {
                id: createId<'DimensionId'>(existingRadial),
                kind: radialKind,
                a: radialEntity.center,
                b: radialEntity.center,
                offset: DEFAULT_DIMENSION_OFFSET_MM,
                entityId: radialEntity.id,
              },
            },
          });
          setDimFirst(null);
          return;
        }
        const first = dimFirstRef.current;
        if (!first) {
          setDimFirst(picked);
          return;
        }
        if (first === picked) return;
        const aPt = current.points.find((pt) => pt.id === first);
        const bPt = current.points.find((pt) => pt.id === picked);
        if (!aPt || !bPt) return;
        const existing = new Set<string>(current.dimensions.map((d) => d.id));
        const dimensionId = createId<'DimensionId'>(existing);
        commandBus.dispatch({
          type: 'AddSketchDimension',
          payload: {
            sketchId: current.id,
            dimension: {
              id: dimensionId,
              // 'auto' resolves to horizontal/vertical from the span (AutoCAD-like).
              kind: resolveDimensionKind(
                dimensionKindRef.current,
                vec2(aPt.x, aPt.y),
                vec2(bPt.x, bPt.y)
              ),
              a: first,
              b: picked,
              offset: DEFAULT_DIMENSION_OFFSET_MM,
            },
          },
        });
        setDimFirst(null);
        return;
      }
      if (tool === 'split') {
        // Pick the nearest line and divide it wherever other lines cross it,
        // inserting shared joint points (#6). One click = one split.
        const tolMm = SNAP_TOLERANCE_PX / Math.max(scale, 1e-6);
        let bestId: EntityId | null = null;
        let bestDist = tolMm;
        for (const entity of evaluateSketch(current)) {
          const ent = current.entities.find((e) => e.id === entity.entityId);
          if (ent?.type !== 'line') continue;
          const d = distanceToCurve(entity.curve, p);
          if (d <= bestDist) {
            bestDist = d;
            bestId = entity.entityId;
          }
        }
        if (!bestId) return;
        const plan = planLineSplit(current, bestId);
        if (!plan) return; // nothing crosses it — no-op
        commandBus.dispatch({
          type: 'SplitSketchLine',
          payload: {
            sketchId: current.id,
            removeEntityIds: plan.removeEntityIds,
            addPoints: plan.addPoints,
            addEntities: plan.addEntities,
          },
        });
        return;
      }
      if (tool === 'offset') {
        // Offset (#2, AutoCAD parity): the tool now works on a whole SELECTION —
        // many lines, a closed loop, circles/arcs — offset at once by a typed
        // distance from the Offset panel. A click here toggles the nearest
        // connected shape into the selection (marquee adds too); the panel's
        // Apply then calls `applyOffset`. This click never mutates geometry.
        const tolMm = SNAP_TOLERANCE_PX / Math.max(scale, 1e-6);
        let bestId: EntityId | null = null;
        let bestDist = tolMm;
        for (const ev of evaluateSketch(current)) {
          const ent = current.entities.find((e) => e.id === ev.entityId);
          if (!ent || ent.type === 'point' || ent.type === 'spline') continue;
          const d = distanceToCurve(ev.curve, p);
          if (d <= bestDist) {
            bestDist = d;
            bestId = ev.entityId;
          }
        }
        const session = useSessionStore.getState();
        if (bestId) {
          const shape = connectedEntityIds(current, bestId);
          const cur = new Set(session.selectedEntityIds);
          // Toggle the whole shape: remove if already fully selected, else add.
          const allIn = shape.every((id) => cur.has(id));
          for (const id of shape) {
            if (allIn) cur.delete(id);
            else cur.add(id);
          }
          session.setSelection([...cur]);
        } else {
          session.setSelection([]);
        }
        return;
      }
      if (tool === 'explode') {
        // Explode ("bomb", AutoCAD): click a shape → un-weld it into individually
        // selectable entities. Picks the whole connected shape under the cursor
        // (or the current multi-selection), gives each entity private points, and
        // rebuilds via delete + add through the write path.
        const tolMm = SNAP_TOLERANCE_PX / Math.max(scale, 1e-6);
        const selected = useSessionStore.getState().selectedEntityIds;
        let targetIds: EntityId[] = [];
        if (selected.length > 0) {
          const set = new Set<EntityId>();
          for (const id of selected) for (const c of connectedEntityIds(current, id)) set.add(c);
          targetIds = [...set];
        } else {
          let bestId: EntityId | null = null;
          let bestDist = tolMm;
          for (const ev of evaluateSketch(current)) {
            const d = distanceToCurve(ev.curve, p);
            if (d <= bestDist) {
              bestDist = d;
              bestId = ev.entityId;
            }
          }
          if (bestId) targetIds = connectedEntityIds(current, bestId);
        }
        const result = targetIds.length > 0 ? explodeEntities(current, targetIds) : null;
        if (result) {
          commandBus.dispatch({
            type: 'DeleteSketchEntities',
            payload: { sketchId: current.id, entityIds: result.removeEntityIds },
          });
          commandBus.dispatch({
            type: 'AddSketchGeometry',
            payload: {
              sketchId: current.id,
              points: result.add.points,
              entities: result.add.entities,
            },
          });
        }
        useSessionStore.getState().setSelection([]);
        return;
      }
      if (tool === 'stretch' || tool === 'move') return; // box-select + drag, elsewhere
      const snap = snapResult.snap;
      const spec =
        snap?.sourceRef.type === 'point'
          ? { p: snap.point, existing: snap.sourceRef.pointId }
          : { p: snap?.point ?? p };

      // Line/Axis chain intuitiveness (#6): the free-shape chain is the one tool
      // where stray clicks are easy. Two guards make it predictable —
      //  (a) DEDUPE: a click landing on the current end point is ignored, so a
      //      double-click or jittery click never lays down a zero-length stub.
      //  (b) CLOSE-TO-FINISH: clicking back on the chain's first vertex commits
      //      the closing segment (shared point → a real closed loop) AND ends
      //      the chain, so the next click starts a fresh shape instead of
      //      accidentally extending this one.
      if (tool === 'line' || tool === 'axis') {
        const tolMm = SNAP_TOLERANCE_PX / Math.max(scale, 1e-6);
        const near = (a: Vec2, b: Vec2): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= tolMm;
        const anchor = toolState.chainAnchor?.p ?? null;
        if (anchor && near(anchor, spec.p)) return; // (a) ignore repeat click
        if (!anchor) {
          lineStartRef.current = spec.p; // first vertex of a fresh chain
        } else if (lineStartRef.current && near(lineStartRef.current, spec.p)) {
          // (b) close the loop, then reset to a fresh (disarmed) chain.
          applyStep(toolClick(toolState, spec));
          setToolState((prev) => ({
            ...initialToolState(prev.tool),
            constructionMode: prev.constructionMode,
          }));
          setInputState(initialInputState(fieldsForToolWithStart(tool, false)));
          lineStartRef.current = null;
          return;
        }
      }

      // Spline: accumulate fit points; ignore a repeat click on the last point,
      // and CLOSE the curve when clicking back on the first fit point (#1).
      if (tool === 'spline') {
        const tolMm = SNAP_TOLERANCE_PX / Math.max(scale, 1e-6);
        const near = (a: Vec2, b: Vec2): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= tolMm;
        const clicks = toolState.clicks;
        const last = clicks[clicks.length - 1]?.p;
        if (last && near(last, spec.p)) return;
        const first = clicks[0]?.p;
        if (clicks.length >= 2 && first && near(first, spec.p)) {
          const plan = new GeometryPlan(current);
          plan.addSpline(clicks, true, toolState.constructionMode);
          commandBus.dispatch({
            type: 'AddSketchGeometry',
            payload: { sketchId: current.id, ...plan.payload },
          });
          setToolState((prev) => ({
            ...initialToolState('spline'),
            constructionMode: prev.constructionMode,
          }));
          setInputState(initialInputState([]));
          return;
        }
      }
      applyStep(toolClick(toolState, spec));
    },
    [applyStep, liveSketch, snapResult, toolState]
  );

  // --- Change tool point drag (F2) / Stretch group drag (#7) ----------------
  const onPointGrab = useCallback(
    (p: Vec2, scale: number): boolean => {
      const tool = useSessionStore.getState().activeTool;
      // Stretch (#7) / Move (#3): once a box has captured a point set, a press
      // anywhere begins the group translation (base = grab point). No set yet →
      // let the marquee arm instead (return false).
      if (tool === 'stretch' || tool === 'move') {
        const s = stretchRef.current;
        if (!s || s.pointIds.length === 0) return false;
        setStretch({ ...s, base: p });
        return true;
      }
      if (tool !== 'change') return false;
      const current = liveSketch();
      if (!current) return false;
      const tolMm = SNAP_TOLERANCE_PX / Math.max(scale, 1e-6);
      const pointId = nearestPointId(current.points, p, tolMm);
      if (!pointId) return false;
      const pt = current.points.find((q) => q.id === pointId);
      setDrag({ pointId, base: pt ? vec2(pt.x, pt.y) : p });
      return true;
    },
    [liveSketch]
  );

  // Feed the live cursor into the shared pipeline so the snap engine re-runs at
  // the drag location (#2); displaySketch reads the snapped `dragTarget`.
  const onPointDrag = useCallback((p: Vec2) => {
    setCursor(p);
  }, []);

  const onPointDrop = useCallback(() => {
    const target = dragTargetRef.current;
    const s = stretchRef.current;
    const current = liveSketch();
    // Commit a group move (Stretch/Move): translate every captured point by the
    // snapped (target − base) delta. Clearing the set ends it; re-box for more.
    if (s?.base && target && current) {
      const dx = target.x - s.base.x;
      const dy = target.y - s.base.y;
      if (dx !== 0 || dy !== 0) {
        const byId = pointMap(current);
        const moves = s.pointIds.flatMap((pointId) => {
          const pt = byId.get(pointId);
          return pt ? [{ pointId, x: pt.x + dx, y: pt.y + dy }] : [];
        });
        if (moves.length > 0) {
          commandBus.dispatch({
            type: 'MoveSketchPoints',
            payload: { sketchId: current.id, moves },
          });
        }
      }
      setStretch(null);
      return;
    }
    const d = dragRef.current;
    if (d && target && current) {
      commandBus.dispatch({
        type: 'MoveSketchPoints',
        payload: {
          sketchId: current.id,
          moves: [{ pointId: d.pointId, x: target.x, y: target.y }],
        },
      });
    }
    setDrag(null);
  }, [liveSketch]);

  // Selecting a tool (or null = Select/navigate) loads its numeric fields, or
  // clears the HUD + disarms the machine so a click/drag navigates rather than
  // drawing (#2). Chaining (applyStep) mutates toolState without going through
  // here, so the free-shape Line keeps its anchor between segments.
  const setTool = useCallback((tool: SketchToolId | null) => {
    useSessionStore.getState().setActiveTool(tool);
    setDimFirst(null); // switching tools cancels a half-placed dimension
    lineStartRef.current = null; // and ends any open line chain (#6)
    setStretch(null); // and any captured stretch/move set (#7/#3)
    setDrag(null); // and any in-flight point drag
    setToolState((prev) => ({
      ...initialToolState(tool ?? 'line'),
      constructionMode: prev.constructionMode,
    }));
    setInputState(initialInputState(tool ? fieldsForToolWithStart(tool, false) : []));
  }, []);

  const setDimensionKind = useCallback((kind: DimensionToolKind) => {
    setDimensionKindState(kind);
  }, []);

  // --- Keyboard ------------------------------------------------------------
  useEffect(() => {
    if (!sketch) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Control') setCtrlHeld(true);
      // Form fields (properties panel) own their keystrokes.
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      const session = useSessionStore.getState();

      if (event.key === 'Tab') {
        event.preventDefault();
        setInputState((s) => reduceInput(s, { type: 'tab' }).state);
        return;
      }
      if (event.key === 'Backspace' && session.activeTool) {
        setInputState((s) => reduceInput(s, { type: 'backspace' }).state);
        return;
      }
      if (event.key === 'Enter') {
        submitInput();
        return;
      }
      if (event.key === 'Escape') {
        cancelInput();
        return;
      }
      if (/^[0-9.-]$/.test(event.key)) {
        setInputState((s) => reduceInput(s, { type: 'char', char: event.key }).state);
        return;
      }
      if (event.key === 'x' || event.key === 'X') {
        setToolState((s) => setConstructionMode(s, !s.constructionMode));
        return;
      }
      if (event.key === 'Delete' && session.selectedDimensionIds.length > 0) {
        commandBus.dispatch({
          type: 'DeleteSketchDimensions',
          payload: { sketchId: sketch.id, dimensionIds: session.selectedDimensionIds },
        });
        session.setSelectedDimensions([]);
        return;
      }
      if (event.key === 'Delete' && session.selectedEntityIds.length > 0) {
        commandBus.dispatch({
          type: 'DeleteSketchEntities',
          payload: { sketchId: sketch.id, entityIds: session.selectedEntityIds },
        });
        session.setSelection([]);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        event.preventDefault();
        commandBus.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
        event.preventDefault();
        commandBus.redo();
        return;
      }
      if (event.ctrlKey || event.metaKey) return;
      // Sketch-menu buttons that aren't drawing tools still get shortcuts
      // (project master rule, ADR-0032): Snap (Q) and Finish Sketch (F).
      if (event.key === 'q' || event.key === 'Q') {
        const s = useSessionStore.getState();
        s.setSnapEnabled(!s.snapEnabled);
        return;
      }
      if (event.key === 'o' || event.key === 'O') {
        const s = useSessionStore.getState();
        s.setOrthoEnabled(!s.orthoEnabled); // Ortho H/V snapping toggle (#4)
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        finishRef.current();
        return;
      }
      if (event.key === 'j' || event.key === 'J') {
        setIntersect((v) => !v); // Intersect view toggle (#1, ADR-0032)
        return;
      }
      if (event.key === 'y' || event.key === 'Y') {
        projectSectionRef.current(); // Project the Intersect section to lines (#2)
        return;
      }
      if (event.key === 's' || event.key === 'S') {
        setTool(null); // Select
        return;
      }
      // Shift+R / Shift+A choose the Center variants; the plain keys the others.
      const shifted: Partial<Record<string, SketchToolId>> = {
        R: 'rectangle-center',
        A: 'arc-center',
      };
      if (event.shiftKey) {
        const shiftedTool = shifted[event.key];
        if (shiftedTool) setTool(shiftedTool);
        return;
      }
      const toolHotkeys: Record<string, SketchToolId> = {
        l: 'line',
        i: 'axis',
        r: 'rectangle-2p',
        c: 'circle-center-diameter',
        a: 'arc-3p',
        p: 'point',
        g: 'polygon',
        b: 'spline',
        m: 'change',
        d: 'dimension',
        t: 'split',
        e: 'stretch',
        w: 'offset',
        v: 'move',
        k: 'explode',
      };
      const hotkey = toolHotkeys[event.key.toLowerCase()];
      if (hotkey) {
        setTool(hotkey);
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Control') setCtrlHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [sketch, submitInput, cancelInput, setTool]);

  // --- Public API ------------------------------------------------------------
  const focusField = useCallback((index: number) => {
    setInputState((s) => reduceInput(s, { type: 'focus', index }).state);
  }, []);

  // Construction toggle (X): with entities selected, flip THOSE entities between
  // normal and construction (#2) — set all to construction if any is still
  // normal, else all back to normal. With nothing selected, it toggles the draw
  // mode (new geometry is construction) as before.
  const toggleConstruction = useCallback(() => {
    const current = liveSketch();
    const selected = useSessionStore.getState().selectedEntityIds;
    if (current && selected.length > 0) {
      const set = new Set(selected);
      const anyNormal = current.entities.some((e) => set.has(e.id) && !e.construction);
      for (const id of selected) {
        commandBus.dispatch({
          type: 'SetEntityConstruction',
          payload: { sketchId: current.id, entityId: id, construction: anyNormal },
        });
      }
      return;
    }
    setToolState((s) => setConstructionMode(s, !s.constructionMode));
  }, [liveSketch]);

  const toggleIntersect = useCallback(() => {
    setIntersect((v) => !v);
  }, []);

  // Project Section (#2): materialize the Intersect cross-section as REAL sketch
  // line entities (normal), welding shared endpoints so they form closed
  // profiles. Once real, they can be box-selected, flipped to construction (X),
  // trimmed, and consumed by Extrude/Revolve like any drawn geometry.
  const projectSection = useCallback(() => {
    const current = liveSketch();
    if (!current) return;
    const segs = sectionSegmentsRef.current;
    if (segs.length === 0) return;
    const plan = new GeometryPlan(current);
    for (const [a, b] of segs) plan.addLine({ p: a }, { p: b }, false);
    if (plan.payload.entities.length === 0) return;
    commandBus.dispatch({
      type: 'AddSketchGeometry',
      payload: { sketchId: current.id, ...plan.payload },
    });
  }, [liveSketch]);
  useEffect(() => {
    projectSectionRef.current = projectSection;
  }, [projectSection]);

  const deleteSelection = useCallback(() => {
    const current = liveSketch();
    const session = useSessionStore.getState();
    if (!current) return;
    if (session.selectedDimensionIds.length > 0) {
      commandBus.dispatch({
        type: 'DeleteSketchDimensions',
        payload: { sketchId: current.id, dimensionIds: session.selectedDimensionIds },
      });
      session.setSelectedDimensions([]);
      return;
    }
    if (session.selectedEntityIds.length === 0) return;
    commandBus.dispatch({
      type: 'DeleteSketchEntities',
      payload: { sketchId: current.id, entityIds: session.selectedEntityIds },
    });
    session.setSelection([]);
  }, [liveSketch]);

  // Sketch Mirror (#2): reflect the selected entities across the sketch X/Y
  // axis, or across a single selected line (which itself stays put). New
  // geometry is added via the same AddSketchGeometry path as drawing.
  const mirrorSelection = useCallback(
    (axis: MirrorAxis) => {
      const current = liveSketch();
      if (!current) return;
      const selected = new Set(useSessionStore.getState().selectedEntityIds);
      if (selected.size === 0) return;
      let a = vec2(0, 0);
      let b = axis === 'x' ? vec2(1, 0) : vec2(0, 1);
      let targets = selected;
      if (axis === 'line') {
        const line = current.entities.find((e) => selected.has(e.id) && e.type === 'line');
        if (line?.type !== 'line') return;
        const pts = pointMap(current);
        const p1 = pts.get(line.start);
        const p2 = pts.get(line.end);
        if (!p1 || !p2) return;
        a = vec2(p1.x, p1.y);
        b = vec2(p2.x, p2.y);
        targets = new Set([...selected].filter((id) => id !== line.id));
      }
      if (targets.size === 0) return;
      const delta = mirrorEntities(current, targets, a, b);
      if (delta.entities.length === 0) return;
      commandBus.dispatch({
        type: 'AddSketchGeometry',
        payload: { sketchId: current.id, points: delta.points, entities: delta.entities },
      });
    },
    [liveSketch]
  );

  // Sketch Pattern (#2): linear (spacing along X/Y) or circular (about the
  // sketch origin) array of the selected entities.
  const patternSelection = useCallback(
    (spec: SketchPatternInput) => {
      const current = liveSketch();
      if (!current) return;
      const selected = new Set(useSessionStore.getState().selectedEntityIds);
      if (selected.size === 0) return;
      const delta = patternEntities(
        current,
        selected,
        spec.kind === 'linear'
          ? {
              kind: 'linear',
              count: spec.count,
              dx: spec.dirAxis === 'x' ? spec.spacingMm : 0,
              dy: spec.dirAxis === 'y' ? spec.spacingMm : 0,
            }
          : {
              kind: 'circular',
              count: spec.count,
              center: vec2(0, 0),
              totalAngleRad: spec.angleDeg * DEG_TO_RAD,
            }
      );
      if (delta.entities.length === 0) return;
      commandBus.dispatch({
        type: 'AddSketchGeometry',
        payload: { sketchId: current.id, points: delta.points, entities: delta.entities },
      });
    },
    [liveSketch]
  );

  // Sketch Offset (#2, AutoCAD parity): offset the WHOLE selection at once by a
  // typed distance and side — connected line chains offset as mitred parallel
  // loops/polylines, circles/arcs concentrically. Driven by the Offset panel's
  // dialog value (exact); adds geometry via the same AddSketchGeometry path.
  const applyOffset = useCallback(
    (distanceMm: number, side: OffsetSide) => {
      const current = liveSketch();
      if (!current) return;
      const selected = useSessionStore.getState().selectedEntityIds;
      if (selected.length === 0) return;
      const delta = offsetSelection(current, selected, distanceMm, side);
      if (!delta || delta.entities.length === 0) return;
      commandBus.dispatch({
        type: 'AddSketchGeometry',
        payload: { sketchId: current.id, points: delta.points, entities: delta.entities },
      });
    },
    [liveSketch]
  );

  // Sketch Move / Stretch typed translation (#3, AutoCAD parity): after a box
  // has captured a point set, apply an EXACT ΔX/ΔY from the Move panel instead
  // of a mouse drag. Stretch moves only the boxed points (rubber-band); Move
  // moves whole shapes. Clears the captured set so a fresh box starts the next.
  const applyMove = useCallback(
    (dx: number, dy: number) => {
      const current = liveSketch();
      const s = stretchRef.current;
      if (!current || !s || s.pointIds.length === 0) return;
      if (dx === 0 && dy === 0) {
        setStretch(null);
        return;
      }
      const byId = pointMap(current);
      const moves = s.pointIds.flatMap((pointId) => {
        const pt = byId.get(pointId);
        return pt ? [{ pointId, x: pt.x + dx, y: pt.y + dy }] : [];
      });
      if (moves.length > 0) {
        commandBus.dispatch({
          type: 'MoveSketchPoints',
          payload: { sketchId: current.id, moves },
        });
      }
      setStretch(null);
    },
    [liveSketch]
  );

  const mirrorLineAvailable =
    sketch !== null &&
    sketch.entities.filter((e) => selectedEntityIds.includes(e.id) && e.type === 'line').length ===
      1;

  // Sketch Mirror shortcut (master rule, ADR-0032): K mirrors the selection
  // across a single selected line if one is picked, else the sketch X axis;
  // Shift+K mirrors across the Y axis. A dedicated listener (defined after the
  // callbacks) keeps the main keydown handler untouched.
  useEffect(() => {
    if (!sketch) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'k') mirrorSelection(mirrorLineAvailable ? 'line' : 'x');
      else if (e.key === 'K') mirrorSelection('y');
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [sketch, mirrorSelection, mirrorLineAvailable]);

  // "New Sketch" first asks which plane to draw on (F2 plane selection);
  // the sketch is created once a plane is chosen.
  const newSketch = useCallback(() => {
    setChoosingPlane(true);
  }, []);

  const cancelPlaneChoice = useCallback(() => {
    setChoosingPlane(false);
  }, []);

  const createSketch = useCallback((plane: SketchPlaneRef) => {
    const doc = useDocumentStore.getState().document;
    const existing = new Set<string>([
      ...doc.sketches.map((s) => s.id),
      ...doc.ops.map((o) => o.id),
    ]);
    const sketchId = createId<'SketchId'>(existing);
    existing.add(sketchId);
    const opId = createId<'OpId'>(existing);
    const result = commandBus.dispatch({
      type: 'CreateSketch',
      payload: { sketchId, opId, name: `Sketch${String(doc.sketches.length + 1)}`, plane },
    });
    if (result.ok) {
      useSessionStore.getState().enterSketch(sketchId);
      setChoosingPlane(false);
      setPickingFace(false);
      setFaceError(null);
      setLastFinish(null);
      // Start in Select/navigate, not a drawing tool (#2): the HUD stays empty
      // until the user picks a tool, so the first drag navigates.
      setToolState(initialToolState('line'));
      setInputState(initialInputState([]));
    }
  }, []);

  const choosePlane = useCallback(
    (plane: SketchPlaneChoice) => {
      createSketch({ kind: 'origin', plane });
    },
    [createSketch]
  );

  // Sketch on a construction plane (copy-on-use): resolve the plane's world
  // placement from the datum collection and stamp it onto the sketch's datum
  // ref, reusing the face/datum placement path downstream.
  const sketchOnDatum = useCallback(
    (datumId: DatumId) => {
      const doc = useDocumentStore.getState().document;
      const datum = getDatum(doc, datumId);
      if (!datum || !isDatumPlane(datum)) return;
      const w = datumPlaneWorld(datum, doc.datums);
      createSketch({
        kind: 'datum',
        base: datum.base,
        offsetMm: datum.offsetMm,
        tiltDeg: datum.tiltDeg,
        tiltAxis: datum.tiltAxis,
        planeSnapshot: { origin: w.origin, xAxis: w.xAxis, yAxis: w.yAxis },
      });
    },
    [createSketch]
  );

  // Sketch-on-face: PlanePicker → face-pick mode → click a body face → the
  // worker resolves the planar face → a face-plane sketch (F2). A non-planar
  // pick shows a hint and stays in pick mode.
  const beginFacePick = useCallback(() => {
    setChoosingPlane(false);
    setPickingFace(true);
    setFaceError(null);
  }, []);

  const cancelFacePick = useCallback(() => {
    setPickingFace(false);
    setFaceError(null);
  }, []);

  const pickFace = useCallback(
    (
      bodyId: BodyId,
      point: readonly [number, number, number],
      normal: readonly [number, number, number] | null
    ) => {
      void resolveSketchFace(bodyId, point, normal ?? undefined).then((face) => {
        if (!face) {
          setFaceError(t('sketch.facePickHint'));
          return;
        }
        const fingerprint = `face:${face.fingerprint.centroid.join(',')}:${face.fingerprint.normal.join(',')}:${String(face.fingerprint.areaMm2)}`;
        createSketch({
          kind: 'face',
          fingerprint,
          planeSnapshot: { origin: face.origin, xAxis: face.xAxis, yAxis: face.yAxis },
        });
      });
    },
    [createSketch]
  );

  const finishSketch = useCallback(() => {
    lineStartRef.current = null;
    const current = liveSketch();
    if (!current) return;
    const detection = detectProfiles(current);
    setLastFinish({
      profiles: detection.profiles.length,
      withHoles: detection.profiles.filter((p) => p.inner.length > 0).length,
      open: detection.openEntityIds.length,
    });
    useSessionStore.getState().exitSketch();
  }, [liveSketch]);
  useEffect(() => {
    finishRef.current = finishSketch;
  }, [finishSketch]);

  // Import SVG/DXF reference geometry into the active sketch (#2, ADR-0076):
  // parse to neutral primitives → add as construction (reference) entities via
  // the same AddSketchGeometry path, so every vertex is snappable and each
  // shape is selectable. Warnings surface as a toast.
  // Adds already-chosen primitives to the sketch through the write path, frames
  // them, and reports the outcome. Shared by the direct path and the layer picker.
  const commitImportedPrimitives = useCallback(
    (primitives: readonly ImportPrimitive[], warnings: readonly string[]) => {
      const current = liveSketch();
      if (!current) return;
      if (primitives.length > 0) {
        const plan = new GeometryPlan(current);
        addImportedPrimitives(plan, primitives);
        commandBus.dispatch({
          type: 'AddSketchGeometry',
          payload: { sketchId: current.id, ...plan.payload },
        });
        // Frame the freshly imported geometry (it may be far from the origin /
        // much larger than the current view — e.g. an architectural DXF).
        setFitNonce((n) => n + 1);
      }
      if (warnings.length > 0) {
        pushToast(warnings.join(' '), primitives.length > 0 ? 'info' : 'error');
      } else {
        pushToast(`${t('sketch.import.done')} ${String(primitives.length)}`, 'info');
      }
    },
    [liveSketch]
  );

  const importReference = useCallback(
    (fileName: string, text: string) => {
      const current = liveSketch();
      if (!current) return;
      const { primitives, warnings } = parseReferenceFile(fileName, text);
      const layers = importLayers(primitives);
      // Any DXF (its primitives carry a layer) opens the layer picker so the
      // user chooses what to import (ADR-0088); SVG has no layers and imports
      // straight away.
      const isDxf = primitives.some((p) => p.layer !== undefined);
      if (isDxf && layers.length > 0) {
        setPendingImport({ fileName, primitives, layers, warnings });
        return;
      }
      commitImportedPrimitives(primitives, warnings);
    },
    [liveSketch, commitImportedPrimitives]
  );

  // Layer picker (ADR-0088): commit only the primitives whose source layer the
  // user kept, then close the dialog.
  const confirmImport = useCallback(
    (selected: ReadonlySet<string>) => {
      const pending = pendingImport;
      if (!pending) return;
      const chosen = pending.primitives.filter((p) => selected.has(p.layer ?? ''));
      setPendingImport(null);
      commitImportedPrimitives(chosen, pending.warnings);
    },
    [pendingImport, commitImportedPrimitives]
  );

  const cancelImport = useCallback(() => {
    setPendingImport(null);
  }, []);

  // While the Dim tool is armed, add a live preview annotation from the first
  // point to the cursor so the user sees the measurement before committing.
  const selectedDimSet = new Set<string>(selectedDimensionIds);
  const dimensionRenders: DimensionRender[] = dimensionHits.map((h) =>
    selectedDimSet.has(h.id) ? { ...h.render, selected: true } : h.render
  );
  const overlayDimensions: DimensionRender[] = (() => {
    if (activeTool !== 'dimension' || !dimFirst) return dimensionRenders;
    const src = displaySketch ?? sketch;
    const a = src?.points.find((pt) => pt.id === dimFirst);
    if (!a) return dimensionRenders;
    const preview = dimensionRender(
      {
        id: '' as DimensionId,
        kind: resolveDimensionKind(dimensionKind, vec2(a.x, a.y), effectiveCursor),
        a: dimFirst,
        b: dimFirst,
        offset: DEFAULT_DIMENSION_OFFSET_MM,
      },
      vec2(a.x, a.y),
      effectiveCursor
    );
    return [...dimensionRenders, preview];
  })();

  // A typed start point arms the preview at those coordinates too (not just the
  // commit); each axis reacts as soon as it's typed (#5), the other axis
  // tracking the cursor until filled.
  const typedStart = startPointOf(inputState, effectiveCursor);
  const previewToolState = typedStart ? withStartPoint(toolState, typedStart) : toolState;
  const viewportSketchMode: SketchModeProps | null =
    sketch && basis
      ? {
          basis,
          overlay: {
            entities: evaluated,
            points: (displaySketch ?? sketch).points.map((p) => vec2(p.x, p.y)),
            basis,
            previewCurves: activeTool
              ? toolPreview(previewToolState, effectiveCursor, typedValues)
              : [],
            // While moving geometry, show the DRAG snap/guides (anchored at the
            // grab, moving geometry excluded) so ortho + tracing read live (#2).
            snap: dragBase ? dragSnap.snap : snapResult.snap,
            guides: dragBase ? dragSnap.guides : snapResult.guides,
            selectedEntityIds: new Set(selectedEntityIds),
            dimensions: overlayDimensions,
          },
          // Box-select is available in EVERY tool (#1): a drag rubber-bands
          // shapes; a click still does the tool's action (draw/pick). Stretch
          // and Move capture their point set from the same box.
          selecting: true,
          onMarquee,
          onCursor,
          onClickPoint,
          onPointGrab,
          onPointDrag,
          onPointDrop,
        }
      : null;

  return {
    activeSketch: sketch,
    viewportSketchMode,
    tool: activeTool,
    constructionMode: toolState.constructionMode,
    dimensionKind,
    dimensionArmed: dimFirst !== null,
    setDimensionKind,
    inputState,
    lastFinish,
    choosingPlane,
    pickingFace,
    faceError,
    setTool,
    focusField,
    setFieldText,
    submitInput,
    cancelInput,
    cycleField,
    toggleConstruction,
    deleteSelection,
    hasSelection: selectedEntityIds.length > 0 || selectedDimensionIds.length > 0,
    intersect,
    toggleIntersect,
    projectSection,
    canProjectSection,
    fitNonce,
    newSketch,
    choosePlane,
    sketchOnDatum,
    cancelPlaneChoice,
    beginFacePick,
    cancelFacePick,
    pickFace,
    finishSketch,
    importReference,
    pendingImport,
    confirmImport,
    cancelImport,
    mirrorSelection,
    patternSelection,
    applyOffset,
    applyMove,
    moveArmed: stretch !== null && stretch.pointIds.length > 0,
    mirrorLineAvailable,
  };
}
