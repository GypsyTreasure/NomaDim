import { useEffect, useMemo } from 'react';
import type { BodyId } from '../core';
import { edgeFingerprintKey } from '../kernel';
import { defaultBodyMeta } from '../document';
import { Viewport, type BodyStyle, type EdgePickProps } from '../viewport';
import { NumericHud } from './features/sketcher/NumericHud';
import { PropertiesPanel } from './features/sketcher/PropertiesPanel';
import { SketchToolbar } from './features/sketcher/SketchToolbar';
import { useSketcher } from './features/sketcher/useSketcher';
import { BrowserTree } from './features/browser/BrowserTree';
import { MeasureHud } from './features/measure/MeasureHud';
import { useMeasure } from './features/measure/useMeasure';
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
  const selectedBodyId = useSessionStore((s) => s.selectedBodyId);
  const planeVisibility = useSessionStore((s) => s.planeVisibility);
  const setSelectedBody = useSessionStore((s) => s.setSelectedBody);

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
      <main className={styles.viewportArea}>
        <Viewport
          zoomToFitLabel={t('viewport.zoomToFit')}
          bodies={bodies}
          sketchMode={sketcher.viewportSketchMode}
          edgePick={edgePick}
          measure={measure.measureProps}
          bodyStyles={bodyStyles}
          planeVisibility={planeVisibility}
          onSelectBody={setSelectedBody}
        />
        {sketcher.activeSketch ? (
          <>
            <SketchToolbar sketcher={sketcher} />
            <NumericHud input={sketcher.inputState} />
            <PropertiesPanel sketch={sketcher.activeSketch} />
          </>
        ) : (
          <>
            <BrowserTree />
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
              <ExportStlButton />
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
      </main>
    </div>
  );
}
