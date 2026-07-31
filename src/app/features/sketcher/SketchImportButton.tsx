import { useRef } from 'react';
import { pushToast } from '../../store/toastStore';
import { t } from '../../i18n/t';
import { IconButton } from '../ui/IconButton';

/**
 * Import SVG/DXF reference geometry into the active sketch (#2, ADR-0076).
 * Reads the file as text and hands it to the sketcher, which imports it as real
 * (extrudable) sketch geometry. Lives in the sketch toolbar.
 */
export function SketchImportButton(props: {
  onImport: (fileName: string, text: string) => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-importing the same file
    if (!file) return;
    void file.text().then(
      (text) => {
        props.onImport(file.name, text);
      },
      () => {
        pushToast(t('sketch.import.error'), 'error');
      }
    );
  };

  return (
    <>
      <IconButton
        icon="importSketch"
        label={t('sketch.import')}
        testid="sketch-import"
        onClick={() => inputRef.current?.click()}
      />
      <input
        ref={inputRef}
        type="file"
        accept=".svg,.dxf"
        style={{ display: 'none' }}
        onChange={onFile}
        data-testid="sketch-import-input"
      />
    </>
  );
}
