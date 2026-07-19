import { useEffect, useMemo, useRef, useState } from 'react';
import type { BodyId } from '../core';
import { edgeFingerprintKey } from '../kernel';
import { defaultBodyMeta } from '../document';
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
import { buildSketchPreviews } from './features/sketcher/sketchPreviews';
import { Logo } from './features/brand/Logo';
import { BrowserTree } from './features/browser/BrowserTree';
import { MeasureHud } from './features/measure/MeasureHud';
import { useMeasure } from './features/measure/useMeasure';
import { DocumentIO } from './features/document-io/DocumentIO';
import { KeyboardShortcuts } from './features/help/KeyboardShortcuts';
import { OnboardingHint } from './features/onboarding/OnboardingHint';
import { useModelingShortcuts } from './features/shortcuts/useModelingShortcuts';
import { loadDocumentText } from './features/document-io/documentIO';
import { restorePersistedDocument, startAutosave } from './features/persistence/autosave';
import { NewProjectButton } from './features/persistence/NewProjectButton';
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
  // Mobile hamburger: whether the app-action cluster is expanded (ignored on
  // desktop, where the cluster is always shown inline).
  const [actionsOpen, setActionsOpen] = useState(false);
  const appBarRef = useRef<HTMLDivElement>(null);

  // Tapping outside the app bar closes the menu — but NOT on item clicks, so a
  // dialog opened from the menu (e.g. New Project) keeps the menu open while
  // the decision is made (the dialog's scrim lives inside the app bar subtree).
  useEffect(() => {
    if (!actionsOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (appBarRef.current && !appBarRef.current.contains(event.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [actionsOpen]);

  useGlobalShortcuts(sketcher.activeSketch !== null);
  useModelingShortcuts(sketcher.activeSketch === null, {
    newSketch: sketcher.newSketch,
    toggleMeasure: measure.toggle,
    createOp: timeline.openCreate,
    hasSketch: sketches.length > 0,
  });

  // Restore the autosaved document, boot the worker + RegenScheduler, then keep
  // autosaving — once, on first mount (§4). Restore runs BEFORE startRegen so
  // the scheduler's initial regen rebuilds bodies from the restored timeline.
  useEffect(() => {
    restorePersistedDocument();
    startRegen();
    return startAutosave();
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
  const sketchPreviews = useMemo<readonly SketchPreview[]>(
    () => buildSketchPreviews(sketches, sketchMeta, activeSketchId),
    [sketches, sketchMeta, activeSketchId]
  );

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
        <h1 className={styles.title}>
          <Logo />
        </h1>
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
            <NumericHud
              input={sketcher.inputState}
              onFocus={sketcher.focusField}
              onChangeField={sketcher.setFieldText}
              onSubmit={sketcher.submitInput}
              onCancel={sketcher.cancelInput}
              onCycle={sketcher.cycleField}
            />
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
            <div className={sketcherStyles.appBar} ref={appBarRef}>
              {/* New Sketch is the primary entry point — always visible, never
                  collapsed behind the hamburger. */}
              <button
                type="button"
                className={`${sketcherStyles.button ?? ''} ${sketcherStyles.primaryAction ?? ''}`}
                title="N"
                onClick={sketcher.newSketch}
              >
                {t('sketch.newSketch')}
              </button>
              <button
                type="button"
                className={sketcherStyles.menuToggle}
                aria-label={t('menu.toggle')}
                aria-expanded={actionsOpen}
                data-testid="app-menu-toggle"
                onClick={() => {
                  setActionsOpen((open) => !open);
                }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    d="M3 5h14M3 10h14M3 15h14"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <div
                className={`${sketcherStyles.menuPanel ?? ''} ${
                  actionsOpen ? (sketcherStyles.menuPanelOpen ?? '') : ''
                }`}
                data-testid="app-actions"
              >
                <button
                  type="button"
                  title="M"
                  className={
                    measure.active
                      ? `${sketcherStyles.button ?? ''} ${sketcherStyles.buttonActive ?? ''}`
                      : (sketcherStyles.button ?? '')
                  }
                  onClick={measure.toggle}
                >
                  {t('measure.toggle')}
                </button>
                <NewProjectButton />
                <DocumentIO />
                <ExportStlButton />
                <button
                  type="button"
                  className={sketcherStyles.button}
                  title="?"
                  data-testid="shortcuts-open"
                  onClick={() => {
                    setHelpOpen(true);
                  }}
                >
                  {t('help.openButton')}
                </button>
                {kernelError && (
                  <span className={sketcherStyles.summary}>
                    {t('kernel.status.error')} {kernelError}
                  </span>
                )}
              </div>
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
