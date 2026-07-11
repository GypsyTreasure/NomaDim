import { Viewport } from '../viewport';
import { KernelDemoPanel } from './features/kernelDemo/KernelDemoPanel';
import { useKernelDemo } from './features/kernelDemo/useKernelDemo';
import { NumericHud } from './features/sketcher/NumericHud';
import { PropertiesPanel } from './features/sketcher/PropertiesPanel';
import { SketchToolbar } from './features/sketcher/SketchToolbar';
import { useSketcher } from './features/sketcher/useSketcher';
import { t } from './i18n/t';
import styles from './App.module.css';
import sketcherStyles from './features/sketcher/Sketcher.module.css';

export function App(): React.JSX.Element {
  const kernelDemo = useKernelDemo();
  const sketcher = useSketcher();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('app.title')}</h1>
      </header>
      <main className={styles.viewportArea}>
        <Viewport
          zoomToFitLabel={t('viewport.zoomToFit')}
          bodies={kernelDemo.bodies}
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
            </div>
            {sketcher.lastFinish && (
              <div className={sketcherStyles.summary} data-testid="finish-summary">
                {t('sketch.summary.profiles')} {sketcher.lastFinish.profiles}{' '}
                {t('sketch.summary.withHoles')} {sketcher.lastFinish.withHoles}{' '}
                {t('sketch.summary.open')} {sketcher.lastFinish.open}
              </div>
            )}
            <KernelDemoPanel {...kernelDemo} />
          </>
        )}
      </main>
    </div>
  );
}
