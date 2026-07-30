import { useState } from 'react';
import { t } from '../../i18n/t';
import { DialogFrame } from '../timeline/dialogShared';
import type { PendingImport } from './useSketcher';
import styles from './Sketcher.module.css';

/**
 * Import layer picker (ADR-0088): a multi-layer DXF pauses here so the user
 * manually chooses which source layers to import — every layer is on by
 * default, with per-layer primitive counts. Import brings in only the checked
 * layers' geometry. SVG and single-layer DXF skip this entirely.
 */
export function ImportLayersDialog({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: PendingImport;
  onConfirm: (selected: ReadonlySet<string>) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(pending.layers.map((l) => l.name))
  );

  const selectedCount = pending.layers.reduce(
    (sum, l) => sum + (selected.has(l.name) ? l.count : 0),
    0
  );

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <DialogFrame
      title={t('import.layers.title')}
      okDisabled={selected.size === 0}
      onOk={() => {
        onConfirm(selected);
      }}
      onCancel={onCancel}
    >
      <p className={styles.importHint}>{t('import.layers.hint')}</p>
      <div className={styles.layerActions}>
        <button
          type="button"
          className={styles.button}
          data-testid="import-layers-all"
          onClick={() => {
            setSelected(new Set(pending.layers.map((l) => l.name)));
          }}
        >
          {t('import.layers.all')}
        </button>
        <button
          type="button"
          className={styles.button}
          data-testid="import-layers-none"
          onClick={() => {
            setSelected(new Set());
          }}
        >
          {t('import.layers.none')}
        </button>
      </div>
      <ul className={styles.layerList} data-testid="import-layer-list">
        {pending.layers.map((layer, i) => (
          <li key={layer.name} className={styles.layerRow}>
            <label className={styles.layerLabel}>
              <input
                type="checkbox"
                checked={selected.has(layer.name)}
                data-testid={`import-layer-${String(i)}`}
                onChange={() => {
                  toggle(layer.name);
                }}
              />
              <span className={styles.layerName}>{layer.name || t('import.layers.default')}</span>
            </label>
            <span className={styles.layerCount}>{layer.count}</span>
          </li>
        ))}
      </ul>
      <p className={styles.importTotal} data-testid="import-layers-total">
        {t('import.layers.selected')} {String(selectedCount)}
      </p>
    </DialogFrame>
  );
}
