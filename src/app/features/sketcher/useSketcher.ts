import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createId,
  vec2,
  DEG_TO_RAD,
  type BodyId,
  type DimensionId,
  type EntityId,
  type PointId,
  type Vec2,
} from '../../../core';
import {
  findSketch,
  type Sketch,
  type SketchDimensionKind,
  type SketchPlaneRef,
} from '../../../document';
import {
  detectProfiles,
  dimensionRender,
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
import { type SketchModeProps } from '../../../viewport';
import { sketchPlaneBasis } from './planeBasis';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { resolveSketchFace } from '../../store/kernelStore';
import { useSessionStore } from '../../store/sessionStore';
import { t } from '../../i18n/t';
import { GeometryPlan } from './geometryPlan';
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

/** Snap tolerance in screen pixels — converted to mm per query (R11). */
const SNAP_TOLERANCE_PX = 12;
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

export interface SketcherApi {
  readonly activeSketch: Sketch | null;
  readonly viewportSketchMode: SketchModeProps | null;
  readonly tool: SketchToolId | null;
  readonly constructionMode: boolean;
  /** Which reference-dimension kind the Dim tool will create (F2). */
  readonly dimensionKind: SketchDimensionKind;
  /** True once the Dim tool has its first point and is awaiting the second. */
  readonly dimensionArmed: boolean;
  readonly setDimensionKind: (kind: SketchDimensionKind) => void;
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
  readonly toggleConstruction: () => void;
  readonly newSketch: () => void;
  readonly choosePlane: (plane: SketchPlaneChoice) => void;
  readonly cancelPlaneChoice: () => void;
  readonly beginFacePick: () => void;
  readonly cancelFacePick: () => void;
  readonly pickFace: (bodyId: BodyId, point: readonly [number, number, number]) => void;
  readonly finishSketch: () => void;
}

export function useSketcher(): SketcherApi {
  const document = useDocumentStore((s) => s.document);
  const activeSketchId = useSessionStore((s) => s.activeSketchId);
  const activeTool = useSessionStore((s) => s.activeTool);
  const snapEnabled = useSessionStore((s) => s.snapEnabled);
  const selectedEntityIds = useSessionStore((s) => s.selectedEntityIds);

  const sketch = activeSketchId ? (findSketch(document, activeSketchId) ?? null) : null;

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
  const [inputState, setInputState] = useState<NumericInputState>(() =>
    initialInputState(fieldsForToolWithStart('line'))
  );
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
  const [dimensionKind, setDimensionKindState] = useState<SketchDimensionKind>('linear');
  const dimensionKindRef = useRef(dimensionKind);
  useEffect(() => {
    dimensionKindRef.current = dimensionKind;
  }, [dimensionKind]);
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
    const out: DimensionRender[] = [];
    for (const dim of src.dimensions) {
      const a = byId.get(dim.a);
      const b = byId.get(dim.b);
      if (a && b) out.push(dimensionRender(dim, vec2(a.x, a.y), vec2(b.x, b.y)));
    }
    return out;
  }, [displaySketch, sketch]);

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
    });
  }, [sketch, evaluated, cursor, pxPerMm, snapEnabled, ctrlHeld, toolState]);

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
      setToolState(step.state);
      // Fields track the tool's chain state (chained Line gains angleRel);
      // each step starts the next entry fresh, matching the machine's Enter reset.
      setInputState(
        initialInputState(fieldsForToolWithStart(step.state.tool, isChained(step.state)))
      );
    },
    [liveSketch]
  );

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
        // Select / Change: a click that didn't grab a point picks the nearest
        // entity within tolerance (Change then shows its points in Properties).
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
        useSessionStore.getState().setSelection(bestId ? [bestId] : []);
        return;
      }
      if (tool === 'dimension') {
        // Reference dimensions annotate two existing pool points: each click must
        // land on a point (snap-assisted). First click arms; second commits.
        const tolMm = SNAP_TOLERANCE_PX / Math.max(scale, 1e-6);
        const picked = nearestPointId(current.points, snapResult.snap?.point ?? p, tolMm);
        if (!picked) return;
        const first = dimFirstRef.current;
        if (!first) {
          setDimFirst(picked);
          return;
        }
        if (first === picked) return;
        const existing = new Set<string>(current.dimensions.map((d) => d.id));
        const dimensionId = createId<'DimensionId'>(existing);
        commandBus.dispatch({
          type: 'AddSketchDimension',
          payload: {
            sketchId: current.id,
            dimension: {
              id: dimensionId,
              kind: dimensionKindRef.current,
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

  const setTool = useCallback((tool: SketchToolId | null) => {
    useSessionStore.getState().setActiveTool(tool);
    setDimFirst(null); // leaving/entering a tool cancels a half-placed dimension
    if (tool) {
      setToolState((prev) => ({
        ...initialToolState(tool),
        constructionMode: prev.constructionMode,
      }));
      setInputState(initialInputState(fieldsForToolWithStart(tool, false)));
    }
  }, []);

  const setDimensionKind = useCallback((kind: SketchDimensionKind) => {
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
        // Transition computed OUTSIDE the setState updater — updaters are
        // pure and may be double-invoked (StrictMode); dispatch is not.
        const before = inputStateRef.current;
        const t = reduceInput(before, { type: 'enter' });
        setInputState(t.state);
        if (t.effect.kind === 'commit') {
          // The last two fields are startX/startY: a typed start point is
          // injected as the tool's first anchor; the rest feed toolEnter as
          // before (positional shape values).
          const start = startPointOf(before);
          const shapeValues = t.effect.values.slice(0, before.fields.length - START_FIELD_COUNT);
          const armed = start ? withStartPoint(toolState, start) : toolState;
          applyStep(toolEnter(armed, shapeValues, effectiveCursor));
        }
        return;
      }
      if (event.key === 'Escape') {
        const cleared = toolEscape(toolState);
        setToolState(cleared);
        setInputState(initialInputState(fieldsForToolWithStart(cleared.tool, false)));
        setDimFirst(null); // also cancel a half-placed dimension
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
  }, [sketch, toolState, effectiveCursor, applyStep, setTool]);

  // --- Public API ------------------------------------------------------------
  const focusField = useCallback((index: number) => {
    setInputState((s) => reduceInput(s, { type: 'focus', index }).state);
  }, []);

  const toggleConstruction = useCallback(() => {
    setToolState((s) => setConstructionMode(s, !s.constructionMode));
  }, []);

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
      setToolState(initialToolState('line'));
      setInputState(initialInputState(fieldsForToolWithStart('line', false)));
    }
  }, []);

  const choosePlane = useCallback(
    (plane: SketchPlaneChoice) => {
      createSketch({ kind: 'origin', plane });
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
        kind: dimensionKind,
        a: dimFirst,
        b: dimFirst,
        offset: DEFAULT_DIMENSION_OFFSET_MM,
      },
      vec2(a.x, a.y),
      effectiveCursor
    );
    return [...dimensionRenders, preview];
  })();

  const basis = sketch ? sketchPlaneBasis(sketch) : null;
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
    toggleConstruction,
    newSketch,
    choosePlane,
    cancelPlaneChoice,
    beginFacePick,
    cancelFacePick,
    pickFace,
    finishSketch,
  };
}
