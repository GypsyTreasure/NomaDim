import { useEffect, useMemo } from 'react';
import type { BodyId, SketchId } from '../../../core';
import {
  findSketch,
  opDefinition,
  type BooleanOperation,
  type DocumentState,
  type EdgeFingerprint,
} from '../../../document';
import { detectProfiles, type SketchProfile } from '../../../sketch';
import { t } from '../../i18n/t';
import { useDocumentStore } from '../../store/documentStore';
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
    return () => {
      useSessionStore.getState().resetEdgePick();
    };
    // Mount/unmount only — seeds are captured once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

/** Bodies usable as a boolean target — excludes the op's own produced body. */
export function targetOptions(
  liveBodyIds: readonly BodyId[],
  excludeBodyId?: BodyId
): readonly SelectOption<BodyId>[] {
  return liveBodyIds
    .filter((id) => id !== excludeBodyId)
    .map((id) => ({ value: id, label: id }));
}
