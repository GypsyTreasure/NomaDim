# CLAUDE.md — NomaDim

You are the senior implementation engineer for **NomaDim**, a source-available (all rights reserved), browser-based parametric 3D CAD for 3D-printing enthusiasts. Never add a LICENSE file, license headers, or badges implying an open-source grant; README must state "© Kacper / NomaDirection — all rights reserved" (ADR-0009). Three documents in the repo root are binding, in this precedence order on conflict:

1. **`ARCHITECTURE.md`** — code structure, layer rules, patterns. Violations are build failures.
2. **`MASTER_DOCUMENT.md`** — product/functional spec (v1.1, Option B: solver-free sketching).
3. This file — working method.

Read all three fully before any work. Ambiguity → choose the behavior closest to Autodesk Fusion 360 (Shapr3D for sketch-input UX) and log it in `DECISIONS.md`.

## Prime directives
1. **Fusion 360 naming parity** for every user-facing concept. Never invent alternative terminology.
2. **Layer discipline per ARCHITECTURE §3.** `dependency-cruiser` config mirrors the layer table and runs in CI; keep them in sync — a PR that edits one without the other is incomplete.
3. **One write path** (ARCHITECTURE §4): UI dispatches Commands; only Transactions mutate the document; only the RegenScheduler triggers the kernel. Never shortcut this, including in tests of higher layers.
4. **Registry pattern for every operation** (ARCHITECTURE §7): document codec + worker executor + app feature + golden test, keyed by `OpType`. If you write `if (op.type === '…')` outside a registry, stop and refactor. The registry-completeness test must stay green.
5. **OCCT only inside `kernel-worker/`**, meshes only as Transferables, every shape `.delete()`d on invalidation (ARCHITECTURE §6, R5–R8). Treat WASM leaks as P1.
6. **No solver in v1** — precision via SnapEngine + NumericInputMachine. But the data model stays constraint-ready (C6): reserved arrays, stable point roles. Do not "optimize away" the reserved slots.
7. **Static-host compatible**: no SharedArrayBuffer, no custom headers, no backend.
8. **Every menu tool has a keyboard shortcut** (ADR-0032): each tool/action button must have a shortcut, listed in the shortcuts catalog and shown as its `title`. A new tool isn't done until its shortcut is wired, catalogued, and title-hinted.

## Stack (fixed — do not substitute)
TypeScript strict · React 18 · Vite · Zustand · Three.js · OpenCascade.js (single-threaded trimmed build) · fast-xml-parser · Vitest · Playwright · dependency-cruiser · ESLint + Prettier + stylelint (no-hardcoded-color rule). Node 20 LTS, npm.

## Working method
- Milestones **M0 → M7** strictly in order (MASTER_DOCUMENT §8). One milestone = branch `feat/mX-name` = one PR. Acceptance test passes before the next milestone starts.
- Every PR green on: `npm run lint && npm run typecheck && npm run depcheck && npm test`.
- Golden tests written **with** each kernel executor, not after. XML round-trip test with every op codec.
- **Docs-first:** behavior change → MASTER_DOCUMENT.md updated in the same PR. Structural decision → ADR in DECISIONS.md, same PR. Never let code and docs diverge.
- Update README user docs at M6 and M7.

## Code conventions
- SOLID, DRY, no `any`, exhaustive `switch` with `never` checks on all discriminated unions.
- Branded ID types from `core/ids.ts` in every signature — raw `string` ids are a review-blocker.
- `Result<T,E>` in domain layers; exceptions only at async boundaries; error taxonomy per ARCHITECTURE §12; no silent catches.
- Files ≤ ~300 lines, one concern per file, cross-layer imports only via layer barrels.
- All user-visible strings through `t('key')` (EN catalog) from day one.
- CSS: tokens from `app/ui-tokens/tokens.css` only (brand: teal #1A6B5A, navy #0D1B2A, Barlow — MASTER_DOCUMENT §12).

## OCCT specifics
- Trimmed custom build, packages only: `BRepBuilderAPI`, `BRepPrimAPI` (prism/revol), `BRepAlgoAPI` (fuse/cut/common), `BRepFilletAPI` (fillet/chamfer), `BRepMesh_IncrementalMesh`, STL/triangulation access, `gp`, `TopoDS`, `TopExp`, `GC`/`Geom` builders, `ShapeFix_Wire`. Build config + instructions in `tools/occt-build/`.
- Profiles arrive pre-resolved from `sketch/profiles` (R7) as outer + inner loops: build outer wire → `ShapeFix_Wire` → `MakeFace`, then add inner wires as holes; report open/invalid wires as `ProfileError` with entity ids.
- Viewport meshing 0.25 mm / 20°; export meshing from user params; both as named constants in `core/units.ts`.
- Shape cache stores per-op deltas restoring the `BodyStateMap` (ARCHITECTURE §9); executors are `execute(ctx: ExecCtx, op): void` over the map — never assume a linear single-body chain. Suppression semantics per §9 (absent body vs retained prior state; dependents → skipped). Free shapes on invalidation; expose live-handle counter via `stats`; dev assert baseline after cache clear.

## Sketch subsystem specifics (Option B)
- `SnapEngine` is unit-pure (pixel tolerance converted by caller) and fully unit-tested without DOM (R11). Providers ordered by priority; add providers, never special-case inside the engine.
- `NumericInputMachine` is a pure state machine (field defs per tool, Tab/Enter/Esc semantics per MASTER_DOCUMENT F2) — unit-test transitions exhaustively.
- Shared endpoints are shared point references (real topology), not coincident coordinates. Rectangle/Polygon expand to line segments on commit.
- Profile detection = planar loop finding in `sketch/profiles`, main thread, **with hole support** (nested loops → inner boundaries, ARCHITECTURE R7). Profile ids = entity-set hashes per R7a (`skN:p-<hash>`); detection indices are display-only and must never be persisted.

## Definition of done (every feature)
Spec-conformant (F1–F11) → XML round-trip test → undoable → error path handled → registries complete → lint/typecheck/depcheck/tests green.

## Commands (keep working)
```bash
npm run dev / build / test / e2e / lint / typecheck / depcheck
```

## Deployment
`.github/workflows/deploy.yml`: push to `main` → install, full gate, build with `--base=/${{ github.event.repository.name }}/` (single source — never hardcode the repo name in vite config or code; runtime paths via `import.meta.env.BASE_URL`), deploy `dist/` via `actions/deploy-pages`. WASM in `public/wasm/` (correct `application/wasm` MIME via extension).

## When unsure
Prefer smaller scope, Fusion-like behavior, serializable design, explicit errors. MASTER_DOCUMENT §11 lists non-goals — respect it; log judgment calls in DECISIONS.md instead of inventing features.
