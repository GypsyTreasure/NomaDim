import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MeasurePick, MeasureProps } from '../../../viewport';
import { acquireEdges, releaseEdges, useKernelStore } from '../../store/kernelStore';

/**
 * Measure mode (MASTER_DOCUMENT F10): pick two points → distance + ΔX/ΔY/ΔZ;
 * a single circular edge → radius/diameter. Esc exits. Picks arrive from the
 * viewport (vertex/edge-midpoint snaps, else the body surface). Pending picks
 * live in a ref so `onPick` stays stable — the viewport rebuilds snap
 * candidates only on activation or regen, not on every click.
 */

export type MeasureResult =
  | {
      readonly kind: 'distance';
      readonly distance: number;
      readonly dx: number;
      readonly dy: number;
      readonly dz: number;
    }
  | { readonly kind: 'circle'; readonly radius: number };

export interface MeasureApi {
  readonly active: boolean;
  readonly result: MeasureResult | null;
  readonly toggle: () => void;
  readonly measureProps: MeasureProps | null;
}

function distanceResult(a: MeasurePick, b: MeasurePick): MeasureResult {
  const dx = b.world[0] - a.world[0];
  const dy = b.world[1] - a.world[1];
  const dz = b.world[2] - a.world[2];
  return { kind: 'distance', distance: Math.hypot(dx, dy, dz), dx, dy, dz };
}

export function useMeasure(): MeasureApi {
  const bodyEdges = useKernelStore((s) => s.bodyEdges);
  const [active, setActive] = useState(false);
  const [result, setResult] = useState<MeasureResult | null>(null);
  const pointsRef = useRef<MeasurePick[]>([]);

  const exit = useCallback(() => {
    setActive(false);
    setResult(null);
    pointsRef.current = [];
  }, []);

  const toggle = useCallback(() => {
    setResult(null);
    pointsRef.current = [];
    setActive((prev) => !prev);
  }, []);

  const onPick = useCallback((pick: MeasurePick) => {
    const points = pointsRef.current;
    if (pick.circleRadius !== null && points.length === 0) {
      pointsRef.current = [];
      setResult({ kind: 'circle', radius: pick.circleRadius });
      return;
    }
    const next = points.length >= 2 ? [pick] : [...points, pick];
    pointsRef.current = next;
    const [a, b] = next;
    setResult(a && b ? distanceResult(a, b) : null);
  }, []);

  // Esc exits; fetch pickable edges on demand only while measuring (F10).
  useEffect(() => {
    if (!active) return;
    acquireEdges();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') exit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      releaseEdges();
    };
  }, [active, exit]);

  const measureProps = useMemo<MeasureProps | null>(
    () => (active ? { bodyEdges, onPick } : null),
    [active, bodyEdges, onPick]
  );

  return { active, result, toggle, measureProps };
}
