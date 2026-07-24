import { useConstructStore } from '../../store/constructStore';
import { t } from '../../i18n/t';
import sketcherStyles from '../sketcher/Sketcher.module.css';

/**
 * Construct menu (Fusion "Construct"): create a reusable construction plane or
 * axis. Lives in the modeling app-action cluster; each button carries its
 * keyboard shortcut as a title (master rule, ADR-0032).
 */
export function ConstructMenu(): React.JSX.Element {
  const openCreate = useConstructStore((s) => s.openCreate);
  return (
    <>
      <button
        type="button"
        className={sketcherStyles.button}
        title="G"
        data-testid="construct-plane"
        onClick={() => {
          openCreate('plane');
        }}
      >
        {t('construct.plane')}
      </button>
      <button
        type="button"
        className={sketcherStyles.button}
        title="J"
        data-testid="construct-axis"
        onClick={() => {
          openCreate('axis');
        }}
      >
        {t('construct.axis')}
      </button>
    </>
  );
}
