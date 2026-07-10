# ARCHITECTURE.md — NomaDim
**Binding architecture specification. Version 1.1 (Option B — solver-free sketching).**
Violations of the rules in this document are build failures, not style issues. Changes to this document require an ADR entry in `DECISIONS.md`.

---

## 1. Purpose

This document defines the layer structure, dependency rules, data flow, ownership of state, and extension patterns for NomaDim. Its goal over a multi-month project:
- no duplicated logic (one mechanism per concern, one place per definition),
- no leakage between domain, kernel, rendering, and UI,
- adding a feature touches a predictable, minimal set of files,
- everything user-visible remains serializable and replayable.

`MASTER_DOCUMENT.md` defines *what* the product does; this document defines *how the code is organized*. On conflict about structure, this document wins.

## 2. System overview

```
             MAIN THREAD                                 WORKER THREAD
┌───────────────────────────────────────────┐   ┌───────────────────────────┐
│ app/          React UI, dialogs, tools    │   │ kernel-worker/            │
│   │  commands (only write path)           │   │   OCCT (opencascade.js)   │
│   ▼                                       │   │   executors per op type   │
│ services/     regen scheduler, autosave,  │◄──┤   shape cache (opId →     │
│               file io, command bus        │──►│     TopoDS_Shape)         │
│   │                    │                  │   │   tessellator, STL writer │
│   ▼                    ▼                  │   └───────────▲───────────────┘
│ document/   sketch/   viewport/           │               │
│ (model,     (geometry, (Three.js scene,   │      kernel/protocol.ts
│  ops, XML,   snapping,  picking, overlays)│      (typed messages, the ONLY
│  undo)       profiles)                    │       main↔worker contract)
│   └──────────┴──────────┴──── core/ ──────│
│         (math, ids, units, Result, errors)│
└───────────────────────────────────────────┘
```

## 3. Layer catalog

Each layer = one directory under `src/`. A layer may import only from layers listed in "May import". Everything else is forbidden.

| Layer | Responsibility | May import | Must never contain |
|---|---|---|---|
| `core/` | Vec2/Vec3/Mat4 math, ID types & factories, units, `Result<T,E>`, error taxonomy, invariant helpers | (nothing) | React, Three.js, OCCT, DOM, Zustand |
| `document/` | Document model: operations (timeline), sketch data, body metadata, undo/redo transactions, XML codecs, validation | `core` | geometry *computation*, rendering, workers, UI state |
| `sketch/` | 2D geometry evaluation (entity → curves), snap engine, guide inference, numeric-input state machine (pure logic), profile detection (planar loop finding) | `core`, `document` (types only) | React, Three.js, OCCT |
| `kernel/` | Main-thread kernel **client**: worker lifecycle, request/response correlation, cancellation, mesh buffer cache. Defines `protocol.ts` | `core`, `document` (op types) | OCCT imports (client side), React, Three.js |
| `kernel-worker/` | Worker entry. OCCT bridge, per-op executors, shape cache, tessellation, STL/measure geometry. **Only layer importing opencascade.js** | `core`, `document` (op types), `kernel/protocol` | React, Three.js, DOM, Zustand |
| `viewport/` | Three.js scene graph, camera & controls, picking/raycast, selection highlighting, sketch canvas overlay rendering, HUDs | `core`, `kernel` (mesh buffer types), `sketch` (read-only geometry for overlay) | document mutation, OCCT, business rules |
| `services/` | Orchestration: command bus, regeneration scheduler, dirty tracking, autosave, file import/export flows | `core`, `document`, `sketch`, `kernel` | React, Three.js, OCCT |
| `app/` | React components, Zustand stores, dialogs, toolbar/tool registration, keyboard shortcuts, i18n strings | everything above except `kernel-worker` | direct OCCT/worker access, direct Three.js scene mutation (goes through `viewport` API), XML string building |

**Enforcement:** `dependency-cruiser` runs in CI (`npm run depcheck`) with this rule set — a forbidden import fails the pipeline:

```js
// .dependency-cruiser.cjs (excerpt — keep in sync with the table above)
forbidden: [
  { name: 'core-is-leaf',      from: { path: '^src/core' },          to: { path: '^src/(?!core)' } },
  { name: 'document-purity',   from: { path: '^src/document' },      to: { path: '^src/(?!core|document)' } },
  { name: 'sketch-purity',     from: { path: '^src/sketch' },        to: { path: '^src/(app|viewport|kernel|kernel-worker|services)' } },
  { name: 'kernel-client-scope',from:{ path: '^src/kernel/' },       to: { path: '^src/(app|viewport|services|sketch)' } },
  // exception: kernel client MAY import the kernel-worker ENTRY FILE only,
  // solely for `new Worker(new URL('...', import.meta.url))` instantiation:
  { name: 'kernel-worker-entry-only', from: { path: '^src/kernel/' }, to: { path: '^src/kernel-worker/(?!index\\.ts)' } },
  { name: 'viewport-scope',    from: { path: '^src/viewport' },      to: { path: '^src/(app|services|document|kernel-worker)' } },
  { name: 'services-no-render',from: { path: '^src/services' },      to: { path: '^src/(app|viewport|kernel-worker)' } },
  { name: 'only-worker-occt',  from: { path: '^src/(?!kernel-worker)' }, to: { path: 'opencascade' } },
  { name: 'ui-not-in-domain',  from: { path: '^src/(core|document|sketch|kernel|kernel-worker|services)' }, to: { path: 'react|three|zustand' } },
  { name: 'no-worker-from-app',from: { path: '^src/app' },           to: { path: '^src/kernel-worker' } },
// Rule of maintenance: this config and the layer table above are ONE artifact —
// any PR changing either must change both (checked in review, noted in CLAUDE.md).
]
```

## 4. Single write path (command bus)

There is exactly **one** way to change the document:

```
UI event → Command (app/) → dispatch(command) on CommandBus (services/)
        → validate (document/) → apply as Transaction (document/)
        → dirty-mark ops ≥ index k → RegenScheduler enqueues → kernel
        → meshes arrive → viewport updates
```

Rules:
- **R1** React components never mutate `documentStore` directly. They dispatch commands. (Reading via selectors is fine.)
- **R2** Every command produces exactly one undoable `Transaction` (or fails atomically). Undo/redo lives in `document/`, implemented as inverse patches, ≥ 50 steps. **Applying a history entry (undo or redo) emits the same dirty-marks as the original transaction** — it flows through the identical scheduler → regen path. There is no second synchronization mechanism.
- **R3** A command is a plain serializable object `{ type, payload }` — this keeps the door open for scripting/macro recording later at zero cost.
- **R4** Regeneration is *only* triggered by the scheduler observing dirty state — never called ad hoc from UI. The scheduler debounces (one in-flight regen; a newer request cancels the older via generation counter).

## 5. State ownership

One owner per piece of state. Duplicating any of this elsewhere is a defect.

| State | Owner | Others access via | Persisted |
|---|---|---|---|
| Timeline ops, sketches, body metadata (name/color/visible), rollback position | `documentStore` (Zustand, in `app/store/`, data shape defined in `document/`) | selectors (read), commands (write) | XML + autosave |
| Selection, hover, active tool, active sketch id, snap toggles, camera mode | `sessionStore` | selectors / setters | no (camera optionally in XML) |
| OCCT shapes | worker shape cache (`kernel-worker/`), keyed `opId` + params-hash | never leave the worker | no |
| Viewport meshes (BufferGeometry) | `viewport/MeshRepository`, keyed `bodyId` | viewport API only | no |
| Undo/redo stacks | `document/history` | commands | no |
| **Evaluated body set** (which bodies exist at current rollback position, per-op status ok/error/skipped) | `kernel` client, updated from each regen response | sessionStore selector (browser tree, timeline chips render from it) | no — derived, rebuilt by regen |
| Numeric-input state (field values, focus, Tab cycle) | `sketch/input` state machine instance held by active tool | tool controller | no |

## 6. Kernel protocol (main ⇄ worker)

`src/kernel/protocol.ts` is the **only** shared contract. Discriminated unions, exhaustively switched on both sides:

```ts
type ReqId = Brand<string, 'ReqId'>;

type KernelRequest =
  | { id: ReqId; kind: 'init' }
  | { id: ReqId; kind: 'regen'; generation: number; fromIndex: number;
      plan: RegenPlan }                       // serialized ops + resolved profiles
  | { id: ReqId; kind: 'tessellate'; bodyIds: BodyId[]; quality: MeshQuality }
  | { id: ReqId; kind: 'exportStl'; bodyIds: BodyId[]; format: 'binary'|'ascii';
      linearDeflection: number; angularDeflectionDeg: number }
  | { id: ReqId; kind: 'meshStats'; bodyIds: BodyId[];        // F6 preview: triangle
      linearDeflection: number; angularDeflectionDeg: number } // counts only, no buffers
  | { id: ReqId; kind: 'stats' };             // live handle count (debug)

type KernelResponse =
  | { id: ReqId; kind: 'ok';        result: ... }
  | { id: ReqId; kind: 'progress';  opIndex: number }
  | { id: ReqId; kind: 'meshes';    meshes: MeshTransfer[] }   // Transferable buffers
  | { id: ReqId; kind: 'error';     error: KernelError };      // { opId, code, message }
```

Rules:
- **R5** Meshes cross the boundary exclusively as `Float32Array`/`Uint32Array` inside `Transferable` ArrayBuffers (positions, normals, indices, edge polylines). Never JSON geometry.
- **R5a** Each transferred edge polyline carries exact B-rep metadata: `{ kind: 'line'|'circle'|'other', radius?, center?, start, end }`. Measure (F10) and radius/diameter readouts compute **from this metadata on the main thread** — never by fitting the tessellated polyline (approximate values are unacceptable in CAD). No extra worker round-trip for measuring.
- **R6** Cancellation: worker checks `generation` between op executions; stale regens abort and free intermediate shapes.
- **R7** Sketch profiles are resolved **on the main thread** (`sketch/profiles`) and shipped in `RegenPlan` as `Profile { id: ProfileId; outer: Loop; inner: Loop[] }` — inner loops are holes (e.g. rectangle with a circular cutout, the canonical 3D-printing case). A `Loop` is an ordered list of curve segments in sketch-local 2D. The worker builds outer wire + inner wires → `MakeFace` with holes; it never re-derives profile topology.
- **R7a — profile identity:** `ProfileId` = stable hash of the **sorted set of contributing entity IDs** (outer + inner), *not* a detection-order index. Geometric edits keep the id; adding/removing a boundary entity changes it → dependent ops enter error state and the user re-picks (same philosophy as edge fingerprints, §8). Detection-order indices (`f0`, `f1`) are display labels only and must never be persisted as references.
- **R8** Every `TopoDS_Shape` allocation is paired with an explicit `.delete()` on invalidation. The worker maintains a live-handle counter; `stats` exposes it and dev builds assert it returns to baseline after cache clear. WASM heap leaks are treated as P1 bugs.

## 7. Operation extension pattern (anti-duplication core)

Every timeline feature (`Sketch`, `Extrude`, `Revolve`, `Fillet`, `Chamfer`, `Combine`, `CopyBody`, …) is defined in **exactly three files plus one test**, each in its own layer, keyed by the same `OpType` string:

| File | Layer | Exports |
|---|---|---|
| `document/ops/<op>.ts` | document | TS type, param schema + `validate()`, XML `toXml()/fromXml()`, `invalidates()` (dependency semantics) |
| `kernel-worker/executors/<op>.ts` | kernel-worker | `execute(ctx: ExecCtx, op): void` — reads input bodies from `ctx.bodies` (BodyStateMap, §9), writes results back; pure OCCT |
| `app/features/<op>/` | app | dialog component, toolbar entry, hotkey, live-preview hooks |
| `tests/ops/<op>.spec.ts` | tests | golden model test (volume/bbox/area tolerance) + XML round-trip |

Central registries: `document/ops/registry.ts`, `kernel-worker/executors/registry.ts`, `app/features/registry.ts`.
**R9** A unit test `registry-completeness.spec.ts` asserts every `OpType` is present in all three registries — adding half an operation cannot pass CI.
**R10** Timeline UI, XML codec, regen loop, and toolbar all *iterate registries*; they contain zero per-op `if/switch` chains. If you are writing `if (op.type === 'Extrude')` outside a registry file, you are duplicating the mechanism — stop and use the registry.

## 8. Identity & referencing

All IDs are branded string types from `core/ids.ts` (`OpId`, `BodyId`, `SketchId`, `EntityId`), generated by one factory (nanoid, 8 chars, collision-checked within document). Never raw `string` in signatures.

- Sketch points live in a **per-sketch point pool** (`PointId`); entities reference pool ids. A shared endpoint is one pool point — topology, not coincidence — and serializes as one `<point>` (round-trip preserves connectivity; prerequisite for v2 solver coincidence). Role references `"<entityId>.<pointRole>"` (e.g. `"e12.p1"`, `"e7.center"`) are accessors resolving to pool ids; roles enumerated per entity type in `document/sketch-types.ts`.
- Bodies are *produced* by ops: `bodyId` is minted by the op that creates the body (`Extrude(NewBody)`, `CopyBody`, …) and stored in op params → deterministic across regens and XML round-trips.
- 3D edge references (Fillet/Chamfer): geometric fingerprint `{ midpoint, direction, adjFaceKinds, tol }` resolved at regen. Unresolvable → op error state, user re-picks (accepted v1 tradeoff, see MASTER_DOCUMENT §4.2).
- 3D **face** references (sketch-on-face planes): fingerprint `{ centroid, normal, area, tol }`, same resolve-at-regen / error-on-miss semantics. A face-based `Sketch` additionally stores a **plane snapshot** (origin + X/Y axes captured at creation) used by the main thread for editing and overlay rendering — the worker re-resolves the fingerprint at regen and places the sketch's local-2D profiles on the *resolved* plane. This keeps R7 intact (main thread never needs live kernel topology). A face-based sketch op declares an `invalidates()` dependency on the op producing that body.

## 9. Regeneration algorithm

The timeline is a **multi-body DAG**, not a linear chain. The worker's evaluation context is a `BodyStateMap: Map<BodyId, TopoDS_Shape>` — the state of every live body after op *i*. Executors receive the map, read their input bodies, and write their result: `execute(ctx: ExecCtx, op): void` where `ExecCtx = { bodies: BodyStateMap; resolveFingerprint(...); oc: OpenCascadeInstance }`. Per-op shape cache stores the *delta* (shapes changed by op *i*) so replay-from-*k* restores the map cheaply.

```
on transaction commit:
  k = lowest dirty op index (params/inputs changed, or upstream dirty via invalidates());
      op insertion at rollback marker (F1) dirties from the marker index
  scheduler.enqueue({ generation: ++gen, fromIndex: k })

worker on regen(g, k, plan):
  restore BodyStateMap to state after op k-1 (from cache); free cached deltas ≥ k
  for i in k..min(rollbackIndex, plan.length-1):
    if plan[i].suppressed:
      body-producing op (Extrude NewBody, CopyBody):  its bodyId absent from map
      body-modifying op (Join/Cut/Fillet/Chamfer/Combine): target body keeps prior state
      → downstream ops whose input bodies are absent enter 'skipped' state (grey chip)
      continue
    executors[plan[i].type].execute(ctx, plan[i])
    on error → respond {error, opId}; ops depending on the failed op's outputs → skipped;
               map keeps last good states; stop
    cacheDelta(i); check generation, abort if stale
  tessellate changed bodies (viewport quality) → transfer meshes + evaluated body list
```

- Viewport tessellation quality: linear deflection 0.25 mm / angular 20°. Export uses user-specified values — never share these constants; they live in `core/units.ts` as named constants used by both call sites.
- Rollback marker = `regenLimit` in document; ops beyond it exist, serialize, but never execute. **New ops created while rolled back insert at the marker position** (Fusion behavior); the marker advances past each inserted op.

## 10. Sketch subsystem (Option B — solver-free)

No constraint solver. Precision comes from **numeric input + snapping**. Architecture:

```
sketch/
├─ entities/       # Line, Circle, Arc, Rectangle*, Polygon*, Point
│                  # (*macro entities: expand to primitive segments on commit)
├─ snap/           # SnapEngine + SnapProvider[] (see below)
├─ input/          # NumericInputMachine (field cycle, Tab/Enter/Esc semantics)
├─ profiles/       # planar-graph loop detection → ProfileLoop[]
└─ edit/           # drag semantics, property-edit application (pure functions)
```

**SnapEngine:** given cursor point + current tool context, queries an ordered list of `SnapProvider`s, each returning candidates `{ point, kind, priority, sourceRef }`. Kinds (v1): `endpoint`, `midpoint`, `center`, `quadrant`, `intersection`, `on-entity`, `grid`, and inference guides `align-h`, `align-v`, `parallel`, `perpendicular`, `tangent`. Highest priority within pixel tolerance wins; active snap rendered by `viewport/` overlay (engine computes, viewport draws — never mixed).
**R11** Snap tolerance is in *screen pixels*, converted using camera scale by the caller; the engine itself is unit-pure and fully unit-testable without a DOM.

**NumericInputMachine:** per-tool field definitions (Line: length, angle; Circle: diameter; Rectangle: width, height; Arc: radius/angle). Typing focuses field 1, `Tab` cycles, `Enter` commits entity with typed values overriding cursor position, `Esc` cancels. Committed values are **baked coordinates** — no live constraint propagation (by design, ADR-0002).

**Constraint-ready data model (mandatory):** `Sketch` schema carries `constraints: []` and `dimensions: []` arrays (empty in v1), a shared point pool (§8), and every entity exposes stable point roles. This guarantees a v2 solver (planegcs) is additive — no schema migration, no XML version break beyond a minor bump.

**Editing:** select entity → properties panel writes go through commands (`EditSketchEntity`), drag uses `sketch/edit` pure functions + SnapEngine. Rectangles/polygons decompose to lines on commit (Fusion-like), so editing stays uniform.

## 11. XML persistence rules

- Codec lives only in `document/xml/` (+ per-op codecs via registry). Nothing else may build or parse XML strings.
- Schema version `major.minor` in root attribute. Loader: **reject any file version newer than the app's schema version (major OR minor)** with a clear "update NomaDim to open this file" message — accepting a newer minor would silently drop unknown elements (e.g. v2 constraints in a v1 app) and destroy them on resave. Older versions load via ordered migration functions in `document/xml/migrations/`. Every schema change = new migration + round-trip test with a fixture file committed under `tests/fixtures/`.
- Serialization must be deterministic (stable attribute order, sorted collections) so files diff cleanly in git.

## 12. Error taxonomy (`core/errors.ts`)

| Class | Origin | UI behavior |
|---|---|---|
| `ValidationError` | command/param validation | dialog inline message, nothing applied |
| `KernelError { opId, code }` | worker executor | red timeline chip + toast, doc stays consistent |
| `ProfileError { entityIds }` | profile detection | offending entities highlighted in sketch |
| `ImportError { line, detail }` | XML loader | modal with diagnostics, nothing loaded |
| `InternalError` | invariant breach | error boundary + "report issue" with state dump |

No silent catches. `Result<T, E>` in domain layers; exceptions only at async boundaries.

## 13. Naming & file conventions

- Domain vocabulary = Fusion 360 vocabulary (`ExtrudeOp`, `CombineOp`, `SketchDimension` type reserved), never generic synonyms.
- One exported concern per file; files ≤ ~300 lines; `index.ts` barrels only at layer roots (deep imports across layers forbidden — import from the layer barrel).
- React components `PascalCase.tsx` colocated with `.module.css`; hooks `useX.ts`; stores `xStore.ts`.
- All colors/typography via CSS custom properties from `app/ui-tokens/tokens.css` (brand per MASTER_DOCUMENT §12). Hardcoded hex in components fails lint (stylelint rule).
- i18n: user-visible strings via `t('key')` from day one (EN catalog); no literals in JSX.

## 14. Testing architecture

| Level | Scope | Tooling |
|---|---|---|
| Unit | core math, snap engine, input machine, profile detection, XML codecs, registries | Vitest (jsdom-free) |
| Kernel golden | each executor: input plan → volume/area/bbox within 1e-3 | Vitest + OCCT WASM in Node |
| Round-trip | doc → XML → doc → regen → compare body volumes | Vitest |
| E2E smoke | draw → dimension via numeric input → extrude → export STL (file size > 0) | Playwright |

CI gate (`main` protected): `lint`, `typecheck`, `depcheck`, `test`, `build`. E2E on PR label or nightly.

## 15. Change management

- **ADR:** any decision touching layers, protocol, schema, or this document → one entry in `DECISIONS.md` (`ADR-NNNN: title, date, context, decision, consequences`), same PR.
- **Docs-first:** a PR changing behavior specified in MASTER_DOCUMENT.md must update that document in the same PR.
- **Milestone discipline:** branches `feat/mX-*`, one milestone per PR sequence, acceptance test from MASTER_DOCUMENT §8 automated where feasible before merge.
- **Definition of done** (every feature): spec-conformant → serializable + round-trip test → undoable → error path handled → registries complete → CI green.
