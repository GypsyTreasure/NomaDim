import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createId, vec2, DEG_TO_RAD, type EntityId, type Vec2 } from '../../../core';
import { findSketch, type Sketch } from '../../../document';
import {
  detectProfiles,
  distanceToCurve,
  evaluateSketch,
  fieldsForTool,
  initialInputState,
  parsedValues,
  reduceInput,
  SnapEngine,
  type NumericInputState,
  type SnapResult,
  type SketchToolId,
} from '../../../sketch';
import type { SketchModeProps } from '../../../viewport';
import { commandBus, useDocumentStore } from '../../store/documentStore';
import { useSessionStore } from '../../store/sessionStore';
import { GeometryPlan } from './geometryPlan';
import {
  initialToolState,
  isChained,
  setConstructionMode,
  toolClick,
  toolEnter,
  toolEscape,
  toolPreview,
  type ToolState,
} from './toolLogic';

/** Snap tolerance in screen pixels — converted to mm per query (R11). */
const SNAP_TOLERANCE_PX = 12;
const ANGULAR_TOLERANCE_RAD = 2 * DEG_TO_RAD;
const GRID_SPACING_MM = 1;

const snapEngine = new SnapEngine();

export interface FinishSummary {
  readonly profiles: number;
  readonly withHoles: number;
  readonly open: number;
}

export interface SketcherApi {
  readonly activeSketch: Sketch | null;
  readonly viewportSketchMode: SketchModeProps | null;
  readonly tool: SketchToolId | null;
  readonly constructionMode: boolean;
  readonly inputState: NumericInputState;
  readonly lastFinish: FinishSummary | null;
  readonly setTool: (tool: SketchToolId | null) => void;
  readonly toggleConstruction: () => void;
  readonly newSketch: () => void;
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
    initialInputState(fieldsForTool('line'))
  );
  const inputStateRef = useRef(inputState);
  useEffect(() => {
    inputStateRef.current = inputState;
  }, [inputState]);
  const [cursor, setCursor] = useState<Vec2>(() => vec2(0, 0));
  const [pxPerMm, setPxPerMm] = useState(1);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [lastFinish, setLastFinish] = useState<FinishSummary | null>(null);

  const evaluated = useMemo(() => (sketch ? evaluateSketch(sketch) : []), [sketch]);

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
      setInputState(initialInputState(fieldsForTool(step.state.tool, isChained(step.state))));
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
      if (!tool) {
        // Select mode: pick the nearest entity within tolerance.
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
      const snap = snapResult.snap;
      const spec =
        snap?.sourceRef.type === 'point'
          ? { p: snap.point, existing: snap.sourceRef.pointId }
          : { p: snap?.point ?? p };
      applyStep(toolClick(toolState, spec));
    },
    [applyStep, liveSketch, snapResult, toolState]
  );

  const setTool = useCallback((tool: SketchToolId | null) => {
    useSessionStore.getState().setActiveTool(tool);
    if (tool) {
      setToolState((prev) => ({
        ...initialToolState(tool),
        constructionMode: prev.constructionMode,
      }));
      setInputState(initialInputState(fieldsForTool(tool, false)));
    }
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
        const t = reduceInput(inputStateRef.current, { type: 'enter' });
        setInputState(t.state);
        if (t.effect.kind === 'commit') {
          applyStep(toolEnter(toolState, t.effect.values, effectiveCursor));
        }
        return;
      }
      if (event.key === 'Escape') {
        const cleared = toolEscape(toolState);
        setToolState(cleared);
        setInputState(initialInputState(fieldsForTool(cleared.tool, false)));
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
      const toolHotkeys: Record<string, SketchToolId> = {
        l: 'line',
        r: 'rectangle-2p',
        c: 'circle-center-diameter',
        a: 'arc-3p',
        p: 'point',
        g: 'polygon',
      };
      const hotkey = toolHotkeys[event.key.toLowerCase()];
      if (hotkey && !event.ctrlKey && !event.metaKey) {
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
  const toggleConstruction = useCallback(() => {
    setToolState((s) => setConstructionMode(s, !s.constructionMode));
  }, []);

  const newSketch = useCallback(() => {
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
      payload: {
        sketchId,
        opId,
        name: `Sketch${String(doc.sketches.length + 1)}`,
        plane: { kind: 'origin', plane: 'XY' },
      },
    });
    if (result.ok) {
      useSessionStore.getState().enterSketch(sketchId);
      setLastFinish(null);
      setToolState(initialToolState('line'));
      setInputState(initialInputState(fieldsForTool('line', false)));
    }
  }, []);

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

  const plane = sketch?.plane.kind === 'origin' ? sketch.plane.plane : 'XY';
  const viewportSketchMode: SketchModeProps | null = sketch
    ? {
        plane,
        overlay: {
          entities: evaluated,
          points: sketch.points.map((p) => vec2(p.x, p.y)),
          plane,
          previewCurves: activeTool ? toolPreview(toolState, effectiveCursor, typedValues) : [],
          snap: snapResult.snap,
          guides: snapResult.guides,
          selectedEntityIds: new Set(selectedEntityIds),
        },
        onCursor,
        onClickPoint,
      }
    : null;

  return {
    activeSketch: sketch,
    viewportSketchMode,
    tool: activeTool,
    constructionMode: toolState.constructionMode,
    inputState,
    lastFinish,
    setTool,
    toggleConstruction,
    newSketch,
    finishSketch,
  };
}
