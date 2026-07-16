import { useEffect, useMemo } from 'react';
import type { BodyId } from '../core';
import { edgeFingerprintKey } from '../kernel';
import { defaultBodyMeta } from '../document';
import { evaluateSketch, sampleCurve } from '../sketch';
import {
  Viewport,
  VIEW_IDS,
  type BodyStyle,
  type EdgePickProps,
  type ProjectionMode,
  type SketchPreview,
  type ViewId,
} from '../viewport';
import { NumericHud } from './features/sketcher/NumericHud';
import { PlanePicker } from './features/sketcher/PlanePicker';
import { PropertiesPanel } from './features/sketcher/PropertiesPanel';
import { SketchToolbar } from './features/sketcher/SketchToolbar';
import { useSketcher } from './features/sketcher/useSketcher';
import { BrowserTree } from './features/browser/BrowserTree';
import { MeasureHud } from './features/measure/MeasureHud';
import { useMeasure } from './features/measure/useMeasure';
import { DocumentIO } from './features/document-io/DocumentIO';
import { KeyboardShortcuts } from './features/help/KeyboardShortcuts';
import { OnboardingHint } from './features/onboarding/OnboardingHint';
import { loadDocumentText } from './features/document-io/documentIO';
import { ExportStlButton } from './features/timeline/ExportStlButton';
import { OpDialogHost } from './features/timeline/OpDialogHost';
import { TimelineBar } from './features/timeline/TimelineBar';
import { useTimeline } from './features/timeline/useTimeline';
import { t } from './i18n/t';
import { startRegen, useKernelStore } from './store/kernelStore';
import { useDocumentStore } from './store/documentStore';
import { useSessionStore } from './store/sessionStore';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import styles from './App.module.css';
import sketcherStyles from './features/sketcher/Sketcher.module.css';

/** Chord tolerance (mm) for tessellating sketch preview curves into 3D lines. */
const SKETCH_PREVIEW_TOL_MM = 0.1;

export function App(): React.JSX.Element {
  const sketcher = useSketcher();
  const timeline = useTimeline();
  const measure = useMeasure();
  const bodies = useKernelStore((s) => s.bodies);
  const bodyEdges = useKernelStore((s) => s.bodyEdges);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const kernelError = useKernelStore((s) => s.error);

  const edgePicking = useSessionStore((s) => s.edgePicking);
  const edgePickBodyId = useSessionStore((s) => s.edgePickBodyId);
  const pickedEdges = useSessionStore((s) => s.pickedEdges);
  const toggleEdge = useSessionStore((s) => s.toggleEdge);
  const bodyMeta = useDocumentStore((s) => s.document.bodyMeta);
  const sketches = useDocumentStore((s) => s.document.sketches);
  const sketchMeta = useDocumentStore((s) => s.document.sketchMeta);
  const selectedBodyId = useSessionStore((s) => s.selectedBodyId);
  const planeVisibility = useSessionStore((s) => s.planeVisibility);
  const profileHighlight = useSessionStore((s) => s.profileHighlight);
  const setSelectedBody = useSessionStore((s) => s.setSelectedBody);
  const setHelpOpen = useSessionStore((s) => s.setHelpOpen);

  useGlobalShortcuts(sketcher.activeSketch !== null);

  // Boot the worker + RegenScheduler once, on first mount (§4).
  useEffect(() => {
    startRegen();
  }, []);

  const edgePick = useMemo<EdgePickProps | null>(() => {
    if (!edgePicking) return null;
    const scoped = edgePickBodyId
      ? bodyEdges.filter((b) => b.bodyId === edgePickBodyId)
      : bodyEdges;
    return {
      bodyEdges: scoped,
      pickedKeys: new Set(pickedEdges.map(edgeFingerprintKey)),
      onPick: toggleEdge,
    };
  }, [edgePicking, edgePickBodyId, bodyEdges, pickedEdges, toggleEdge]);

  // Committed-sketch previews (Fusion parity): every visible sketch NOT
  // currently being edited draws as 3D reference geometry. The active sketch
  // is excluded — the 2D overlay already renders it. Auto-hidden sketches
  // (consumed by a feature) simply fall out until re-shown from the tree.
  const activeSketchId = sketcher.activeSketch?.id ?? null;
  const sketchPreviews = useMemo<readonly SketchPreview[]>(() => {
    const previews: SketchPreview[] = [];
    for (const sketch of sketches) {
      if (sketch.plane.kind !== 'origin' || sketch.id === activeSketchId) continue;
      const meta = sketchMeta.find((m) => m.id === sketch.id);
      if (meta && !meta.visible) continue; // hidden; default (no entry) is visible
      const polylines = evaluateSketch(sketch).map((entity) => {
        const points = [...sampleCurve(entity.curve, SKETCH_PREVIEW_TOL_MM)];
        // Close full circles so the preview reads as a loop, not an arc.
        if (entity.curve.kind === 'circle' && points[0]) points.push(points[0]);
        return points;
      });
      previews.push({ sketchId: sketch.id, plane: sketch.plane.plane, polylines });
    }
    return previews;
  }, [sketches, sketchMeta, activeSketchId]);

  // Translated labels for the standard view buttons (F11).
  const viewLabels = useMemo<Partial<Record<ViewId, string>>>(() => {
    const labels: Partial<Record<ViewId, string>> = {};
    for (const id of VIEW_IDS) labels[id] = t(`view.${id}`);
    return labels;
  }, []);

  // Translated labels for the perspective/orthographic toggle (F11).
  const projectionLabels = useMemo<Record<ProjectionMode, string>>(
    () => ({
      perspective: t('view.projection.perspective'),
      orthographic: t('view.projection.orthographic'),
    }),
    []
  );

  // Per-body colour/visibility/selection for the viewport (F8). Depends on
  // metadata + selection only, so sketch edits don't rebuild body meshes.
  const bodyStyles = useMemo<ReadonlyMap<BodyId, BodyStyle>>(() => {
    const map = new Map<BodyId, BodyStyle>();
    for (const id of liveBodyIds) {
      const meta = bodyMeta.find((m) => m.id === id) ?? defaultBodyMeta(id);
      map.set(id, { color: meta.color, visible: meta.visible, selected: id === selectedBodyId });
    }
    return map;
  }, [bodyMeta, liveBodyIds, selectedBodyId]);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('app.title')}</h1>
      </header>
      <main
        className={styles.viewportArea}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (!file) return;
          void file.text().then((text) => {
            const error = loadDocumentText(text);
            if (error !== null) window.alert(`${t('io.loadError')} ${error}`);
          });
        }}
      >
        <Viewport
          zoomToFitLabel={t('viewport.zoomToFit')}
          viewLabels={viewLabels}
          projectionLabels={projectionLabels}
          bodies={bodies}
          sketchMode={sketcher.viewportSketchMode}
          edgePick={edgePick}
          measure={measure.measureProps}
          bodyStyles={bodyStyles}
          planeVisibility={planeVisibility}
          sketchPreviews={sketchPreviews}
          opHighlight={profileHighlight}
          onSelectBody={setSelectedBody}
          facePick={sketcher.pickingFace ? { onPick: sketcher.pickFace } : null}
        />
        {sketcher.activeSketch ? (
          <>
            <SketchToolbar sketcher={sketcher} />
            <NumericHud input={sketcher.inputState} />
            <PropertiesPanel sketch={sketcher.activeSketch} />
          </>
        ) : (
          <>
            {!sketcher.choosingPlane && !sketcher.pickingFace && <OnboardingHint />}
            <BrowserTree />
            {sketcher.choosingPlane && (
              <PlanePicker
                onChoose={sketcher.choosePlane}
                onPickFace={sketcher.beginFacePick}
                onCancel={sketcher.cancelPlaneChoice}
              />
            )}
            {sketcher.pickingFace && (
              <div className={sketcherStyles.summary} data-testid="face-pick-hint">
                {sketcher.faceError ?? t('sketch.facePickHint')}{' '}
                <button
                  type="button"
                  className={sketcherStyles.button}
                  onClick={sketcher.cancelFacePick}
                >
                  {t('dialog.cancel')}
                </button>
              </div>
            )}
            <div
              className={sketcherStyles.toolbar}
              style={{ left: 'auto', right: 'var(--grid-unit)' }}
            >
              <button type="button" className={sketcherStyles.button} onClick={sketcher.newSketch}>
                {t('sketch.newSketch')}
              </button>
              <button
                type="button"
                className={
                  measure.active
                    ? `${sketcherStyles.button ?? ''} ${sketcherStyles.buttonActive ?? ''}`
                    : (sketcherStyles.button ?? '')
                }
                onClick={measure.toggle}
              >
                {t('measure.toggle')}
              </button>
              <DocumentIO />
              <ExportStlButton />
              <button
                type="button"
                className={sketcherStyles.button}
                data-testid="shortcuts-open"
                onClick={() => {
                  setHelpOpen(true);
                }}
              >
                {t('help.open')}
              </button>
              <span className={sketcherStyles.button} data-testid="body-count">
                {liveBodyIds.length}
              </span>
              {kernelError && (
                <span className={sketcherStyles.summary}>
                  {t('kernel.status.error')} {kernelError}
                </span>
              )}
            </div>
            {sketcher.lastFinish && (
              <div className={sketcherStyles.summary} data-testid="finish-summary">
                {t('sketch.summary.profiles')} {sketcher.lastFinish.profiles}{' '}
                {t('sketch.summary.withHoles')} {sketcher.lastFinish.withHoles}{' '}
                {t('sketch.summary.open')} {sketcher.lastFinish.open}
              </div>
            )}
            {measure.active && <MeasureHud result={measure.result} />}
            <TimelineBar timeline={timeline} />
            <OpDialogHost timeline={timeline} />
          </>
        )}
        <KeyboardShortcuts />
      </main>
    </div>
  );
}
