import { useId } from 'react';
import { angleOf, distance, sub, vec2, RAD_TO_DEG, type PointId } from '../../../core';
import { getEntity, getPoint, type Sketch } from '../../../document';
import { t } from '../../i18n/t';
import { commandBus } from '../../store/documentStore';
import { useSessionStore } from '../../store/sessionStore';
import styles from './Sketcher.module.css';

/**
 * Properties panel (MASTER_DOCUMENT F2 "Editing"): exact fields for the
 * selected entity. Every edit dispatches a command — undoable, single write
 * path (R1). Values commit on blur or Enter.
 */

function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (next: number) => void;
}): React.JSX.Element {
  const id = useId();
  const commit = (raw: string): void => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed);
  };
  return (
    <label className={styles.propertyRow} htmlFor={id}>
      {label}
      <input
        id={id}
        className={styles.propertyInput}
        type="number"
        step="any"
        key={value}
        defaultValue={value}
        onBlur={(e) => {
          commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value);
        }}
      />
    </label>
  );
}

function PointFields({
  sketch,
  pointId,
  label,
}: {
  sketch: Sketch;
  pointId: PointId;
  label: string;
}): React.JSX.Element | null {
  const point = getPoint(sketch, pointId);
  if (!point) return null;
  const move = (x: number, y: number): void => {
    commandBus.dispatch({
      type: 'MoveSketchPoints',
      payload: { sketchId: sketch.id, moves: [{ pointId, x, y }] },
    });
  };
  return (
    <>
      <NumberField
        label={`${label} ${t('sketch.properties.x')}`}
        value={point.x}
        onCommit={(x) => {
          move(x, point.y);
        }}
      />
      <NumberField
        label={`${label} ${t('sketch.properties.y')}`}
        value={point.y}
        onCommit={(y) => {
          move(point.x, y);
        }}
      />
    </>
  );
}

export function PropertiesPanel({ sketch }: { sketch: Sketch }): React.JSX.Element | null {
  const selected = useSessionStore((s) => s.selectedEntityIds);
  const entityId = selected[0];
  const entity = entityId ? getEntity(sketch, entityId) : undefined;
  if (!entity) return null;

  const constructionRow = (
    <label className={styles.propertyRow}>
      {t('sketch.properties.construction')}
      <input
        type="checkbox"
        checked={entity.construction}
        onChange={(e) => {
          commandBus.dispatch({
            type: 'SetEntityConstruction',
            payload: { sketchId: sketch.id, entityId: entity.id, construction: e.target.checked },
          });
        }}
      />
    </label>
  );

  let fields: React.JSX.Element | null;
  switch (entity.type) {
    case 'line': {
      const a = getPoint(sketch, entity.start);
      const b = getPoint(sketch, entity.end);
      const length = a && b ? distance(a, b) : 0;
      const angle = a && b ? angleOf(sub(vec2(b.x, b.y), vec2(a.x, a.y))) * RAD_TO_DEG : 0;
      fields = (
        <>
          <PointFields sketch={sketch} pointId={entity.start} label="P1" />
          <PointFields sketch={sketch} pointId={entity.end} label="P2" />
          <div className={styles.propertyRow}>
            {t('sketch.properties.length')}
            <span>{length.toFixed(3)}</span>
          </div>
          <div className={styles.propertyRow}>
            {t('sketch.properties.angle')}
            <span>{angle.toFixed(2)}°</span>
          </div>
        </>
      );
      break;
    }
    case 'circle':
      fields = (
        <>
          <PointFields sketch={sketch} pointId={entity.center} label="C" />
          <NumberField
            label={t('sketch.properties.radius')}
            value={entity.r}
            onCommit={(r) => {
              if (r > 0) {
                commandBus.dispatch({
                  type: 'SetCircleRadius',
                  payload: { sketchId: sketch.id, entityId: entity.id, r },
                });
              }
            }}
          />
        </>
      );
      break;
    case 'arc':
      fields = (
        <>
          <PointFields sketch={sketch} pointId={entity.center} label="C" />
          <PointFields sketch={sketch} pointId={entity.start} label="P1" />
          <PointFields sketch={sketch} pointId={entity.end} label="P2" />
        </>
      );
      break;
    case 'point':
      fields = <PointFields sketch={sketch} pointId={entity.point} label="P" />;
      break;
    default: {
      const exhaustive: never = entity;
      return exhaustive;
    }
  }

  return (
    <div className={styles.properties} data-testid="properties-panel">
      <h2 className={styles.propertiesTitle}>{t('sketch.properties.title')}</h2>
      {fields}
      {constructionRow}
    </div>
  );
}
