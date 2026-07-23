import type { SketchToolId } from '../../../sketch';
import type { TranslationKey } from '../../i18n/en';
import { t } from '../../i18n/t';
import { useSessionStore } from '../../store/sessionStore';
import type { DimensionToolKind, SketcherApi } from './useSketcher';
import { SketchTransformControls } from './SketchTransformControls';
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
  change: 'sketch.tool.change',
  dimension: 'sketch.tool.dimension',
} as const;

/**
 * Dim-tool kinds (F2) with their i18n label keys, in menu order. `auto` is a
 * tool-level default (AutoCAD-like): it resolves to horizontal or vertical per
 * the span's dominant axis at commit; only concrete kinds are ever stored.
 */
const DIMENSION_KINDS: readonly DimensionToolKind[] = [
  'auto',
  'linear',
  'horizontal',
  'vertical',
  'radius',
  'diameter',
  'angle',
];
const DIMENSION_KIND_LABEL_KEYS: Record<DimensionToolKind, TranslationKey> = {
  auto: 'sketch.dimensionKind.auto',
  linear: 'sketch.dimensionKind.linear',
  horizontal: 'sketch.dimensionKind.horizontal',
  vertical: 'sketch.dimensionKind.vertical',
  angle: 'sketch.dimensionKind.angle',
  radius: 'sketch.dimensionKind.radius',
  diameter: 'sketch.dimensionKind.diameter',
};

/** Keyboard shortcut per tool, shown as a tooltip (master rule, ADR-0032). */
const TOOL_SHORTCUT: Record<SketchToolId, string> = {
  line: 'L',
  axis: 'I',
  'rectangle-2p': 'R',
  'rectangle-center': 'Shift+R',
  'circle-center-diameter': 'C',
  'arc-3p': 'A',
  'arc-center': 'Shift+A',
  point: 'P',
  polygon: 'G',
  change: 'M',
  dimension: 'D',
};

export function SketchToolbar({ sketcher }: { sketcher: SketcherApi }): React.JSX.Element {
  const snapEnabled = useSessionStore((s) => s.snapEnabled);
  const setSnapEnabled = useSessionStore((s) => s.setSnapEnabled);

  const buttonClass = (active: boolean): string =>
    active ? `${styles.button ?? ''} ${styles.buttonActive ?? ''}` : (styles.button ?? '');

  return (
    <div className={styles.toolbar}>
      {/* Finish leads the toolbar (#3b) as the primary exit action. */}
      <button
        type="button"
        className={`${styles.button ?? ''} ${styles.primaryAction ?? ''}`}
        title="F"
        data-testid="finish-sketch"
        onClick={sketcher.finishSketch}
      >
        {t('sketch.finish')}
      </button>
      <button
        type="button"
        className={buttonClass(sketcher.tool === null)}
        title="S"
        onClick={() => {
          sketcher.setTool(null);
        }}
      >
        {t('sketch.tool.select')}
      </button>
      <button
        type="button"
        className={buttonClass(sketcher.tool === 'change')}
        title={TOOL_SHORTCUT.change}
        onClick={() => {
          sketcher.setTool('change');
        }}
      >
        {t('sketch.tool.change')}
      </button>
      <button
        type="button"
        className={buttonClass(sketcher.tool === 'dimension')}
        title={TOOL_SHORTCUT.dimension}
        onClick={() => {
          sketcher.setTool('dimension');
        }}
      >
        {t('sketch.tool.dimension')}
      </button>
      {sketcher.tool === 'dimension' && (
        <select
          className={styles.select}
          value={sketcher.dimensionKind}
          title={t('sketch.dimensionKind.label')}
          aria-label={t('sketch.dimensionKind.label')}
          onChange={(event) => {
            sketcher.setDimensionKind(event.target.value as DimensionToolKind);
          }}
        >
          {DIMENSION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(DIMENSION_KIND_LABEL_KEYS[kind])}
            </option>
          ))}
        </select>
      )}
      {TOOLS.map((tool) => (
        <button
          key={tool}
          type="button"
          className={buttonClass(sketcher.tool === tool)}
          title={TOOL_SHORTCUT[tool]}
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
        title="Q"
        onClick={() => {
          setSnapEnabled(!snapEnabled);
        }}
      >
        {t('sketch.snap')}
      </button>
      <button
        type="button"
        className={buttonClass(sketcher.intersect)}
        title={`${t('sketch.intersect')} (J)`}
        data-testid="sketch-intersect"
        aria-pressed={sketcher.intersect}
        onClick={sketcher.toggleIntersect}
      >
        {t('sketch.intersect')}
      </button>
      <button
        type="button"
        className={styles.button}
        title={t('sketch.delete')}
        data-testid="sketch-delete"
        disabled={!sketcher.hasSelection}
        onClick={sketcher.deleteSelection}
      >
        {t('sketch.delete')}
      </button>
      <SketchTransformControls sketcher={sketcher} />
    </div>
  );
}
