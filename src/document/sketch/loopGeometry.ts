import type { Vec2 } from '../../core';

/**
 * Oriented loop geometry (ARCHITECTURE R7): profiles ship to the worker as
 * ordered curve segments in sketch-local 2D — the worker builds wires from
 * these and NEVER re-derives topology. Pure serializable data; lives in
 * document/ so both sketch/ (producer) and kernel/ (protocol) may import it
 * within the layer rules.
 */

export type LoopSegment =
  | { readonly kind: 'line'; readonly a: Vec2; readonly b: Vec2 }
  | {
      readonly kind: 'arc';
      readonly a: Vec2;
      readonly b: Vec2;
      readonly center: Vec2;
      /** Travel orientation a→b about center. */
      readonly ccw: boolean;
    }
  | { readonly kind: 'circle'; readonly center: Vec2; readonly r: number };

/** Ordered, connected segments; implicitly closed (last meets first). */
export type LoopGeometry = readonly LoopSegment[];
