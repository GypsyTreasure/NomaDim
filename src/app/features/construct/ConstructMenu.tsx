import { useConstructStore } from '../../store/constructStore';
import { t } from '../../i18n/t';
import { IconButton } from '../ui/IconButton';

/**
 * Construct menu (Fusion "Construct"): create a reusable construction plane or
 * axis. Lives in the modeling app-action cluster; each button carries its
 * keyboard shortcut as a title (master rule, ADR-0032) and an icon (ADR-0090).
 */
export function ConstructMenu(): React.JSX.Element {
  const openCreate = useConstructStore((s) => s.openCreate);
  return (
    <>
      <IconButton
        icon="plane"
        label={t('construct.plane')}
        shortcut="G"
        testid="construct-plane"
        onClick={() => {
          openCreate('plane');
        }}
      />
      <IconButton
        icon="axis"
        label={t('construct.axis')}
        shortcut="J"
        testid="construct-axis"
        onClick={() => {
          openCreate('axis');
        }}
      />
    </>
  );
}
