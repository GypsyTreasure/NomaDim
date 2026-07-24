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

**Entering a sketch:** pick origin plane (XY/XZ/YZ), a **construction plane** (created separately in the Construct menu — see below — and listed in the plane picker), or a planar face of a body; camera animates normal-to-plane; adaptive grid shown. Face-based sketches use a plane snapshot + face fingerprint re-resolved at regen (ARCHITECTURE §8); if the face disappears after an upstream edit, the sketch op errors and the user re-picks the plane. Picking a construction plane copies its computed placement onto the sketch (copy-on-use), reusing the same world-placement path as a face plane, stable across regens (independent of body geometry).

**Construct menu (construction geometry, ADR-0073):** create reusable **construction planes** (G) and **construction axes** (J) from the base origin — separate from sketching, so one plane/axis serves many features. A construction **plane** is base origin plane + offset-along-normal + tilt-about-a-world-axis; a construction **axis** is a base origin direction rotated by an angle about a chosen axis, through an offset point. Both show a live amber **preview** that follows the dialog fields (Fusion-style). They live in the browser tree's **Construction** section (show/hide, edit, delete), persist in the document, and are consumed by **New Sketch** (sketch on a construction plane) and **Mirror** (reflect a body across a construction plane). Fast-follow (not yet wired): a construction axis as a revolve/pattern axis.

**Entities:** Line, Axis (centerline), Rectangle (2-Point, Center), Circle (Center-Diameter), Arc (3-Point, Center-Point), Point, Polygon (n-sided). Construction-geometry toggle (X hotkey) per entity. Rectangle/Polygon decompose to line segments on commit (Fusion-like). Splines: out of scope v1.

**Axis tool (F3 revolve support):** draws a centerline — a line flagged as an axis, always construction, so it never joins a profile loop. Axis lines render as a teal dash-dot centerline and appear first in the Revolve dialog's axis list, named "Axis 1", "Axis 2", … (plain lines are still selectable, named "Line 1", "Line 2", …).

**Origin datum:** the sketch origin (0,0) is always snappable and outranks every other snap (a teal crosshair marks it), so geometry and dimensions can be based on it even in an empty sketch — the solver-free base point for dimensioning.

**Creation with numeric input (Shapr3D-style):**
- Starting a tool shows floating input fields next to cursor (Line: length + angle — **angle is absolute to the sketch +X axis**; chained segments additionally expose a relative-to-previous-segment angle field in the Tab cycle; Circle: diameter; Rectangle: width + height; Arc per variant; Polygon: sides + inscribed diameter).
- Typing focuses first field, `Tab` cycles fields, `Enter` commits with typed values overriding cursor position, `Esc` cancels. Chained tools (Line) continue from last endpoint until `Esc`/double-click. The fields are real DOM `<input inputmode="decimal">` elements (ADR-0045), so **tapping one raises the mobile soft keyboard** — physical-keyboard typing still works without focusing a field, with identical Tab/Enter/Esc semantics. A **✓ commit button** in the HUD applies the typed values on touch, since the iOS decimal keypad has no Return key (ADR-0054).
- Keyboard-only starts: a tool invoked purely via numeric input with no prior click anchors at the sketch origin (Line's first chain point, Circle/Polygon center). Committed endpoints landing exactly on an existing point merge with it — keyboard-drawn closed shapes share corner points like snapped ones (ADR-0012).
- Committed values bake into geometry (explicit coordinates). No solver propagation: moving one entity later does not drag others (design decision ADR-0002; documented in UI onboarding).

**Tool workflow (ADR-0051):** entering a sketch starts in **Select/navigate** (no tool armed), so the first drag looks around instead of drawing. Shape tools (Circle, Rectangle, Arc, Polygon, Point, Axis) are **single-shot** — draw one, optionally type exact parameters, and the tool returns to Select. **Line** is the exception: it's the continuous **free-shape** tool (chained connected segments, for irregular polygons) and stays armed until `Esc`. **Finish Sketch** leads the toolbar as the primary exit action.

**Intersect view (ADR-0051/0052, toggle `J`):** the **Intersect** button clips away the near half of every body at the sketch plane (exposing the cut) and draws the **section** — both where the plane cuts THROUGH a body and the boundary outline of any body face lying ON the plane (e.g. the face you're sketching on) — as a thick violet reference with dot pivot points at its vertices. It's **display-only** (never editable, never persisted), computed by slicing the tessellated body meshes on the main thread (no kernel round-trip), respects hidden bodies, and clears when the sketch closes or the toggle is turned off. **Sketch strokes** are drawn thick for legibility on any screen.

**Snapping & guides (the precision system):**
- Point snaps: endpoint, midpoint, center, quadrant, intersection, on-entity, grid, and — while the Intersect view is on — the body **section / intersection-outline** points (ADR-0053), so new geometry connects to existing bodies. Snap tolerance is generous for easy connection on touch; snapping to an existing point makes a shared pool point (real topology).
- Inference guides: horizontal/vertical alignment to existing points, extension lines, parallel / perpendicular / tangent hints while drawing.
- Visual language mirrors Fusion/Shapr3D: snap glyph at point, dashed guide lines. Snap toggles in sketch toolbar; `Ctrl` temporarily disables snapping.

**Sketch Mirror & Pattern (#2, ADR-0070):** with entities selected, the sketch toolbar offers **Mirror** (across the sketch **X**/**Y** axis, or across a single selected **line** — the line stays, the rest reflect; **K** / **Shift+K**) and **Pattern** (an inline form: **Linear** — count + spacing along X or Y — or **Circular** — count + total angle about the sketch origin). Both generate plain new entities via the same `AddSketchGeometry` path as drawing (no timeline op, like Rectangle/Polygon expansion); shared endpoints among the selection stay shared in each copy, and mirrored arcs flip orientation. Deferred: mirror/pattern across an arbitrary picked point or an in-viewport axis pick, and live preview before commit.

**Editing (ADR-0052):**
- **Select** picks the **whole shape** a click lands on (all entities connected through shared points) → Properties shows **editable** Width / Height / Centre X / Centre Y (ADR-0055): changing them scales or translates every point of the shape about its centre, like setting dimensions during creation (segment count is shown read-only). **Change** picks a **single** point/line → Properties shows its exact editable fields (endpoint coordinates, length, angle, radius/diameter, center) and, for a line, **Horizontal / Vertical** buttons that level or plumb it (a touch-friendly alternative to precise dragging). Edits are commands (undoable) and re-run downstream regen. On phones the Properties panel is compact.
- Drag with full snapping; connected endpoints (coincident by construction, i.e. chained lines sharing a point ref) move together — shared points are real shared references, not merely coincident coordinates.
- Delete with dependency check (profile used downstream → warning listing dependent ops).

**Dimensions (reference / associative in v1):** the **Dim tool** (D) places persistent, AutoCAD-style dimension annotations between two selected points. The kind selector next to the tool defaults to **Auto (H/V)** — like AutoCAD's `DIM`, it auto-picks **Horizontal** or **Vertical** from the span's dominant axis (`|Δx| ≥ |Δy|`) at commit — and can be overridden to **Parallel** (aligned straight distance |ab|), **Horizontal** (|Δx|), **Vertical** (|Δy|), **Radius** (|ab| as R, a = centre), **Diameter** (2·|ab| as ⌀, a = centre), or **Angle** (a→b inclination from +X). `Auto` is a tool-level default only: it resolves to a concrete kind on commit, so the six stored kinds are Parallel(linear)/Horizontal/Vertical/Radius/Diameter/Angle (ADR-0049). Dimensions are **associative reference annotations**, not driving constraints (solver-free, ADR-0002): each value is measured live from the current point positions and re-renders as the geometry (or a dragged point) moves — typing a value does **not** move geometry. They persist in the model's constraint-ready `dimensions` slot and round-trip through XML; a v2 solver can later promote them to driving. (A transient `Measure`-style readout for hovered/selected entities also exists.) **Radial dims on circles/arcs (#1, ADR-0067):** a full circle has no rim pool point to use as the second pick, so a **single click on a circle or arc rim** with the Dim tool creates a radius/diameter dimension directly — the dimension stores the entity id and derives the rim endpoint from the entity's live radius (circle defaults to Diameter, arc to Radius; the kind selector still overrides). Precision workflow in v1 = numeric input at creation + properties panel afterwards; Dim adds a visible, saved record of key measurements.

**Finish Sketch:** profile regions auto-detected (planar loop detection) **including holes** — nested loops become inner boundaries of the enclosing profile (rectangle with circle inside = one profile with a hole). Open contours allowed but flagged. Profiles are picked later inside Extrude/Revolve exactly like Fusion. Profile identity is a stable hash of contributing entity IDs (ARCHITECTURE R7a), never a detection index — so geometric edits keep downstream Extrudes valid, while adding/removing boundary entities produces an explicit error instead of silently changing which region gets extruded.

### F3 — 3D operations (Fusion names)
While an Extrude/Revolve dialog is open, the geometry it will act on is highlighted amber in the viewport — the selected profile loops (outer + holes) and, for Revolve, the chosen axis line — drawn over the solid so the selection is always visible. Fillet/Chamfer highlight hovered and picked edges.

- **Extrude** (E): 1..n profiles → distance (one side / symmetric / two sides) or **Through All** (self-sizing, passes entirely through the target — the standard way to cut clean through a body), operation **New Body / Join / Cut / Intersect** (choosing a boolean op auto-selects a target body so OK is immediately usable, ADR-0053). Taper: out of scope.
- **Revolve**: profiles + axis — an **axis/centerline or any line of the same sketch** (drawn with the Axis tool, listed first and named "Axis N") or an always-available origin axis (X/Y/Z); cross-sketch axis references are not allowed (dependency containment) + angle (default 360°), same operation options.
- **Body type — Solid / Thin wall / Surface** (Extrude and Revolve): a **Solid** (default) is the filled prism/revolution. A **Thin wall** (#7, ADR-0068) is hollowed to a **Wall Thickness** (mm) — a single-wall shell for enclosures — *before* the boolean, so it still Joins/Cuts/Intersects an existing body (reuses the Shell hollowing helper `closedHollow`; walls too thick collapse with a clear error). A **Surface** (ADR-0072) sweeps the profile **wires** instead of the face, producing a **zero-thickness surface body** (Fusion "as Surface") — the vase / single-wall case; it is always a **new body** (a surface can't take a boolean) and renders double-sided so it's never culled edge-on. (Surface of an *open* sketch is a follow-up — profiles are closed loops in v1.)
- Live ghost preview + direction arrows before confirm.
- **Transform ops (P1, ADR-0061):** **Mirror** (I) reflects a body across a world origin plane (XY/XZ/YZ); **Pattern** (P) arrays a body **linearly** — along up to **three independent axes at once** (a box/grid: direction 1 plus optional directions 2 and 3, each a count + spacing + axis; a count of 1 disables a direction, capped at 1000 instances total, ADR-0065, #4) — or **circularly** (count + total angle about an axis); both offer **Join** (fuse into the source) or **New Body**. **Copy Body** (D) now also **rotates** (Euler XYZ) in addition to translating. **Move** (T, ADR-0066, #3) applies the same rigid transform (Euler XYZ rotation about the world origin, then XYZ translation in mm) to a body **in place** — same body id, no copy — for repositioning a body in 3D. All reuse the shared transform/boolean helpers (heal included, ADR-0057).

### F4 — Finishing
- **Fillet**: multi-edge pick, single radius per op.
- **Chamfer**: equal-distance only.
- Edge picking via raycast on tessellated edge polylines with hover highlight.
- **Shell (L, P2, ADR-0064):** hollows a body to a wall thickness, modifying it in place. The face to leave open is chosen by **outward world direction** (Top/Bottom/Front/Back/Left/Right, or **None** for a fully-enclosed hollow) — no viewport face-pick UI in v1. An open face uses `BRepOffsetAPI_MakeThickSolid`; a closed hollow offsets the solid inward and cuts it from the original (that API needs a face to remove). Result healed per ADR-0057; too-thick walls raise a `ProfileError`-style toast.

### F5 — Boolean (**Combine**)
Target body + tool bodies → **Join / Cut / Intersect**, "Keep Tools" option.

### F6 — Export (STL / STEP)
Dialog (ADR-0060): body scope (selected/visible/all), format, and — for the mesh formats — **linear deflection** (mm, default 0.1), **angular deflection** (deg, default 15), presets Low/Medium/High, live **triangle-count preview** at the chosen quality, and a **non-manifold warning** if a body would export a non-watertight mesh — all before download. OCCT `BRepMesh_IncrementalMesh` + STL writer. Units: mm. The count/warning come from a kernel `meshStats` request; watertightness is derived from the export mesh (every edge shared by exactly two triangles), so a body healed into a clean mesh (ADR-0057) is not falsely flagged. **STEP** is offered as a format alongside binary/ASCII STL (ADR-0063). The toolbar entry point is labelled just **"Export"** (not "Export STL", ADR-0065) so the STEP option is discoverable.

### F7a — STEP import (roadmap P1, ADR-0062)
**Import STEP** parses a `.step`/`.stp` file to a B-rep solid in the worker (`STEPControl_Reader`, healed per ADR-0057) and adds an **Import** base body to the timeline — a parentless root op carrying the solid as a base64 **BREP** payload embedded in the document, so the model round-trips through save/load with no external file (reconstructed at regen via `BRepTools`). Fillet/Chamfer edge fingerprints resolve on imported topology like any other body. Large payloads inflate the document/autosave; a resource-table split is a follow-up. **STEP export** (ADR-0063) is available in the Export dialog as a format alongside binary/ASCII STL — an exact B-rep for round-tripping to other CAD (mesh-quality controls are hidden for it). (STL-mesh import and 3MF export are the next interop steps.)

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
Constraint solver & driving dimensions (v2) · assemblies · joints · drawings · parameters table/expressions · splines · loft/sweep/hole/thread · variable fillets · timeline reordering · Project/Include into sketch · multi-document · touch UI · slicer integration · dark theme.

*(Shipped since v1.1: Shell (ADR-0064), thin/single-wall Extrude & Revolve (ADR-0068), datum planes (ADR-0069).)*

## 12. Visual design (NomaDirection brand)
Teal `#1A6B5A` (primary/active/selection @40% alpha), navy `#0D1B2A` (panels), cream canvas, 8-px grid. Typography **Barlow** (600 headings / 400 body), monospace for numeric fields. Icons: Lucide stroke, token-colored. Light theme only. All values as CSS custom properties in `app/ui-tokens/tokens.css`; hardcoded colors fail lint. The full graphic identity — logo/logotype, palette, typography, usage — is documented in **`BRAND.md`** (the "N" mark lives in `public/brand/` + `src/app/features/brand/Logo.tsx`); use those assets as the default for visual changes.

**Restyle (ADR-0044):** the surface is intentionally elevated rather than flat — a navy elevation ramp (`--color-navy-500…900`), hairline borders + soft shadows (`--shadow-sm/md/lg`), a radius scale (`--radius-sm/md/lg`), a type scale (`--text-xs…xl`), and control-sizing tokens (`--control-h` 32 px / touch 44 px). One button language across every panel: rounded, raised, hover = teal border, active/primary = filled teal on cream, with a single `:focus-visible` ring. **Responsive (supersedes the ADR-0040 scroll-row for app actions):** on phone-width screens (iPhone 12+) the app-action cluster collapses behind a **hamburger** dropdown and controls grow to 44-px touch targets; the sketch tool row stays a horizontal scroller; desktop keeps the inline corner-anchored layout. Panels use solid raised surfaces + shadow (no `backdrop-filter` blur) to protect the 100-body ≥30 fps floor. **Menu-driven top bar (ADR-0046):** in modeling mode the browser tree and the view bar are **collapsed by default** behind `Browser` and `View` toggles grouped with the app menu in the top-right cluster (the Browser toggle carries a live body-count badge); each reveals its panel in place. **New Sketch** leads the 3D-operation (timeline) bar, before Extrude, as the start of the modeling flow. **Touch parity (ADR-0049):** every keyboard-only action has an on-screen affordance so the app is fully usable on iPhone — a **Delete** button in the sketch toolbar (removes the current selection) and a header **Undo/Redo** cluster stand in for the `Delete` key and `Ctrl+Z`/`Ctrl+Y`, which iOS Safari does not provide. **Docked tool strip (ADR-0050):** in both modes the tools live in one reserved bottom dock — the sketch toolbar when sketching, the 3D timeline otherwise — laid out as a **two-row** horizontal scroller. The dock is a layout sibling of the canvas (not an overlay), so the model is never hidden behind it. The Browser (origin planes / sketches / bodies with per-item visibility) is reachable in **both** modes, so bodies can be hidden while sketching. **Mobile WebGL stability (ADR-0050):** the drawing-buffer pixel ratio is capped at 2, WebGL context loss is caught and recovered, and the render loop pauses while the tab is hidden — closing the iOS Safari renderer-crash paths. **Reliability hardening (ADR-0071):** rendering is fully **on-demand** — the render loop runs only during an active window that camera/data invalidations extend, then idles at zero GPU cost on a static model; **ResizeObserver callbacks coalesce** to one buffer reallocation per frame (killing the orientation-change realloc storm); and **regens coalesce** to one in-flight + one pending so an edit burst never backs up the single-threaded OCCT worker — the three baseline-pressure sources behind the iPhone crashes, on top of the deferred trimmed-WASM build (ADR-0011).

## 13. Open decisions (owner)
1. Repo name `nomadim`? 2. EN-only v1, PL in v1.1? 3. Default orbit scheme? 4. Camera in XML?
