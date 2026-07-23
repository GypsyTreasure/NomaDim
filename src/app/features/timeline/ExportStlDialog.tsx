import { useEffect, useMemo, useState } from 'react';
import type { BodyId } from '../../../core';
import type { MeshStat } from '../../../kernel';
import { useDocumentStore } from '../../store/documentStore';
import { getKernelClient, useKernelStore } from '../../store/kernelStore';
import { useSessionStore } from '../../store/sessionStore';
import { pushToast } from '../../store/toastStore';
import { t } from '../../i18n/t';
import { DialogFrame, NumberRow, SelectRow, type SelectOption } from './dialogShared';
import styles from './Timeline.module.css';

/**
 * Export dialog (F6 + roadmap P1): body scope and a format — STL (binary/ASCII,
 * a printable mesh) or STEP (an exact B-rep for round-tripping to other CAD).
 * For the mesh formats it adds linear + angular deflection with Low/Medium/High
 * presets, a live triangle-count preview, and a non-manifold warning. STEP is
 * exact, so those mesh controls are hidden. Mesh stats come from the kernel
 * `meshStats` request (debounced); export routes to `exportStl` / `exportStep`.
 */

type Scope = 'selected' | 'visible' | 'all';
type Format = 'binary' | 'ascii' | 'step';
type QualityKey = 'low' | 'medium' | 'high' | 'custom';

interface QualityPreset {
  readonly linearMm: number;
  readonly angularDeg: number;
}

const PRESETS: Record<Exclude<QualityKey, 'custom'>, QualityPreset> = {
  low: { linearMm: 0.5, angularDeg: 30 },
  medium: { linearMm: 0.1, angularDeg: 15 },
  high: { linearMm: 0.05, angularDeg: 8 },
};

const SCOPE_OPTIONS: readonly SelectOption<Scope>[] = [
  { value: 'selected', label: t('stl.scope.selected') },
  { value: 'visible', label: t('stl.scope.visible') },
  { value: 'all', label: t('stl.scope.all') },
];
const FORMAT_OPTIONS: readonly SelectOption<Format>[] = [
  { value: 'binary', label: t('stl.format.binary') },
  { value: 'ascii', label: t('stl.format.ascii') },
  { value: 'step', label: t('stl.format.step') },
];
const QUALITY_OPTIONS: readonly SelectOption<QualityKey>[] = [
  { value: 'low', label: t('stl.quality.low') },
  { value: 'medium', label: t('stl.quality.medium') },
  { value: 'high', label: t('stl.quality.high') },
  { value: 'custom', label: t('stl.quality.custom') },
];

function matchPreset(linearMm: number, angularDeg: number): QualityKey {
  for (const [key, preset] of Object.entries(PRESETS)) {
    if (preset.linearMm === linearMm && preset.angularDeg === angularDeg) return key as QualityKey;
  }
  return 'custom';
}

function downloadBlob(data: ArrayBuffer, fileName: string): void {
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ExportStlDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const bodyMeta = useDocumentStore((s) => s.document.bodyMeta);
  const selectedBodyId = useSessionStore((s) => s.selectedBodyId);

  const [scope, setScope] = useState<Scope>(selectedBodyId ? 'selected' : 'visible');
  const [format, setFormat] = useState<Format>('binary');
  const [linearMm, setLinearMm] = useState(PRESETS.medium.linearMm);
  const [angularDeg, setAngularDeg] = useState(PRESETS.medium.angularDeg);
  const [stats, setStats] = useState<MeshStat[] | null>(null);

  // Resolve the scope to a concrete body-id set.
  const bodyIds = useMemo<BodyId[]>(() => {
    if (scope === 'all') return [...liveBodyIds];
    if (scope === 'selected') {
      return selectedBodyId && liveBodyIds.includes(selectedBodyId) ? [selectedBodyId] : [];
    }
    const hidden = new Set(bodyMeta.filter((m) => !m.visible).map((m) => m.id));
    return liveBodyIds.filter((id) => !hidden.has(id));
  }, [scope, liveBodyIds, selectedBodyId, bodyMeta]);

  const isMesh = format !== 'step';
  const idsKey = bodyIds.join(',');

  // Live triangle-count + validity preview (debounced) at the chosen quality —
  // mesh formats only (STEP is exact). All state writes happen inside the
  // deferred callback (never synchronously in the effect body).
  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const client = getKernelClient();
      if (!client || bodyIds.length === 0 || !isMesh) {
        setStats([]);
        return;
      }
      setStats(null); // "computing…"
      client
        .meshStats([...bodyIds], {
          linearDeflectionMm: linearMm,
          angularDeflectionDeg: angularDeg,
        })
        .then(
          (result) => {
            if (!cancelled) setStats(result);
          },
          () => {
            if (!cancelled) setStats([]);
          }
        );
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [idsKey, linearMm, angularDeg, bodyIds, isMesh]);

  const triangleTotal = stats?.reduce((sum, s) => sum + s.triangleCount, 0) ?? null;
  const anyNonManifold = stats?.some((s) => !s.valid) ?? false;
  const qualityKey = matchPreset(linearMm, angularDeg);

  const applyQuality = (key: QualityKey): void => {
    if (key === 'custom') return;
    setLinearMm(PRESETS[key].linearMm);
    setAngularDeg(PRESETS[key].angularDeg);
  };

  const okDisabled = bodyIds.length === 0 || (isMesh && (!(linearMm > 0) || !(angularDeg > 0)));

  const submit = (): void => {
    const client = getKernelClient();
    if (!client || bodyIds.length === 0) return;
    const onError = (error: unknown): void => {
      pushToast(
        `${t('stl.exportError')} ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    };
    if (format === 'step') {
      void client.exportStep([...bodyIds]).then((result) => {
        downloadBlob(result.data, result.fileName);
        onClose();
      }, onError);
      return;
    }
    void client
      .exportStl({
        bodyIds: [...bodyIds],
        format,
        linearDeflectionMm: linearMm,
        angularDeflectionDeg: angularDeg,
      })
      .then((result) => {
        downloadBlob(result.stl, result.fileName);
        onClose();
      }, onError);
  };

  return (
    <DialogFrame title={t('stl.title')} okDisabled={okDisabled} onOk={submit} onCancel={onClose}>
      <SelectRow<Scope>
        labelKey="stl.scope"
        value={scope}
        options={SCOPE_OPTIONS}
        onChange={setScope}
      />
      <SelectRow<Format>
        labelKey="stl.format"
        value={format}
        options={FORMAT_OPTIONS}
        onChange={setFormat}
      />
      {isMesh && (
        <>
          <SelectRow<QualityKey>
            labelKey="stl.quality"
            value={qualityKey}
            options={QUALITY_OPTIONS}
            onChange={applyQuality}
          />
          <NumberRow labelKey="stl.linear" value={linearMm} onChange={setLinearMm} />
          <NumberRow labelKey="stl.angular" value={angularDeg} onChange={setAngularDeg} />
          <div className={styles.field}>
            <span>{t('stl.triangles')}</span>
            <span data-testid="stl-triangle-count">
              {bodyIds.length === 0
                ? t('stl.empty')
                : triangleTotal === null
                  ? '…'
                  : triangleTotal.toLocaleString()}
            </span>
          </div>
          {anyNonManifold && (
            <p className={styles.stlWarning} data-testid="stl-warning">
              {t('stl.nonManifold')}
            </p>
          )}
        </>
      )}
    </DialogFrame>
  );
}
