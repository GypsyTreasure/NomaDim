import { useEffect } from 'react';
import { Viewport } from '../viewport';
import { NumericHud } from './features/sketcher/NumericHud';
import { PropertiesPanel } from './features/sketcher/PropertiesPanel';
import { SketchToolbar } from './features/sketcher/SketchToolbar';
import { useSketcher } from './features/sketcher/useSketcher';
import { ExportStlButton } from './features/timeline/ExportStlButton';
import { OpDialogHost } from './features/timeline/OpDialogHost';
import { TimelineBar } from './features/timeline/TimelineBar';
import { useTimeline } from './features/timeline/useTimeline';
import { t } from './i18n/t';
import { startRegen, useKernelStore } from './store/kernelStore';
import styles from './App.module.css';
import sketcherStyles from './features/sketcher/Sketcher.module.css';

export function App(): React.JSX.Element {
  const sketcher = useSketcher();
  const timeline = useTimeline();
  const bodies = useKernelStore((s) => s.bodies);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const kernelError = useKernelStore((s) => s.error);

  // Boot the worker + RegenScheduler once, on first mount (§4).
  useEffect(() => {
    startRegen();
  }, []);

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
        />
        {sketcher.activeSketch ? (
          <>
            <SketchToolbar sketcher={sketcher} />
            <NumericHud input={sketcher.inputState} />
            <PropertiesPanel sketch={sketcher.activeSketch} />
          </>
        ) : (
          <>
            <div className={sketcherStyles.toolbar}>
              <button type="button" className={sketcherStyles.button} onClick={sketcher.newSketch}>
                {t('sketch.newSketch')}
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
            <TimelineBar timeline={timeline} />
            <OpDialogHost timeline={timeline} />
          </>
        )}
      </main>
    </div>
  );
}
