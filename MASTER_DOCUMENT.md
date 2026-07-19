# NomaDim — Master Document
**Source-available parametric 3D CAD in the browser, for 3D-printing enthusiasts**
Version 1.1 · Status: authoritative spec · Owner: Kacper (NomaDirection)
Change vs 1.0: Option B adopted (ADR-0002) — solver-free sketching with numeric input + snapping; planegcs removed from v1 scope; architecture details moved to `ARCHITECTURE.md`.

Companion documents: `ARCHITECTURE.md` (binding code structure & rules) · `CLAUDE.md` (implementation agent instructions) · `DECISIONS.md` (ADR log).

---

## 1. Vision

NomaDim is a free, browser-based parametric CAD tool inspired by Autodesk Fusion 360's workflow: sketch on a plane → dimension precisely → extrude/revolve → finish with fillets/chamfers → export STL. It runs **fully client-side** (no backend, no account) and deploys as a static site to GitHub Pages. Target user: 3D-printing hobbyist who finds FreeCAD unintuitive and Fusion licensing annoying. Sketching UX follows the Shapr3D philosophy: fast numeric input and smart snapping instead of a constraint solver.

Non-goals (v1): assemblies, drawings, CAM, slicer integration, surfacing, sheet metal, collaboration, mobile UI, constraint solver (v2 candidate).

## 2. Hard constraints

- **C1** Runs 100% locally in modern Chromium/Firefox (WASM + WebGL2). No server calls after page load.
- **C2** Deployable to GitHub Pages (free tier): static files only, no custom headers → **single-threaded OCCT WASM build** (no SharedArrayBuffer).
- **C3** Max **100 bodies** per session. Enforced with warning at 90, hard stop at 100.
- **C4** Operation names match Fusion 360 terminology exactly (Extrude, Revolve, Fillet, Chamfer, Combine).
- **C5** All session state serializable to XML and restorable losslessly (parametric replay, not baked meshes).
- **C6** Sketch data model is **constraint-ready**: schema reserves constraint/dimension slots and stable point roles so a v2 solver is additive (no migration).

## 3. Technology stack

| Concern | Technology | Notes |
|---|---|---|
| Language | TypeScript (strict) | `strict: true`, no `any` in src/ |
| Framework | React 18 + Vite | SPA, single view |
| 3D viewport | Three.js | WebGL2, CAD-style navigation |
| CAD kernel | OpenCascade.js (OCCT 7.x → WASM) | Custom trimmed single-threaded build; runs only in Web Worker |
| Sketch precision | Custom snap engine + numeric input (in-house, `src/sketch/`) | No solver dependency in v1 |
| State | Zustand | `documentStore` + `sessionStore`, ownership per ARCHITECTURE §5 |
| XML | fast-xml-parser | Deterministic serialization |
| Styling | CSS Modules + design tokens | Brand per §12 |
| Tests | Vitest, Playwright | Pyramid per ARCHITECTURE §14 |
| Arch enforcement | dependency-cruiser in CI | Layer rules per ARCHITECTURE §3 |
| i18n | In-house minimal `t(key)` + flat EN JSON catalog | No library (minimal deps); PL catalog drops in at v1.1 |
| CI/CD | GitHub Actions → GitHub Pages | test + depcheck + build gates |
| License | **None — all rights reserved** | Public repo, no LICENSE file; no grant to use/modify/redistribute (ADR-0009). Do not add license headers or a LICENSE file. |

## 4. Architecture (summary — normative detail in ARCHITECTURE.md)

- Layers: `core → document → sketch / kernel / viewport → services → app`; OCCT lives exclusively in `kernel-worker/` (Web Worker); enforced by dependency-cruiser in CI.
- Document model = single source of truth, pure serializable TS, no kernel/render objects.
- One write path: UI → Command → CommandBus → Transaction → dirty ops → RegenScheduler → worker replay → transferable mesh buffers → viewport.
- Every timeline feature implemented via the three-file registry pattern (document codec / worker executor / UI feature) with registry-completeness test.

### 4.1 Regeneration
Edit of op *k* invalidates *k..n*; worker replays from cached shape *k−1*. Rollback marker limits evaluation. Failed op → error state (red chip), downstream dependent ops skipped, document stays editable. Full algorithm: ARCHITECTURE §9.

### 4.2 Edge references (scoped-down topological naming)
Fillet/chamfer/boolean references use geometric fingerprints (edge midpoint + direction + adjacent face kinds, tolerance-matched) resolved at regen. Unresolvable after upstream edit → op error, user re-picks. Accepted v1 tradeoff, surfaced in UI copy. Known corollary: editing a `CopyBody` translation moves all world-space fingerprints of the copy at once — every finishing op on that body errors together and needs re-picking; this is expected behavior, not a defect (log deliberately, don't 'fix' ad hoc).

## 5. Functional specification

### F1 — Timeline (operation history)
- Horizontal chip bar at viewport bottom; per-chip: **Edit** (reopen dialog, live preview), **Suppress/Unsuppress**, **Delete** (dependency warning), **Rename**.
- Drag rollback marker; ops right of marker greyed and not evaluated. **Modeling while rolled back inserts new ops at the marker position** (Fusion behavior); the marker advances past each inserted op; downstream ops re-evaluate on next regen and may enter error/skipped state.
- No reordering in v1 (documented limitation).
- Undo/redo Ctrl+Z / Ctrl+Y, ≥ 50 transactions.

### F2 — Sketch environment (Option B: numeric input + snapping, no solver)

**Entering a sketch:** pick origin plane (XY/XZ/YZ) or a planar face of a body; camera animates normal-to-plane; adaptive grid shown. Face-based sketches use a plane snapshot + face fingerprint re-resolved at regen (ARCHITECTURE §8); if the face disappears after an upstream edit, the sketch op errors and the user re-picks the plane.

**Entities:** Line, Axis (centerline), Rectangle (2-Point, Center), Circle (Center-Diameter), Arc (3-Point, Center-Point), Point, Polygon (n-sided). Construction-geometry toggle (X hotkey) per entity. Rectangle/Polygon decompose to line segments on commit (Fusion-like). Splines: out of scope v1.

**Axis tool (F3 revolve support):** draws a centerline — a line flagged as an axis, always construction, so it never joins a profile loop. Axis lines render as a teal dash-dot centerline and appear first in the Revolve dialog's axis list, named "Axis 1", "Axis 2", … (plain lines are still selectable, named "Line 1", "Line 2", …).

**Origin datum:** the sketch origin (0,0) is always snappable and outranks every other snap (a teal crosshair marks it), so geometry and dimensions can be based on it even in an empty sketch — the solver-free base point for dimensioning.

**Creation with numeric input (Shapr3D-style):**
- Starting a tool shows floating input fields next to cursor (Line: length + angle — **angle is absolute to the sketch +X axis**; chained segments additionally expose a relative-to-previous-segment angle field in the Tab cycle; Circle: diameter; Rectangle: width + height; Arc per variant; Polygon: sides + inscribed diameter).
- Typing focuses first field, `Tab` cycles fields, `Enter` commits with typed values overriding cursor position, `Esc` cancels. Chained tools (Line) continue from last endpoint until `Esc`/double-click. The fields are real DOM `<input inputmode="decimal">` elements (ADR-0045), so **tapping one raises the mobile soft keyboard** — physical-keyboard typing still works without focusing a field, with identical Tab/Enter/Esc semantics.
- Keyboard-only starts: a tool invoked purely via numeric input with no prior click anchors at the sketch origin (Line's first chain point, Circle/Polygon center). Committed endpoints landing exactly on an existing point merge with it — keyboard-drawn closed shapes share corner points like snapped ones (ADR-0012).
- Committed values bake into geometry (explicit coordinates). No solver propagation: moving one entity later does not drag others (design decision ADR-0002; documented in UI onboarding).

**Snapping & guides (the precision system):**
- Point snaps: endpoint, midpoint, center, quadrant, intersection, on-entity, grid.
- Inference guides: horizontal/vertical alignment to existing points, extension lines, parallel / perpendicular / tangent hints while drawing.
- Visual language mirrors Fusion/Shapr3D: snap glyph at point, dashed guide lines. Snap toggles in sketch toolbar; `Ctrl` temporarily disables snapping.

**Editing:**
- Select entity → **properties panel** with exact fields (endpoint coordinates, length, angle, radius/diameter, center). Edits are commands (undoable) and re-run downstream regen.
- Drag with full snapping; connected endpoints (coincident by construction, i.e. chained lines sharing a point ref) move together — shared points are real shared references, not merely coincident coordinates.
- Delete with dependency check (profile used downstream → warning listing dependent ops).

**Dimensions (reference / associative in v1):** the **Dim tool** (D) places persistent, AutoCAD-style dimension annotations between two selected points — five kinds: **Linear** (straight distance), **Horizontal** (|Δx|), **Vertical** (|Δy|), **Angle** (a→b inclination from +X), and **Radius** (|ab|, a = centre). The active kind is chosen from a selector next to the tool. Dimensions are **associative reference annotations**, not driving constraints (solver-free, ADR-0002): each value is measured live from the current point positions and re-renders as the geometry (or a dragged point) moves — typing a value does **not** move geometry. They persist in the model's constraint-ready `dimensions` slot and round-trip through XML; a v2 solver can later promote them to driving. (A transient `Measure`-style readout for hovered/selected entities also exists.) Precision workflow in v1 = numeric input at creation + properties panel afterwards; Dim adds a visible, saved record of key measurements.

**Finish Sketch:** profile regions auto-detected (planar loop detection) **including holes** — nested loops become inner boundaries of the enclosing profile (rectangle with circle inside = one profile with a hole). Open contours allowed but flagged. Profiles are picked later inside Extrude/Revolve exactly like Fusion. Profile identity is a stable hash of contributing entity IDs (ARCHITECTURE R7a), never a detection index — so geometric edits keep downstream Extrudes valid, while adding/removing boundary entities produces an explicit error instead of silently changing which region gets extruded.

### F3 — 3D operations (Fusion names)
While an Extrude/Revolve dialog is open, the geometry it will act on is highlighted amber in the viewport — the selected profile loops (outer + holes) and, for Revolve, the chosen axis line — drawn over the solid so the selection is always visible. Fillet/Chamfer highlight hovered and picked edges.

- **Extrude** (E): 1..n profiles → distance (one side / symmetric / two sides) or **Through All** (self-sizing, passes entirely through the target — the standard way to cut clean through a body), operation **New Body / Join / Cut / Intersect**. Taper: out of scope.
- **Revolve**: profiles + axis — an **axis/centerline or any line of the same sketch** (drawn with the Axis tool, listed first and named "Axis N") or an always-available origin axis (X/Y/Z); cross-sketch axis references are not allowed (dependency containment) + angle (default 360°), same operation options.
- Live ghost preview + direction arrows before confirm.

### F4 — Finishing
- **Fillet**: multi-edge pick, single radius per op.
- **Chamfer**: equal-distance only.
- Edge picking via raycast on tessellated edge polylines with hover highlight.

### F5 — Boolean (**Combine**)
Target body + tool bodies → **Join / Cut / Intersect**, "Keep Tools" option.

### F6 — STL export
Dialog: body scope (selected/visible/all), binary/ASCII, **linear deflection** (mm, default 0.1), **angular deflection** (deg, default 15), presets Low/Medium/High, triangle-count preview before download. OCCT `BRepMesh_IncrementalMesh` + STL writer. Units: mm.

### F7 — XML save/load
Export **`.nomadim.xml`** (Save button → download) / import via picker + drag-drop (Open button or drop a file on the viewport). Contains: schema version, units, sketches (**point pool + entities referencing point ids** — shared endpoints serialize as one point, preserving topology; axis/centerline flags; face-based sketches include fingerprint + plane snapshot; empty `constraints`/`dimensions` arrays per C6), full timeline (ops, params, suppressed flags, rollback position), body metadata, per-sketch visibility metadata, optional camera. Load = validate → replace document → full regen. Versioning per ARCHITECTURE §11 / ADR-0007: a **newer** schema minor is rejected (no silent forward data loss); older versions migrate. Implemented as the enclosing `<nomadim>` codec composing the per-element sketch/timeline codecs.

```xml
<nomadim version="1.1" units="mm">
  <sketches>
    <sketch id="sk1" plane="XY" name="Sketch1">
      <!-- Point pool: entities REFERENCE points; shared endpoints are one
           <point> — real topology survives round-trip (C6 requirement) -->
      <points>
        <point id="pt1" x="0" y="0"/>
        <point id="pt2" x="40" y="0"/>
        <point id="pt3" x="20" y="10"/>
      </points>
      <entities>
        <line id="e1" start="pt1" end="pt2" construction="false"/>
        <circle id="e2" center="pt3" r="5"/>
      </entities>
      <constraints/> <!-- reserved, v2 -->
      <dimensions/>  <!-- reserved, v2 -->
    </sketch>
    <!-- face-based sketch variant: fingerprint + plane snapshot serialized -->
    <sketch id="sk2" plane="face" name="Sketch2">
      <faceRef fingerprint="…"/>
      <planeSnapshot ox="0" oy="0" oz="10" xx="1" xy="0" xz="0" yx="0" yy="1" yz="0"/>
      <points/><entities/><constraints/><dimensions/>
    </sketch>
  </sketches>
  <!-- rollback is a 0-based op index; index == op count is the "past all
       ops" (roll-forward-to-end) state. Each op is its OWN element (tag owned
       by its OpDefinition, R10); the explicit index preserves timeline order
       through XML regrouping. -->
  <timeline rollback="2">
    <sketchOp index="0" id="op1" name="Sketch1" suppressed="false" sketch="sk1"/>
    <!-- profile ref = entity-set hash, never a detection index (R7a) -->
    <extrude index="1" id="op2" name="Extrude1" suppressed="false" sketch="sk1"
        distance="10" direction="one-side" distance2="0" operation="NewBody"
        target="" body="b1">
      <profile ref="sk1:p-8f3a2c"/>
    </extrude>
    <!-- Finishing ops (M4): edge references are geometric fingerprints
         resolved at regen (midpoint/direction/adjacent-face-kinds/tol),
         never topology indices — unresolvable → op error, user re-picks. -->
    <fillet index="2" id="op3" name="Fillet1" suppressed="false" body="b1" radius="2">
      <edge mx="10" my="0" mz="5" dx="1" dy="0" dz="0" kinds="cylinder,plane" tol="5"/>
    </fillet>
    <!-- CopyBody (F9): reproduces the source AS OF this position, +XYZ offset. -->
    <copyBody index="3" id="op4" name="Copy1" suppressed="false" source="b1"
        body="b2" tx="50" ty="0" tz="0"/>
  </timeline>
  <bodies>
    <body id="b1" name="Base" color="#1A6B5A" visible="true"/>
  </bodies>
</nomadim>
```

### F8 — Browser tree (left panel)
Sections **Origin** (plane visibility), **Sketches**, **Bodies**. Per body: eye toggle, rename (double-click/F2), color swatch → picker, delete. Per sketch: eye toggle (visibility), click to edit. Tree ⇄ viewport selection sync.

**Sketch preview visibility (Fusion parity).** A sketch is drawn as 3D reference geometry (its committed curves) while visible. A newly finished sketch is visible; the first feature that consumes it (Extrude/Revolve) auto-hides its preview, bundled into that feature's transaction so one undo restores both. Visibility is undoable per-sketch metadata (not part of the constraint-ready sketch geometry) toggled from the Sketches section; re-showing a sketch then editing the consuming feature does not re-hide it.

### F9 — Copy/Paste (whole body)
Ctrl+C / Ctrl+V on a body appends a `CopyBody` op referencing the source body. Semantics are **parametric and positional** (consistent with C5 replay): at regen, the copy reproduces the source *as of the `CopyBody` op's timeline position. Consequently, edits to ops **earlier** in the timeline propagate into the copy (Fusion-like), while ops appended **after** the copy do not. Optional translate-XYZ dialog after paste. UI copy explains this once on first use.

### F10 — Measure
Pick 2 points (vertex / edge-midpoint / face point snaps) → HUD: distance + ΔX/ΔY/ΔZ. Single circular edge → radius/diameter. `Esc` exits.

### F11 — Viewport
Home + 6-face view buttons (Front/Back/Left/Right/Top/Bottom, world Z-up) that snap the camera along the axis with the correct up vector; zoom-to-fit; a perspective/orthographic projection toggle (the button label shows the active projection). The toggle swaps `PerspectiveCamera`↔`OrthographicCamera` through a single `CameraRig` that preserves eye position, target, up vector, and apparent scale at the target plane, so the switch is visually seamless; zoom-to-fit and resize are projection-aware (ADR-0028). Anti-aliasing stays off to hold the 100-body ≥30 fps floor: both MSAA and full-screen FXAA multiply fragment cost enough to break the budget under software rasterization (the environment the fps guard runs in), so edge smoothing is deferred to a future GPU/body-count-gated quality toggle rather than shipped globally (ADR-0015, ADR-0027). A keyboard-shortcuts help overlay (toolbar button or the `?` key; Esc/backdrop closes) lists the global and sketch-mode shortcuts from a single catalog kept in sync with the handlers. A first-run onboarding hint shows a three-step getting-started cue on an empty document (dismissible, remembered in `localStorage`, and click-through so it never blocks the plane picker). The menus are responsive (ADR-0040): on phone-width screens (iPhone 12+) the toolbars reflow to full-width horizontal-scroll bars in distinct bands with side panels dropped/capped, so every button stays visible and clickable with no horizontal page scroll; desktop keeps the corner-anchored layout. The orbit-scheme setting (Fusion middle-drag vs RMB) is a follow-up. Shading: solid (lit) bodies; always-on edge display deferred (edges are tessellated on demand for picking/measure to protect the 100-body budget). 

## 6. Performance budget
- Regen of 30-op document < 2 s (mid-range laptop).
- Snap query + guide inference during cursor move < 4 ms at 500 sketch entities.
- 100 bodies × ~50k triangles ≥ 30 fps (batch static bodies if needed).
- App shell interactive < 2 s; OCCT WASM lazy-loaded with progress bar.

## 7. Error handling policy
Typed error taxonomy per ARCHITECTURE §12. Failed op → red chip + toast, last good state rendered. XML import validates fully before touching the document. **Autosave (ADR-0042):** the whole document is mirrored to `localStorage` (key `nomadim.document.v1`) on every change — debounced, plus an immediate flush on `visibilitychange`/`pagehide` so a backgrounded/killed mobile tab still saves — and restored automatically on the next load, so a refresh resumes the project rather than dropping to blank. Restore replays through the same load→regen path as File → Open; a parse failure (corrupt data / newer schema) or a blocked store (private mode) falls back to a fresh document instead of crashing. **Simplification vs the original design:** a single silent slot (auto-restore, no chooser dialog) rather than per-tab session keys + a newest-first restore dialog + 14-day pruning; consequently two tabs open on the same origin share one slot and the last writer wins. Multi-slot/multi-tab recovery and time-stamped history remain a follow-up. **New Project (ADR-0043):** clears the current model *and* the autosave slot to start fresh; since that discards work, a non-empty document first prompts to export a `.nomadim.xml` (Export & New / Discard & New / Cancel). Disabled when the document is already empty. Shortcut **Shift+N** (plain `N` is New Sketch).

## 8. Milestones

| # | Deliverable | Acceptance test |
|---|---|---|
| M0 | Scaffold: Vite+React+TS, Three.js viewport (grid, origin planes), ESLint/Prettier/Vitest, dependency-cruiser gate, GH Actions → Pages | Live URL renders viewport; depcheck active in CI |
| M1 | KernelWorker + trimmed OCCT build; hardcoded box → tessellate → render → STL download; live-handle counter | STL opens in slicer; handle count returns to baseline |
| M2 | Sketch mode: all F2 entities, SnapEngine + guides, NumericInputMachine, properties panel, profile detection incl. holes | Bracket sketch drawn to exact dimensions via keyboard only; plate-with-hole detected as one profile with inner loop; connectivity survives XML round-trip |
| M3 | Extrude + Revolve (all four operations); timeline chips edit/suppress/delete; undo/redo; registry pattern proven with completeness test | Editing sketch entity regenerates solid correctly |
| M4 | Fillet, Chamfer, Combine; edge fingerprints | Filleted boolean part survives upstream edit or errors gracefully |
| M5 | Browser tree, copy/paste, measure | 100-body stress session usable at 30 fps |
| M6 | STL dialog, XML export/import + migrations scaffold, autosave/restore | Round-trip: save → reload → identical body volumes |
| M7 | NomaDirection styling, shortcuts overlay, onboarding hints, README + user guide | Design review pass |

One milestone = one PR sequence; acceptance automated where feasible before merge.

## 9. Testing strategy
Per ARCHITECTURE §14: unit (snap engine, input machine, profiles, codecs, registries), kernel golden tests (volume/area/bbox tolerances), XML round-trip with committed fixtures, Playwright smoke (draw → numeric input → extrude → STL > 0 bytes).

## 10. Repository layout

```
nomadim/
├─ CLAUDE.md  MASTER_DOCUMENT.md  ARCHITECTURE.md  DECISIONS.md  README.md
├─ src/
│  ├─ core/           # math, ids, units, Result, errors
│  ├─ document/       # model, ops/, xml/ (+migrations), history
│  ├─ sketch/         # entities/, snap/, input/, profiles/, edit/
│  ├─ kernel/         # worker client, protocol.ts, mesh cache
│  ├─ kernel-worker/  # OCCT bridge, executors/, shape cache, stl
│  ├─ viewport/       # scene, controls, picking, overlays, MeshRepository
│  ├─ services/       # command bus, regen scheduler, autosave, file io
│  └─ app/            # React shell, features/<op>/, store/, ui-tokens/, i18n/
├─ public/wasm/
├─ tools/occt-build/  # trimmed build config + instructions
├─ tests/  (fixtures/ included)
└─ .github/workflows/deploy.yml
```

## 11. Out of scope (v1) — explicit
Constraint solver & driving dimensions (v2) · assemblies · joints · drawings · parameters table/expressions · splines · loft/sweep/shell/hole/thread · variable fillets · timeline reordering · Project/Include into sketch · multi-document · touch UI · slicer integration · dark theme.

## 12. Visual design (NomaDirection brand)
Teal `#1A6B5A` (primary/active/selection @40% alpha), navy `#0D1B2A` (panels), cream canvas, 8-px grid. Typography **Barlow** (600 headings / 400 body), monospace for numeric fields. Icons: Lucide stroke, token-colored. Light theme only. All values as CSS custom properties in `app/ui-tokens/tokens.css`; hardcoded colors fail lint. The full graphic identity — logo/logotype, palette, typography, usage — is documented in **`BRAND.md`** (the "N" mark lives in `public/brand/` + `src/app/features/brand/Logo.tsx`); use those assets as the default for visual changes.

**Restyle (ADR-0044):** the surface is intentionally elevated rather than flat — a navy elevation ramp (`--color-navy-500…900`), hairline borders + soft shadows (`--shadow-sm/md/lg`), a radius scale (`--radius-sm/md/lg`), a type scale (`--text-xs…xl`), and control-sizing tokens (`--control-h` 32 px / touch 44 px). One button language across every panel: rounded, raised, hover = teal border, active/primary = filled teal on cream, with a single `:focus-visible` ring. **Responsive (supersedes the ADR-0040 scroll-row for app actions):** on phone-width screens (iPhone 12+) the app-action cluster collapses behind a **hamburger** dropdown and controls grow to 44-px touch targets; the sketch tool row stays a horizontal scroller; desktop keeps the inline corner-anchored layout. Panels use solid raised surfaces + shadow (no `backdrop-filter` blur) to protect the 100-body ≥30 fps floor.

## 13. Open decisions (owner)
1. Repo name `nomadim`? 2. EN-only v1, PL in v1.1? 3. Default orbit scheme? 4. Camera in XML?
