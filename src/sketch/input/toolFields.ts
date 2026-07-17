import type { FieldDef } from './machine';

/**
 * Field definitions per sketch tool (MASTER_DOCUMENT F2). Field ids double
 * as i18n label-key suffixes (`sketch.field.<id>`) — the app layer resolves
 * labels; this module stays UI-free.
 *
 * Line angles are ABSOLUTE to the sketch +X axis; chained segments (second
 * segment onward) additionally expose a relative-to-previous-segment angle
 * in the Tab cycle (ADR-0008).
 */

export type SketchToolId =
  | 'line'
  | 'axis'
  | 'rectangle-2p'
  | 'rectangle-center'
  | 'circle-center-diameter'
  | 'arc-3p'
  | 'arc-center'
  | 'point'
  | 'polygon';

const LENGTH = (id: string): FieldDef => ({ id, kind: 'length' });
const ANGLE = (id: string): FieldDef => ({ id, kind: 'angle' });
const COUNT = (id: string): FieldDef => ({ id, kind: 'count' });
const COORD = (id: string): FieldDef => ({ id, kind: 'coord' });

/**
 * Start-point (X, Y) fields, appended to every tool so the first anchor can be
 * typed as exact coordinates instead of clicked (F2). Kept LAST so the
 * keyboard-first flow (typing focuses the primary shape field) is unchanged.
 */
export const START_POINT_FIELDS: readonly FieldDef[] = [COORD('startX'), COORD('startY')];

export const LINE_FIELDS: readonly FieldDef[] = [LENGTH('length'), ANGLE('angleAbs')];
/** Chained line segments: relative angle joins the Tab cycle. */
export const LINE_FIELDS_CHAINED: readonly FieldDef[] = [
  LENGTH('length'),
  ANGLE('angleAbs'),
  ANGLE('angleRel'),
];

/** Tool fields plus the trailing start-point (X, Y) coordinate fields. */
export function fieldsForToolWithStart(tool: SketchToolId, chained = false): readonly FieldDef[] {
  return [...fieldsForTool(tool, chained), ...START_POINT_FIELDS];
}

export function fieldsForTool(tool: SketchToolId, chained = false): readonly FieldDef[] {
  switch (tool) {
    case 'line':
    case 'axis':
      return chained ? LINE_FIELDS_CHAINED : LINE_FIELDS;
    case 'rectangle-2p':
    case 'rectangle-center':
      return [LENGTH('width'), LENGTH('height')];
    case 'circle-center-diameter':
      return [LENGTH('diameter')];
    case 'arc-3p':
      return [LENGTH('radius')];
    case 'arc-center':
      return [LENGTH('radius'), ANGLE('angle')];
    case 'point':
      return [];
    case 'polygon':
      return [COUNT('sides'), LENGTH('diameter')];
    default: {
      const exhaustive: never = tool;
      return exhaustive;
    }
  }
}
