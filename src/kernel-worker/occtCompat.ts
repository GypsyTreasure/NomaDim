/**
 * opencascade.js@2.0.0-beta's generated bindings have two upstream gaps
 * (ADR-0011):
 *
 * 1. Enum "type" aliases (`TopAbs_ShapeEnum`, `TopAbs_Orientation`,
 *    `Poly_MeshPurpose`, ...) model the whole runtime namespace object
 *    (every member typed as bare `{}`), not a single member's type — so TS
 *    neither lets you read `.value` off a member nor pass a member where a
 *    function declares that (mis-generated) enum type as its parameter.
 *    Confirmed against the actual WASM binary: every member is a real
 *    `{ value: number }` object at runtime. `enumMember`/`enumArg` below
 *    (casts through `unknown`, never `any`) bridge that gap.
 * 2. `Graphic3d_ZLayerId` is used as the return/parameter type for
 *    essentially every count/index/id-like value (`NbNodes()`,
 *    `NbTriangles()`, `Triangle()` indices, ...) across the ~200k-line
 *    generated `.d.ts`, but never itself declared or exported (a plain
 *    32-bit integer at the OCCT C++ level, `Standard_Integer`). A module
 *    augmentation fixes this for a plain `tsc -p` build, but empirically
 *    does NOT reliably propagate into typescript-eslint's `projectService`
 *    diagnostics for a file that also imports real (non-augmented) types
 *    from the same huge module — a caching/ordering quirk, not something
 *    fixable from our side. `int()` below is the pragmatic workaround, same
 *    shape as `enumArg`: takes `unknown` (assignable from an error-typed
 *    expression without tripping `no-unsafe-argument`) and casts to `number`
 *    at every OCCT count/index/id call site instead of relying on the
 *    augmentation being visible everywhere.
 */

export interface OcctEnumMember {
  value: number;
}

export function enumMember(value: unknown): OcctEnumMember {
  return value as OcctEnumMember;
}

// T is inferred from the call site's expected parameter type, turning this
// into a contextually-typed cast (see file header) — not a copy-paste leftover.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function enumArg<T>(value: unknown): T {
  return value as T;
}

/** Wraps a `Graphic3d_ZLayerId`-typed OCCT count/index value as a real `number`. */
export function int(value: unknown): number {
  return value as number;
}
