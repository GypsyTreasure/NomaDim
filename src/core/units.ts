/**
 * Shared numeric constants (ARCHITECTURE §6, §9). Viewport tessellation and
 * export meshing must never diverge by copying these values — both call
 * sites import from here.
 */

export const VIEWPORT_LINEAR_DEFLECTION_MM = 0.25;
export const VIEWPORT_ANGULAR_DEFLECTION_DEG = 20;

export const DEFAULT_EXPORT_LINEAR_DEFLECTION_MM = 0.1;
export const DEFAULT_EXPORT_ANGULAR_DEFLECTION_DEG = 15;

export const MAX_BODIES_WARNING = 90;
export const MAX_BODIES_HARD_STOP = 100;

export const UNDO_STACK_MIN_DEPTH = 50;
