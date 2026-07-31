import { useEffect, useMemo } from 'react';
import type { BodyId, EntityId, ProfileId, SketchId, Vec2 } from '../../../core';
import {
  bodyDisplayName,
  findSketch,
  opDefinition,
  pointMap,
  type BooleanOperation,
  type DocumentState,
  type EdgeFingerprint,
  type Sketch,
} from '../../../document';
import { detectProfiles, type SketchProfile } from '../../../sketch';
import type { ProfileHighlight } from '../../store/sessionStore';
import { t } from '../../i18n/t';
import { useDocumentStore } from '../../store/documentStore';
import { acquireEdges, releaseEdges } from '../../store/kernelStore';
import { useSessionStore } from '../../store/sessionStore';
import type { SelectOption } from './dialogShared';

/**
 * Initializes the session edge-pick state for a Fillet/Chamfer dialog on
 * mount (seeding an existing op's edges when editing) and resets it on close.
 * Store writes only — no React state, so no set-state-in-effect concern.
 */
export function useEdgePickLifecycle(
  initialBodyId: BodyId | null,
  initialEdges: readonly EdgeFingerprint[]
): void {
  useEffect(() => {
    const session = useSessionStore.getState();
    session.setPickedEdges(initialEdges);
    session.setEdgePickBodyId(initialBodyId);
    acquireEdges(); // fetch pickable edges on demand (F4)
    return () => {
      useSessionStore.getState().resetEdgePick();
      releaseEdges();
    };
    // Mount/unmount only — seeds are captured once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Highlights the geometry a 3D-op dialog will act on (F3): the selected
 * profile loops (outer + holes) and, for Revolve, the axis line — drawn bright
 * in the viewport while the dialog is open, cleared on close. Sketch-local
 * polylines flow through the session store; the viewport maps them to 3D.
 */
export function computeProfileHighlight(
  sketch: Sketch | null,
  selected: ReadonlySet<ProfileId>,
  profiles: readonly SketchProfile[],
  axisEntityId: EntityId | null
): ProfileHighlight | null {
  // Face-plane sketches (not shipped yet) have no origin-plane placement here.
  if (sketch?.plane.kind !== 'origin') return null;
  const loops: Vec2[][] = [];
  // Every profile is a hit-testable region for click-to-pick (#11); `selected`
  // ones also draw their bright outline. The viewport fills selected regions and
  // faint-outlines the rest so all clickable areas are visible.
  const areas: { id: string; selected: boolean; outer: Vec2[]; holes: Vec2[][] }[] = [];
  for (const profile of profiles) {
    const isSelected = selected.has(profile.id);
    const holes: Vec2[][] = [];
    for (const inner of profile.inner) holes.push([...inner.polygon]);
    if (isSelected) {
      loops.push([...profile.outer.polygon]);
      for (const inner of profile.inner) loops.push([...inner.polygon]);
    }
    areas.push({ id: profile.id, selected: isSelected, outer: [...profile.outer.polygon], holes });
  }
  let axis: readonly Vec2[] | null = null;
  if (axisEntityId) {
    const entity = sketch.entities.find((e) => e.id === axisEntityId);
    if (entity?.type === 'line') {
      const pts = pointMap(sketch);
      const a = pts.get(entity.start);
      const b = pts.get(entity.end);
      if (a && b)
        axis = [
          { x: a.x, y: a.y },
          { x: b.x, y: b.y },
        ];
    }
  }
  return { plane: sketch.plane.plane, loops, areas, axis };
}

export function useProfileHighlight(
  sketchId: SketchId | null,
  selected: ReadonlySet<ProfileId>,
  profiles: readonly SketchProfile[],
  axisEntityId: EntityId | null = null,
  onToggle?: (id: ProfileId) => void
): void {
  const document = useDocumentStore((s) => s.document);
  useEffect(() => {
    const sketch = (sketchId ? findSketch(document, sketchId) : null) ?? null;
    useSessionStore
      .getState()
      .setProfileHighlight(computeProfileHighlight(sketch, selected, profiles, axisEntityId));
    return () => {
      useSessionStore.getState().setProfileHighlight(null);
    };
  }, [document, sketchId, selected, profiles, axisEntityId]);
  // Register the profile-pick handler so a 3D-view click toggles a profile (#11).
  useEffect(() => {
    useSessionStore.getState().setProfilePick(onToggle ?? null);
    return () => {
      useSessionStore.getState().setProfilePick(null);
    };
  }, [onToggle]);
}

/** Resolves the selectable profiles of a sketch (area-labelled, R7a ids). */
export function useSketchProfiles(sketchId: SketchId | null): readonly SketchProfile[] {
  const document = useDocumentStore((s) => s.document);
  return useMemo(() => {
    if (!sketchId) return [];
    const sketch = findSketch(document, sketchId);
    return sketch ? detectProfiles(sketch).profiles : [];
  }, [document, sketchId]);
}

/** Open chains offered ONLY for Surface bodies (#12) — swept as open wires. */
export function useSketchOpenProfiles(sketchId: SketchId | null): readonly SketchProfile[] {
  const document = useDocumentStore((s) => s.document);
  return useMemo(() => {
    if (!sketchId) return [];
    const sketch = findSketch(document, sketchId);
    return sketch ? detectProfiles(sketch).openProfiles : [];
  }, [document, sketchId]);
}

/** Shared data helpers for the op dialogs — no per-op switches (R4). */

/** Every id currently in use (sketches, ops, produced bodies) for minting. */
export function existingIds(document: DocumentState): Set<string> {
  const ids = new Set<string>();
  for (const sketch of document.sketches) ids.add(sketch.id);
  for (const op of document.ops) {
    ids.add(op.id);
    for (const bodyId of opDefinition(op).dependencies(op).producesBodies) ids.add(bodyId);
  }
  return ids;
}

/** Next default op name like "Extrude1" (count of same-prefixed ops + 1). */
export function mintName(document: DocumentState, base: string): string {
  const count = document.ops.filter((op) => op.name.startsWith(base)).length;
  return `${base}${String(count + 1)}`;
}

export function sketchOptions(document: DocumentState): readonly SelectOption<SketchId>[] {
  return document.sketches.map((sketch) => ({ value: sketch.id, label: sketch.name }));
}

/** Extrude/Revolve result kind (ADR-0072): a plain solid, a hollowed thin wall
 * (#7), or a zero-thickness surface body. */
export type BodyType = 'solid' | 'thin' | 'surface';
export const BODY_TYPE_OPTIONS: readonly SelectOption<BodyType>[] = [
  { value: 'solid', label: t('dialog.bodyType.solid') },
  { value: 'thin', label: t('dialog.bodyType.thin') },
  { value: 'surface', label: t('dialog.bodyType.surface') },
];
export function initialBodyType(asSurface: boolean, wallMm: number): BodyType {
  return asSurface ? 'surface' : wallMm > 0 ? 'thin' : 'solid';
}

const OPERATION_LABELS: Record<BooleanOperation, string> = {
  NewBody: t('dialog.operation.NewBody'),
  Join: t('dialog.operation.Join'),
  Cut: t('dialog.operation.Cut'),
  Intersect: t('dialog.operation.Intersect'),
};

export function operationOptions(): readonly SelectOption<BooleanOperation>[] {
  return (Object.keys(OPERATION_LABELS) as BooleanOperation[]).map((value) => ({
    value,
    label: OPERATION_LABELS[value],
  }));
}

/** Bodies usable as a boolean target — excludes the op's own produced body.
 * Labels are the readable "Body N" names (request #5), never raw ids. */
export function targetOptions(
  document: DocumentState,
  liveBodyIds: readonly BodyId[],
  excludeBodyId?: BodyId
): readonly SelectOption<BodyId>[] {
  return liveBodyIds
    .filter((id) => id !== excludeBodyId)
    .map((id) => ({ value: id, label: bodyDisplayName(document, id) }));
}
