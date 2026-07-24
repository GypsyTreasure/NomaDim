import { datumAxisWorld, datumPlaneWorld, isDatumPlane, type Datum } from '../../../document';
import type { DatumRender } from '../../../viewport';

/**
 * Maps construction geometry (`document.datums`) plus the in-progress creation
 * ghost into plain viewport render descriptors. Placement math lives in the
 * document layer (pure, no THREE); the viewport just draws what it's handed.
 * Hidden datums are dropped (unless it's the live preview).
 */
export function datumRender(datum: Datum, ghost = false): DatumRender {
  if (isDatumPlane(datum)) {
    const w = datumPlaneWorld(datum);
    return {
      id: datum.id,
      kind: 'plane',
      origin: w.origin,
      xAxis: w.xAxis,
      yAxis: w.yAxis,
      normal: w.normal,
      ghost,
    };
  }
  const w = datumAxisWorld(datum);
  return { id: datum.id, kind: 'axis', origin: w.origin, direction: w.direction, ghost };
}

export function buildDatumRenders(
  datums: readonly Datum[],
  preview: Datum | null
): readonly DatumRender[] {
  const rendered = datums.filter((d) => d.visible).map((d) => datumRender(d, false));
  return preview ? [...rendered, datumRender(preview, true)] : rendered;
}
