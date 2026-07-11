# DECISIONS.md — Architecture Decision Records

Format: `ADR-NNNN · date · title` → Context / Decision / Consequences. Append-only; superseding requires a new ADR referencing the old one.

---

## ADR-0001 · 2026-07-10 · CAD kernel = OpenCascade.js in a Web Worker
**Context:** Need B-rep booleans, fillets, chamfers, and STL meshing with deflection control, fully client-side, GitHub Pages compatible.
**Decision:** OpenCascade.js (OCCT → WASM), custom trimmed single-threaded build, isolated in a dedicated Web Worker; alternatives rejected: JSCAD/manifold (mesh-based, no B-rep fillets), replicad (less control over topology and build size).
**Consequences:** ~10–15 MB one-time WASM download; manual WASM memory management (`.delete()` discipline, live-handle counter); all kernel access via typed message protocol.

## ADR-0002 · 2026-07-10 · Option B: solver-free sketching (numeric input + snapping)
**Context:** Full Fusion-style constraint solver (planegcs) estimated at 30–40% of total project effort; target users (3D-printing hobbyists) need precision and speed, not design-intent propagation. Shapr3D-style input UX identified as the desired feel.
**Decision:** v1 ships without a constraint solver. Precision via SnapEngine (point snaps + inference guides) and NumericInputMachine (typed values at creation, properties panel for edits). Committed geometry is baked; no propagation on edit.
**Consequences:** ~30% effort reduction; editing one entity does not update related entities (documented in UI). Mitigation: sketch schema is constraint-ready (C6 — reserved `constraints`/`dimensions` arrays, stable point roles), making a v2 planegcs integration additive with no schema migration.

## ADR-0003 · 2026-07-10 · Edge references via geometric fingerprints (no full topological naming)
**Context:** Robust topological naming across parametric edits is a multi-year problem (cf. FreeCAD history).
**Decision:** Fillet/Chamfer/Combine reference edges by fingerprint (midpoint + direction + adjacent face kinds, tolerance-matched at regen); sketch-on-face planes reference faces by fingerprint (centroid + normal + area) with a plane snapshot stored for main-thread editing. Failure to resolve → op error state, user re-picks. Same philosophy extended to profile identity: entity-set hashes, never detection indices (ARCHITECTURE R7a).
**Consequences:** Occasional re-selection after heavy upstream edits; drastically simpler kernel bookkeeping; honest limitation surfaced in UI copy.

## ADR-0004 · 2026-07-10 · Layered architecture with CI-enforced dependency rules
**Context:** Multi-month solo/AI-assisted project; highest risks are layer erosion, logic duplication, and doc/code divergence.
**Decision:** Layer catalog + dependency-cruiser gate (ARCHITECTURE §3), single write path via CommandBus (§4), per-operation three-file registry pattern with completeness test (§7), docs-first change policy (§15).
**Consequences:** Slightly more ceremony per feature; structural violations fail CI instead of accumulating; adding an operation is a bounded, predictable change set.

## ADR-0005 · 2026-07-10 · Copy/Paste is parametric-positional (revised during plan critique)
**Context:** Original wording ("baked snapshot, source edits never propagate") contradicted C5 — XML persistence is parametric replay, so a shape snapshot cannot be serialized, and replay makes upstream-edit propagation unavoidable.
**Decision:** `CopyBody` reproduces the source body as of the op's timeline position. Edits to ops earlier in the timeline propagate into the copy on regen (Fusion-like); ops appended after the copy do not.
**Consequences:** Fully C5-consistent and replayable; behavior explained once in UI on first paste. Truly frozen copies would require a separate "bake to mesh body" feature — out of scope v1.

## ADR-0006 · 2026-07-10 · Corrections from pre-implementation plan critique
**Context:** Structured critique of v1.1 documents before any code found: index-based profile references (silent wrong-geometry risk), missing hole support in profiles, sketch-on-face contradiction with R7, approximate measure radii, dependency-cruiser config not matching the layer table, undo/redo regen path unspecified.
**Decision:** Entity-set-hash profile identity (R7a); Profile = outer + inner loops with MakeFace holes; face fingerprints + plane snapshots for sketch-on-face; exact edge metadata in mesh transfer (R5a); config rules aligned with layer table incl. worker-entry-only exception; undo/redo emits standard dirty-marks (R2).
**Consequences:** No silent geometry substitution; canonical hole workflow specified from day one; enforcement config is authoritative alongside the table (both change together, per rule comment in config).

## ADR-0007 · 2026-07-10 · Corrections from plan critique round 2
**Context:** Second structured critique after Option-B corrections found: regen pseudocode assumed a linear single-body chain (wrong suppression semantics for a multi-body DAG, undefined executor ctx); XML loader accepted newer minor versions (guaranteed silent data loss vs the planned v2 constraints minor bump); modeling-while-rolled-back undefined; evaluated body set had no state owner; multi-tab autosave key collision; Revolve axis source unbounded; i18n mechanism and Pages base path unspecified/hardcoded.
**Decision:** BodyStateMap execution context with per-op deltas and per-op-class suppression semantics + 'skipped' status (ARCHITECTURE §9); reject any newer schema version (§11); Fusion-style insert-at-marker for rolled-back modeling (F1); evaluated body set owned by kernel client, derived state (§5); per-tab autosave keys with newest-first restore (§7); Revolve axis restricted to same-sketch line or origin axis (F3); in-house minimal t() with flat EN catalog; Pages base single-sourced from repository name.
**Consequences:** Worker implementation in M3 starts from correct multi-body semantics; forward-compatibility data loss impossible by construction; rollback editing behavior matches Fusion expectations (C4).

## ADR-0008 · 2026-07-10 · Corrections from plan critique round 3
**Context:** Third critique found the XML schema baked per-entity coordinates while F2/CLAUDE mandated shared point references — round-trip would silently destroy sketch connectivity and undermine C6 (v2 coincidence needs point identity). Also: Line angle reference undefined (untestable M2 acceptance), no protocol support for F6 triangle-count preview, M2 acceptance not exercising holes.
**Decision:** Per-sketch point pool in schema; entities reference `PointId`s; role refs are accessors. Face-based sketches serialize fingerprint + plane snapshot. Line angle absolute to sketch +X, relative field added for chained segments. `meshStats` request kind (counts only, no buffers). M2 acceptance extended with plate-with-hole and round-trip connectivity check.
**Consequences:** Sketch topology is identical before and after save/load; solver upgrade path intact; STL dialog preview has a real, cheap protocol path.

## ADR-0009 · 2026-07-10 · No license — all rights reserved (supersedes MIT proposal in ADR log context)
**Context:** Owner decided the repository stays public on GitHub but is for personal use only at this stage.
**Decision:** No LICENSE file, no license headers, no open-source badges. Default copyright applies: all rights reserved. README carries a copyright notice. Vision wording changed from "open-source" to "source-available".
**Consequences:** Under GitHub ToS, others may view and fork the public repo, but receive no legal right to use, modify, or redistribute the code. External contributions should not be accepted (no grant basis for PRs). A license can be added later at any time — the reverse (retracting a grant) is not possible, so starting restrictive is the conservative choice.

## ADR-0010 · 2026-07-10 · M0 scaffold judgment calls
**Context:** Building the M0 scaffold (Vite+React+TS, viewport, CI gate) surfaced several small decisions not fully pinned down by the three binding documents.
**Decision:**
- **Barlow font not bundled in M0.** `tokens.css` declares `--font-heading`/`--font-body` as `'Barlow', -apple-system, 'Segoe UI', Roboto, sans-serif` but ships no webfont files or CDN `<link>` — a Google Fonts fetch would be a "server call" on every load, in tension with C1/C2's static-host, offline-friendly intent. The real Barlow files land at M7 (styling milestone) with the token values unchanged; system fonts stand in until then.
- **HUD text crosses layer boundaries via props, not direct `t()` imports.** `viewport/Viewport.tsx` cannot import `app/i18n` (dependency-cruiser `viewport-scope` correctly rejected this on first attempt). Established convention: `app/` resolves `t('key')` and passes the translated string down as a prop to any `viewport/`-owned HUD element. Applies to all future overlay/HUD text in `viewport/`.
- **ESLint flat config (`eslint.config.js`) with `typescript-eslint` typed linting**, including `switch-exhaustiveness-check` (enforces CLAUDE.md's "exhaustive switch with never checks") and `no-explicit-any`. No legacy `.eslintrc` — flat config is the current ESLint default and CLAUDE.md doesn't pin a config format.
- **stylelint's `no-hardcoded-color` rule implemented directly** (`color-no-hex` + `color-named: never` + `function-disallowed-list` for `rgb/rgba/hsl/hsla`, overridden only for `app/ui-tokens/tokens.css`) instead of pulling in `stylelint-config-standard`, keeping devDependencies limited to the fixed stack.
- **Orbit scheme left at Three.js `OrbitControls` defaults** (LMB rotate / MMB dolly / RMB pan). MASTER_DOCUMENT §13 lists "default orbit scheme" as an explicit open decision (Fusion middle-drag vs. Shapr3D-style) — M0 does not resolve it, just needs *an* orbit control.
- `package.json` `license` field set to `"UNLICENSED"` (npm's standard "no license granted" marker), replacing `npm init`'s auto-generated `"ISC"` — consistent with ADR-0009, not a new grant.
**Consequences:** No network calls introduced at runtime; layer rules stay enforceable by dependency-cruiser without exceptions; tooling stays inside the fixed stack; orbit scheme and PL catalog remain explicitly open for a later ADR when MASTER_DOCUMENT §13 is resolved.
