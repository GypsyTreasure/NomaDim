import type { SketchToolId } from '../../../sketch';
import { t } from '../../i18n/t';
import { useSessionStore } from '../../store/sessionStore';
import type { SketcherApi } from './useSketcher';
import styles from './Sketcher.module.css';

const TOOLS: readonly SketchToolId[] = [
  'line',
  'axis',
  'rectangle-2p',
  'rectangle-center',
  'circle-center-diameter',
  'arc-3p',
  'arc-center',
  'point',
  'polygon',
];

const TOOL_LABEL_KEYS = {
  line: 'sketch.tool.line',
  axis: 'sketch.tool.axis',
  'rectangle-2p': 'sketch.tool.rectangle-2p',
  'rectangle-center': 'sketch.tool.rectangle-center',
  'circle-center-diameter': 'sketch.tool.circle-center-diameter',
  'arc-3p': 'sketch.tool.arc-3p',
  'arc-center': 'sketch.tool.arc-center',
  point: 'sketch.tool.point',
  polygon: 'sketch.tool.polygon',
} as const;

export function SketchToolbar({ sketcher }: { sketcher: SketcherApi }): React.JSX.Element {
  const snapEnabled = useSessionStore((s) => s.snapEnabled);
  const setSnapEnabled = useSessionStore((s) => s.setSnapEnabled);

  const buttonClass = (active: boolean): string =>
    active ? `${styles.button ?? ''} ${styles.buttonActive ?? ''}` : (styles.button ?? '');

  return (
    <div className={styles.toolbar}>
      <button
        type="button"
        className={buttonClass(sketcher.tool === null)}
        onClick={() => {
          sketcher.setTool(null);
        }}
      >
        {t('sketch.tool.select')}
      </button>
      {TOOLS.map((tool) => (
        <button
          key={tool}
          type="button"
          className={buttonClass(sketcher.tool === tool)}
          onClick={() => {
            sketcher.setTool(tool);
          }}
        >
          {t(TOOL_LABEL_KEYS[tool])}
        </button>
      ))}
      <button
        type="button"
        className={buttonClass(sketcher.constructionMode)}
        title="X"
        onClick={sketcher.toggleConstruction}
      >
        {t('sketch.construction')}
      </button>
      <button
        type="button"
        className={buttonClass(snapEnabled)}
        onClick={() => {
          setSnapEnabled(!snapEnabled);
        }}
      >
        {t('sketch.snap')}
      </button>
      <button type="button" className={styles.button} onClick={sketcher.finishSketch}>
        {t('sketch.finish')}
      </button>
    </div>
  );
}
