import type { SketchToolId } from '../../../sketch';
import type { TranslationKey } from '../../i18n/en';
import { t } from '../../i18n/t';
import { useSessionStore } from '../../store/sessionStore';
import { IconButton } from '../ui/IconButton';
import type { IconName } from '../icons/Icon';
import type { DimensionToolKind, SketcherApi } from './useSketcher';
import { SketchImportButton } from './SketchImportButton';
import { SketchTransformControls } from './SketchTransformControls';
import styles from './Sketcher.module.css';
import toolbarStyles from '../ui/Toolbar.module.css';

/** Draw tools in toolbar order, each with its label key, icon and shortcut. */
const TOOLS: readonly {
  readonly id: SketchToolId;
  readonly labelKey: TranslationKey;
  readonly icon: IconName;
  readonly shortcut: string;
}[] = [
  { id: 'line', labelKey: 'sketch.tool.line', icon: 'line', shortcut: 'L' },
  { id: 'axis', labelKey: 'sketch.tool.axis', icon: 'centerline', shortcut: 'I' },
  { id: 'rectangle-2p', labelKey: 'sketch.tool.rectangle-2p', icon: 'rectangle', shortcut: 'R' },
  {
    id: 'rectangle-center',
    labelKey: 'sketch.tool.rectangle-center',
    icon: 'rectangleCenter',
    shortcut: 'Shift+R',
  },
  {
    id: 'circle-center-diameter',
    labelKey: 'sketch.tool.circle-center-diameter',
    icon: 'circle',
    shortcut: 'C',
  },
  { id: 'arc-3p', labelKey: 'sketch.tool.arc-3p', icon: 'arc', shortcut: 'A' },
  { id: 'arc-center', labelKey: 'sketch.tool.arc-center', icon: 'arcCenter', shortcut: 'Shift+A' },
  { id: 'point', labelKey: 'sketch.tool.point', icon: 'point', shortcut: 'P' },
  { id: 'polygon', labelKey: 'sketch.tool.polygon', icon: 'polygon', shortcut: 'G' },
  { id: 'spline', labelKey: 'sketch.tool.spline', icon: 'spline', shortcut: 'B' },
];

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

const Divider = (): React.JSX.Element => (
  <span className={toolbarStyles.divider} aria-hidden="true" />
);

/**
 * Sketch tool dock (ADR-0090): icon-only tools grouped into blocks — primary
 * Finish, then modes (Select/Change/Dimension), draw tools, toggles, and edit —
 * separated by hairline dividers. Every button keeps its accessible name
 * (aria-label) and "label (shortcut)" tooltip (master rule, ADR-0032).
 */
export function SketchToolbar({ sketcher }: { sketcher: SketcherApi }): React.JSX.Element {
  const snapEnabled = useSessionStore((s) => s.snapEnabled);
  const setSnapEnabled = useSessionStore((s) => s.setSnapEnabled);

  return (
    <div className={styles.toolbar}>
      <div className={toolbarStyles.block}>
        <IconButton
          icon="finish"
          label={t('sketch.finish')}
          shortcut="F"
          primary
          testid="finish-sketch"
          onClick={sketcher.finishSketch}
        />
      </div>
      <Divider />
      <div className={toolbarStyles.block}>
        <IconButton
          icon="select"
          label={t('sketch.tool.select')}
          shortcut="S"
          active={sketcher.tool === null}
          onClick={() => {
            sketcher.setTool(null);
          }}
        />
        <IconButton
          icon="change"
          label={t('sketch.tool.change')}
          shortcut="M"
          active={sketcher.tool === 'change'}
          onClick={() => {
            sketcher.setTool('change');
          }}
        />
        <IconButton
          icon="dimension"
          label={t('sketch.tool.dimension')}
          shortcut="D"
          active={sketcher.tool === 'dimension'}
          onClick={() => {
            sketcher.setTool('dimension');
          }}
        />
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
      </div>
      <Divider />
      <div className={toolbarStyles.block}>
        {TOOLS.map((tool) => (
          <IconButton
            key={tool.id}
            icon={tool.icon}
            label={t(tool.labelKey)}
            shortcut={tool.shortcut}
            active={sketcher.tool === tool.id}
            onClick={() => {
              sketcher.setTool(tool.id);
            }}
          />
        ))}
      </div>
      <Divider />
      <div className={toolbarStyles.block}>
        <IconButton
          icon="construction"
          label={t('sketch.construction')}
          shortcut="X"
          active={sketcher.constructionMode}
          ariaPressed={sketcher.constructionMode}
          onClick={sketcher.toggleConstruction}
        />
        <IconButton
          icon="snap"
          label={t('sketch.snap')}
          shortcut="Q"
          active={snapEnabled}
          ariaPressed={snapEnabled}
          onClick={() => {
            setSnapEnabled(!snapEnabled);
          }}
        />
        <IconButton
          icon="intersect"
          label={t('sketch.intersect')}
          shortcut="J"
          active={sketcher.intersect}
          ariaPressed={sketcher.intersect}
          testid="sketch-intersect"
          onClick={sketcher.toggleIntersect}
        />
      </div>
      <Divider />
      <div className={toolbarStyles.block}>
        <IconButton
          icon="delete"
          label={t('sketch.delete')}
          disabled={!sketcher.hasSelection}
          testid="sketch-delete"
          onClick={sketcher.deleteSelection}
        />
        <SketchImportButton onImport={sketcher.importReference} />
        <SketchTransformControls sketcher={sketcher} />
      </div>
    </div>
  );
}
