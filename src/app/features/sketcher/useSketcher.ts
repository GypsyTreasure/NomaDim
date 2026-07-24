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
  type Sketch,
  type SketchDimensionKind,
  type SketchPlaneRef,
} from '../../../document';
import {
  detectProfiles,
  dimensionRender,
  dimensionEndpoints,
  mirrorEntities,
  patternEntities,
  distanceToCurve,
  evaluateSketch,
  fieldsForToolWithStart,
  initialInputState,
  parseField,
  parsedValues,
  reduceInput,
  DEFAULT_DIMENSION_OFFSET_MM,
  SnapEngine,
  type DimensionRender,
  type NumericInputState,
  type SnapResult,
  type SketchToolId,
} from '../../../sketch';
import { sectionPlanePoints, type SketchModeProps } from '../../../viewport';
import { sketchPlaneBasis } from './planeBasis';
import { commandBus, useDocumentStore } from '../../store/documentStore';
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
  toolEscape,
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

/** The typed start point (the last two coord fields), or null if either is unset. */
function startPointOf(state: NumericInputState): Vec2 | null {
  const n = state.fields.length;
  const xDef = state.fields[n - 2];
  const yDef = state.fields[n - 1];
  if (xDef?.id !== 'startX' || yDef?.id !== 'startY') return null;
  const x = parseField(xDef, state.values[n - 2] ?? '');
  const y = parseField(yDef, state.values[n - 1] ?? '');
  return x !== null && y !== null ? vec2(x, y) : null;
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
  readonly pickFace: (bodyId: BodyId, point: readonly [number, number, number]) => void;
  readonly finishSketch: () => void;
  /** Delete the currently selected sketch entities (touch affordance for the Delete key). */
  readonly deleteSelection: () => void;
  /** Mirror the selected entities across the sketch X/Y axis or a selected line (#2). */
  readonly mirrorSelection: (axis: MirrorAxis) => void;
  /** Array the selected entities linearly or circularly (#2). */
  readonly patternSelection: (spec: SketchPatternInput) => void;
  /** True when one or more sketch entities are selected. */
  readonly hasSelection: boolean;
  /** True when exactly one selected entity is a line (enables Mirror-across-line). */
  readonly mirrorLineAvailable: boolean;
  /** Intersect view (#1): clip the near half of bodies + show the plane section. */
  readonly intersect: boolean;
  readonly toggleIntersect: () => void;
}

export function useSketcher(): SketcherApi {
  const document = useDocumentStore((s) => s.document);
  const activeSketchId = useSessionStore((s) => s.activeSketchId);
  const activeTool = useSessionStore((s) => s.activeTool);
  const snapEnabled = useSessionStore((s) => s.snapEnabled);
  const selectedEntityIds = useSessionStore((s) => s.selectedEntityIds);

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
  const [cursor, setCursor] = useState<Vec2>(() => vec2(0, 0));
  const [pxPerMm, setPxPerMm] = useState(1);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [lastFinish, setLastFinish] = useState<FinishSummary | null>(null);
  const [choosingPlane, setChoosingPlane] = useState(false);
  const [pickingFace, setPickingFace] = useState(false);
  const [faceError, setFaceError] = useState<string | null>(null);
  // Change tool: the point currently being dragged + its live position.
  const [drag, setDrag] = useState<{ pointId: PointId; pos: Vec2 } | null>(null);
  const dragRef = useRef(drag);
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  // Dim tool: the chosen dimension kind + the first picked point (awaiting the
  // second). Both are read via refs inside the stable click callback.
  const [dimensionKind, setDimensionKindState] = useState<DimensionToolKind>('auto');
  const dimensionKindRef = useRef(dimensionKind);
  useEffect(() => {
    dimensionKindRef.current = dimensionKind;
  }, [dimensionKind]);
  // Intersect view (#1): clip the near body half + show the plane section.
  const [intersect, setIntersect] = useState(false);
  const [dimFirst, setDimFirst] = useState<PointId | null>(null);
  const dimFirstRef = useRef(dimFirst);
  useEffect(() => {
    dimFirstRef.current = dimFirst;
  }, [dimFirst]);

  // While dragging (Change tool), render the sketch with the grabbed point
  // moved to its live position; the command only fires on drop.
  const displaySketch = useMemo(() => {
    if (!sketch || !drag) return sketch;
    return {
      ...sketch,
      points: sketch.points.map((pt) =>
        pt.id === drag.pointId ? { ...pt, x: drag.pos.x, y: drag.pos.y } : pt
      ),
    };
  }, [sketch, drag]);

  const evaluated = useMemo(
    () => (displaySketch ? evaluateSketch(displaySketch) : []),
    [displaySketch]
  );

  // Reference-dimension geometry, measured live from the (possibly dragged)
  // point positions so annotations track the geometry (associative, ADR-0002).
  const dimensionRenders = useMemo<DimensionRender[]>(() => {
    const src = displaySketch ?? sketch;
    if (!src) return [];
    const byId = new Map(src.points.map((pt) => [pt.id, pt]));
    const entById = new Map(src.entities.map((e) => [e.id, e]));
    const pointPos = (id: PointId): Vec2 | undefined => {
      const pt = byId.get(id);
      return pt ? vec2(pt.x, pt.y) : undefined;
    };
    const out: DimensionRender[] = [];
    for (const dim of src.dimensions) {
      const ends = dimensionEndpoints(dim, pointPos, (id) => entById.get(id));
      if (ends) out.push(dimensionRender(dim, ends[0], ends[1]));
    }
    return out;
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

  const snapResult: SnapResult = useMemo(() => {
    if (!sketch || !snapEnabled || ctrlHeld) return { snap: null, guides: [] };
    return snapEngine.query({
      sketch,
      evaluated,
      cursor,
      toleranceMm: SNAP_TOLERANCE_PX / Math.max(pxPerMm, 1e-6),
      angularToleranceRad: ANGULAR_TOLERANCE_RAD,
      gridSpacingMm: GRID_SPACING_MM,
      anchor: toolState.chainAnchor?.p ?? toolState.clicks[toolState.clicks.length - 1]?.p,
      extraSnapPoints: sectionSnapPoints,
    });
  }, [sketch, evaluated, cursor, pxPerMm, snapEnabled, ctrlHeld, toolState, sectionSnapPoints]);

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
    if (useSessionStore.getState().activeTool === null) return;
    const before = inputStateRef.current;
    const transition = reduceInput(before, { type: 'enter' });
    setInputState(transition.state);
    if (transition.effect.kind === 'commit') {
      const start = startPointOf(before);
      const shapeValues = transition.effect.values.slice(
        0,
        before.fields.length - START_FIELD_COUNT
      );
      const armed = start ? withStartPoint(toolState, start) : toolState;
      applyStep(toolEnter(armed, shapeValues, effectiveCursor));
    }
  }, [applyStep, toolState, effectiveCursor]);

  const cancelInput = useCallback(() => {
    const cleared = toolEscape(toolState);
    setToolState(cleared);
    setInputState(initialInputState(fieldsForToolWithStart(cleared.tool, false)));
    setDimFirst(null);
  }, [toolState]);

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
      const snap = snapResult.snap;
      const spec =
        snap?.sourceRef.type === 'point'
          ? { p: snap.point, existing: snap.sourceRef.pointId }
          : { p: snap?.point ?? p };
      applyStep(toolClick(toolState, spec));
    },
    [applyStep, liveSketch, snapResult, toolState]
  );

  // --- Change tool point drag (F2) -----------------------------------------
  const onPointGrab = useCallback(
    (p: Vec2, scale: number): boolean => {
      if (useSessionStore.getState().activeTool !== 'change') return false;
      const current = liveSketch();
      if (!current) return false;
      const tolMm = SNAP_TOLERANCE_PX / Math.max(scale, 1e-6);
      const pointId = nearestPointId(current.points, p, tolMm);
      if (!pointId) return false;
      setDrag({ pointId, pos: p });
      return true;
    },
    [liveSketch]
  );

  const onPointDrag = useCallback((p: Vec2) => {
    setDrag((d) => (d ? { ...d, pos: p } : d));
  }, []);

  const onPointDrop = useCallback(() => {
    const d = dragRef.current;
    const current = liveSketch();
    if (d && current) {
      commandBus.dispatch({
        type: 'MoveSketchPoints',
        payload: { sketchId: current.id, moves: [{ pointId: d.pointId, x: d.pos.x, y: d.pos.y }] },
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
      if (event.key === 'f' || event.key === 'F') {
        finishRef.current();
        return;
      }
      if (event.key === 'j' || event.key === 'J') {
        setIntersect((v) => !v); // Intersect view toggle (#1, ADR-0032)
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
        m: 'change',
        d: 'dimension',
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

  const toggleConstruction = useCallback(() => {
    setToolState((s) => setConstructionMode(s, !s.constructionMode));
  }, []);

  const toggleIntersect = useCallback(() => {
    setIntersect((v) => !v);
  }, []);

  const deleteSelection = useCallback(() => {
    const current = liveSketch();
    const session = useSessionStore.getState();
    if (!current || session.selectedEntityIds.length === 0) return;
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
      const datum = getDatum(useDocumentStore.getState().document, datumId);
      if (!datum || !isDatumPlane(datum)) return;
      const w = datumPlaneWorld(datum);
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
    (bodyId: BodyId, point: readonly [number, number, number]) => {
      void resolveSketchFace(bodyId, point).then((face) => {
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

  // While the Dim tool is armed, add a live preview annotation from the first
  // point to the cursor so the user sees the measurement before committing.
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

  // A typed start point arms the preview at those coordinates too (not just the commit).
  const typedStart = startPointOf(inputState);
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
            snap: snapResult.snap,
            guides: snapResult.guides,
            selectedEntityIds: new Set(selectedEntityIds),
            dimensions: overlayDimensions,
          },
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
    hasSelection: selectedEntityIds.length > 0,
    intersect,
    toggleIntersect,
    newSketch,
    choosePlane,
    sketchOnDatum,
    cancelPlaneChoice,
    beginFacePick,
    cancelFacePick,
    pickFace,
    finishSketch,
    mirrorSelection,
    patternSelection,
    mirrorLineAvailable,
  };
}
