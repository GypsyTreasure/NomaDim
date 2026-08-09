# NomaDim — Master Document
**Source-available parametric 3D CAD in the browser, for professional makers (workshops, small/mid manufacturers, 3D-printing farms)**
Version 1.1 · Status: authoritative spec · Owner: Kacper (NomaDirection)
Change vs 1.0: Option B adopted (ADR-0002) — solver-free sketching with numeric input + snapping; planegcs removed from v1 scope; architecture details moved to `ARCHITECTURE.md`.

Companion documents: `ARCHITECTURE.md` (binding code structure & rules) · `CLAUDE.md` (implementation agent instructions) · `DECISIONS.md` (ADR log).

---

## 1. Vision

NomaDim is a browser-based parametric CAD tool inspired by Autodesk Fusion 360's workflow: sketch on a plane → dimension precisely → extrude/revolve → finish with fillets/chamfers → export STL. It runs **fully client-side** (no backend, no account) and deploys as a static site to GitHub Pages. Target user: **professional makers** — small and mid-size companies, workshops, and 3D-printing farms — who need precise, reliable parts without a heavyweight CAD install or per-seat licensing. Sketching UX follows the Shapr3D philosophy: fast numeric input and smart snapping instead of a constraint solver.

Non-goals (v1): assemblies, drawings, CAM, slicer integration, surfacing, sheet metal, collaboration, mobile UI, constraint solver (v2 candidate).

## 2. Hard constraints

- **C1** Runs 100% locally in modern Chromium/Firefox (WASM + WebGL2). No server calls after page load.
- **C2** Deployable to GitHub Pages (free tier): static files only, no custom headers → **single-threaded OCCT WASM build** (no SharedArrayBuffer). **Delivery (M8, ADR-0078):** the kernel ships as a build-time gzip (`opencascade.full.wasm.gzc`, ~50 MB → ~13 MB) fetched with a real progress bar and gunzipped in-browser via native `DecompressionStream` (the raw `.wasm` is never downloaded); the kernel boots on idle so the shell + empty viewport paint first; a service worker + web manifest make repeat/offline visits instant and the app installable. A trimmed OCCT build (< 8 MB) is the outstanding follow-up (needs an emscripten toolchain).
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

**Entering a sketch:** pick origin plane (XY/XZ/YZ), a **construction plane** (created separately in the Construct menu — see below — and listed in the plane picker), or a planar face of a body; camera animates normal-to-plane; adaptive grid shown. **Face picking (ADR-0113):** the clicked face is resolved by true point-to-triangle distance plus the ray's face normal, so the sketch lands on the exact face clicked (not a nearer-centroid neighbour) and its plane normal is outward; the in-plane axes are oriented Fusion-style — screen-up follows world +Z on a wall, +Y on a top/bottom face. Face-based sketches use a plane snapshot + face fingerprint re-resolved at regen (ARCHITECTURE §8); if the face disappears after an upstream edit, the sketch op errors and the user re-picks the plane. Picking a construction plane copies its computed placement onto the sketch (copy-on-use), reusing the same world-placement path as a face plane, stable across regens (independent of body geometry).

**Construct menu (construction geometry, ADR-0073):** create reusable **construction planes** (G) and **construction axes** (J) from the base origin — separate from sketching, so one plane/axis serves many features. A construction **plane** is a base plane + offset-along-normal + tilt-about-an-axis; a construction **axis** is a base direction rotated by an angle about a chosen axis, through an offset point. **The base and the rotation axis may be an origin datum OR another user-created datum** (ADR-0089): a plane can be built on a user plane, an axis on a user axis, and either can rotate about a user axis — the Construct dialog appends the existing datums to the base/about-axis selects (self excluded, cyclic/missing references degrade safely to the origin base). Both show a live amber **preview** that follows the dialog fields (Fusion-style). They live in the browser tree's **Construction** section (show/hide, edit, delete), persist in the document, and are consumed by **New Sketch** (sketch on a construction plane), **Mirror** (reflect a body across a construction plane), and **Revolve** (a construction axis as the revolve axis).

**Entities:** Line, Axis (centerline), Rectangle (2-Point, Center), Circle (Center-Diameter), Arc (3-Point, Center-Point), Point, Polygon (n-sided), **Spline** (B, fit-point, AutoCAD-like — click fit points, Enter finishes an open curve, clicking the first point closes it; ADR-0075). Construction-geometry toggle (X hotkey) per entity. Rectangle/Polygon decompose to line segments on commit (Fusion-like). A spline is a first-class entity: a solver-free centripetal Catmull–Rom curve through its fit points, tessellated to a polyline for snap, selection, and profiles — so it is **extrudable/revolvable** (as one polyline loop edge; a closed spline bounds a region by itself like a circle).

**Edit tools:** **Change** (M) repositions existing points; **Split** (T, ADR-0099) divides a picked line wherever another line crosses it, inserting a **shared joint point** at each crossing (real topology, not just coincident coordinates) — the AutoCAD "Break" / Fusion split; when the crossing is interior to the other line, that line is split too so the joint is mutual. Ortho-only dimensioning is the Dim tool's default (its `auto` kind resolves strictly to horizontal/vertical; aligned only on explicit request). **Line pick (ADR-0100):** a Dim click on a line (not its endpoints) dimensions the line's LENGTH in one click; point tracking is the SnapEngine snapping the click to endpoints/intersections.

**Axis tool (F3 revolve support):** draws a centerline — a line flagged as an axis, always construction, so it never joins a profile loop. Axis lines render as a teal dash-dot centerline and appear first in the Revolve dialog's axis list, named "Axis 1", "Axis 2", … (plain lines are still selectable, named "Line 1", "Line 2", …).

**Import SVG/DXF reference (ADR-0076, ADR-0077):** the toolbar's **Import SVG/DXF** button loads reference artwork (`.svg` / `.dxf`) into the active sketch as **real, extrudable sketch geometry** (ADR-0089) — every imported vertex is a snap target, every shape is individually selectable/deletable, and because it is ordinary profile-forming geometry the flow is simply Import → Finish Sketch → Extrude/Revolve (no construction-toggle step). Dense tessellated curves (real DXFs reach thousands of vertices per polyline) are **simplified with Ramer–Douglas–Peucker** (0.05 mm) on import so the sketch stays interactive (snap/overlay are O(entities)) without a visible shape change. SVG supports line/rect/polyline/polygon/circle/ellipse/path (Béziers, elliptical arcs and ellipses are sampled to polylines, circles stay analytic; Y is flipped so art is upright; `transform` attributes are ignored with a warning). DXF supports LINE/CIRCLE/ARC/POINT/ELLIPSE/LWPOLYLINE/POLYLINE (including bulge arcs)/SPLINE, and — crucially for real AutoCAD exports — resolves **BLOCK/INSERT** placements (translation, scale, rotation, nesting, arrays), since most drawings keep their geometry in blocks. Annotations (text, dimensions, hatches) are skipped and reported in a toast. Imports are ordinary sketch entities: they round-trip through save/load and undo. Positioning assumes 1 user unit = 1 mm; SVG `transform`/`use`, DXF hatch outlines, and reusable-block grouping are follow-ups. **Robustness (ADR-0085):** real professional drawings carry degenerate artifacts (zero-length lines) — these are dropped during import so one bad entity never rejects the whole file, and the view **auto-zooms to fit** the imported geometry (which may sit far from the origin), so a large façade/profile DXF lands framed and usable instead of appearing empty. **Layer filtering (ADR-0088, ADR-0089):** a DXF opens a layer picker so the user manually chooses which source layers to import (per-layer counts, all-on by default; the picker appears for **any** DXF, including single-layer files); block members inherit their INSERT's layer. SVG (no layers) imports straight through.

**Origin datum:** the sketch origin (0,0) is always snappable and outranks every other snap (a teal crosshair marks it), so geometry and dimensions can be based on it even in an empty sketch — the solver-free base point for dimensioning.

**Creation with numeric input (Shapr3D-style):**
- Starting a tool shows floating input fields next to cursor (Line: length + angle — **angle is absolute to the sketch +X axis**; chained segments additionally expose a relative-to-previous-segment angle field in the Tab cycle; Circle: diameter; Rectangle: width + height; Arc per variant; Polygon: sides + inscribed diameter).
- Typing focuses first field, `Tab` cycles fields, `Enter` commits with typed values overriding cursor position, `Esc` cancels. Chained tools (Line) continue from last endpoint until `Esc`/double-click. The fields are real DOM `<input inputmode="decimal">` elements (ADR-0045), so **tapping one raises the mobile soft keyboard** — physical-keyboard typing still works without focusing a field, with identical Tab/Enter/Esc semantics. A **✓ commit button** in the HUD applies the typed values on touch, since the iOS decimal keypad has no Return key (ADR-0054).
- Keyboard-only starts: a tool invoked purely via numeric input with no prior click anchors at the sketch origin (Line's first chain point, Circle/Polygon center). Committed endpoints landing exactly on an existing point merge with it — keyboard-drawn closed shapes share corner points like snapped ones (ADR-0012).
- Committed values bake into geometry (explicit coordinates). No solver propagation: moving one entity later does not drag others (design decision ADR-0002; documented in UI onboarding).

**Tool workflow (ADR-0051):** entering a sketch starts in **Select/navigate** (no tool armed), so the first drag looks around instead of drawing. Shape tools (Circle, Rectangle, Arc, Polygon, Point, Axis) are **single-shot** — draw one, optionally type exact parameters, and the tool returns to Select. **Line** is the exception: it's the continuous **free-shape** tool (chained connected segments, for irregular polygons) and stays armed until `Esc`. **Finish Sketch** leads the toolbar as the primary exit action.

**Intersect view (ADR-0051/0052, toggle `J`):** the **Intersect** button clips away the near half of every body at the sketch plane (exposing the cut) and draws the **section** — both where the plane cuts THROUGH a body and the boundary outline of any body face lying ON the plane (e.g. the face you're sketching on) — as a thick violet reference with dot pivot points at its vertices. It's **display-only** (never editable, never persisted), computed by slicing the tessellated body meshes on the main thread (no kernel round-trip), respects hidden bodies, and clears when the sketch closes or the toggle is turned off. **Sketch strokes** are drawn thick for legibility on any screen. **Solid cut cap (ADR-0122):** the cut face is filled translucently (its welded loops, holes subtracted) so a clipped **solid reads as solid**, not a hollow shell, and the clip is biased a hair off the plane so a coplanar body face doesn't z-fight/flicker. **Project Section (`Y`, ADR-0122):** turns the current section into REAL sketch **lines** (welded so they close into profiles) via the normal add-geometry path — now editable geometry you can box-select, delete, flip to **construction/normal** (`X` on a selection toggles it), and feed straight into Extrude/Revolve.

**Snapping & guides (the precision system):**
- Point snaps: endpoint, midpoint, center, quadrant, intersection, on-entity, grid, and — while the Intersect view is on — the body **section / intersection-outline** points (ADR-0053), so new geometry connects to existing bodies. Snap tolerance is generous for easy connection on touch; snapping to an existing point makes a shared pool point (real topology).
- Inference guides: horizontal/vertical alignment to existing points, extension lines, parallel / perpendicular / tangent hints while drawing.
- Visual language mirrors Fusion/Shapr3D: snap glyph at point, dashed guide lines. Snap toggles in sketch toolbar; `Ctrl` temporarily disables snapping.
- **Ortho toggle (`O`, ADR-0105):** an AutoCAD-style Ortho (H/V lock) button in the toggles block turns the horizontal/vertical alignment inference off/on (default on). When off, the align-h/align-v guides, their snap candidates, and the H∩V corner are suppressed for free-form drawing; point/parallel/perpendicular/tangent/grid snaps stay active. Transient UI state (not persisted).

**Sketch Mirror & Pattern (#2, ADR-0070):** with entities selected, the sketch toolbar offers **Mirror** (across the sketch **X**/**Y** axis, or across a single selected **line** — the line stays, the rest reflect; **K** / **Shift+K**) and **Pattern** (an inline form: **Linear** — count + spacing along X or Y — or **Circular** — count + total angle about the sketch origin). Both generate plain new entities via the same `AddSketchGeometry` path as drawing (no timeline op, like Rectangle/Polygon expansion); shared endpoints among the selection stay shared in each copy, and mirrored arcs flip orientation. Deferred: mirror/pattern across an arbitrary picked point or an in-viewport axis pick, and live preview before commit.

**Editing (ADR-0052):**
- **Select** picks the **whole shape** a click lands on (all entities connected through shared points) → Properties shows **editable** Width / Height / Centre X / Centre Y (ADR-0055): changing them scales or translates every point of the shape about its centre, like setting dimensions during creation (segment count is shown read-only). **Marquee box-select (#6, ADR-0119):** Select is also the default drag tool — with no draw tool active (sketch entry, or after Esc), dragging a rubber-band box selects multiple shapes AutoCAD/Fusion-style: **left→right = window** (only shapes wholly inside the box), **right→left = crossing** (anything the box touches). The box draws **solid blue** for window and **dashed green** for crossing; a plain click (no drag) still single-selects. Selected shapes are the whole connected shapes, exactly as a single click resolves them. **Change** picks a **single** point/line → Properties shows its exact editable fields (endpoint coordinates, length, angle, radius/diameter, center) and, for a line, **Horizontal / Vertical** buttons that level or plumb it (a touch-friendly alternative to precise dragging). Edits are commands (undoable) and re-run downstream regen. On phones the Properties panel is compact.
- Drag with full snapping; connected endpoints (coincident by construction, i.e. chained lines sharing a point ref) move together — shared points are real shared references, not merely coincident coordinates. **Snapping while moving (ADR-0121):** repositioning geometry — a Select/Change drag, Stretch or Move — uses the same snap engine as drawing: point/grid snap, **ortho H/V** (measured from the grab point) and alignment tracing all apply, and the moving geometry is excluded so it never snaps to itself.
- **Marquee box-select in every tool (ADR-0121):** a rubber-band drag selects shapes regardless of the active tool (a click still does the tool's own action), so you never have to switch back to Select just to pick several shapes. Window (L→R) vs crossing (R→L) as in ADR-0119.
- **Ctrl/Cmd multi-select (ADR-0134):** holding Ctrl (or Cmd) while clicking or box-selecting ADDS the picked shape(s) to the current selection — or removes a shape that's already fully selected — like AutoCAD, instead of replacing the selection.
- **Preselection → multi-tools (ADR-0134):** with shapes already selected, activating a selection-based tool acts on that preselection — Offset offsets the whole selection; Move/Stretch seed their captured point set from it so you can type an exact move immediately.
- **Parameters window for every value (ADR-0134):** numeric input for all sketch tools — including Offset (Distance) and Move/Stretch (ΔX/ΔY) — is typed in the same floating parameters window used by Circle/Line, not on the toolbar.
- **Stretch** (E, #7, ADR-0120, AutoCAD-like): box-select part of the sketch, then move it. A box drag captures the pool points inside it; a following press-drag translates just those points, so shapes fully inside the box move whole and segments with only one endpoint inside rubber-band (shared-point topology). **Typed values (ADR-0134):** with a set captured (by box, or seeded from a preselection when the tool is activated), the parameters window accepts an exact **ΔX/ΔY** — Enter applies it, used verbatim like AutoCAD — as an alternative to dragging. Commits one undoable move; re-box for another stretch.
- **Move** (V, #3, ADR-0121, AutoCAD-like): box-select whole shapes, then reposition them rigidly — every point of each selected shape moves together (unlike Stretch, nothing rubber-bands). Same snapping/ortho as above, or type an exact **ΔX/ΔY** in the parameters window (ADR-0134); commits one undoable move.
- **Offset** (W, #8/#2, ADR-0120→ADR-0137, AutoCAD-like): a parallel copy of a whole **selection**. Preselect geometry (many lines, a loop, circles/arcs), pick Offset, type the **Distance** in the parameters window and either **press Enter / ✓** (applies to the side nearest the cursor) or **click the side** you want (like AutoCAD's type-distance-then-pick-side); with no distance typed, a click uses the perpendicular distance from the click. **Connected line chains offset as a unit** — each segment is offset and adjacent offsets are intersected into clean **mitred corners**, welded into a proper parallel loop/polyline (not disjoint segments); **circles/arcs offset concentrically** (r ± distance, keeping the arc's angular extent). The copy is plain new geometry (same path as Rectangle/Mirror; construction flag inherited). Splines/points aren't offsettable in v1.
- **Explode** ("bomb", K, ADR-0131, AutoCAD-like): un-welds a connected shape so each line/arc/circle/spline gets its own private points and becomes individually selectable; coordinates are unchanged, so the drawing looks identical. Clicking with the tool explodes the shape under the cursor (or the current selection).
- **Group / Join** (U, #4, ADR-0135, AutoCAD-like): the inverse of Explode — welds the selected entities' coincident endpoints into shared points so touching lines/arcs become one connected shape that selects as a unit. Coordinates are unchanged; entities that don't touch aren't joined. Uses the current selection (preselect → click) or the shape under the cursor; needs at least two entities.
- Delete with dependency check (profile used downstream → warning listing dependent ops).

**Dimensions (reference / associative in v1):** the **Dim tool** (D) places persistent, AutoCAD-style dimension annotations between two selected points. The kind selector next to the tool defaults to **Auto (H/V)** — like AutoCAD's `DIM`, it auto-picks **Horizontal** or **Vertical** from the span's dominant axis (`|Δx| ≥ |Δy|`) at commit — and can be overridden to **Parallel** (aligned straight distance |ab|), **Horizontal** (|Δx|), **Vertical** (|Δy|), **Radius** (|ab| as R, a = centre), **Diameter** (2·|ab| as ⌀, a = centre), or **Angle** (a→b inclination from +X). `Auto` is a tool-level default only: it resolves to a concrete kind on commit, so the six stored kinds are Parallel(linear)/Horizontal/Vertical/Radius/Diameter/Angle (ADR-0049). Dimensions are **associative reference annotations**, not driving constraints (solver-free, ADR-0002): each value is measured live from the current point positions and re-renders as the geometry (or a dragged point) moves — typing a value does **not** move geometry. They persist in the model's constraint-ready `dimensions` slot and round-trip through XML; a v2 solver can later promote them to driving. (A transient `Measure`-style readout for hovered/selected entities also exists.) **Radial dims on circles/arcs (#1, ADR-0067):** a full circle has no rim pool point to use as the second pick, so a **single click on a circle or arc rim** with the Dim tool creates a radius/diameter dimension directly — the dimension stores the entity id and derives the rim endpoint from the entity's live radius (circle defaults to Diameter, arc to Radius; the kind selector still overrides). Precision workflow in v1 = numeric input at creation + properties panel afterwards; Dim adds a visible, saved record of key measurements. **Selecting & deleting a dimension (ADR-0091):** in Select/Change mode a dimension is clickable like geometry — clicking its lines or label picks it (highlighted red, mutually exclusive with entity selection) and **Delete** (button or key) removes it via `DeleteSketchDimensions`; whichever of geometry or dimension is nearest the click within tolerance wins.

**Finish Sketch:** profile regions auto-detected (planar loop detection) **including holes** — nested loops become inner boundaries of the enclosing profile (rectangle with circle inside = one profile with a hole). Open contours allowed but flagged. Profiles are picked later inside Extrude/Revolve exactly like Fusion. Profile identity is a stable hash of contributing entity IDs (ARCHITECTURE R7a), never a detection index — so geometric edits keep downstream Extrudes valid, while adding/removing boundary entities produces an explicit error instead of silently changing which region gets extruded.

### F3 — 3D operations (Fusion names)
While an Extrude/Revolve dialog is open, the geometry it will act on is highlighted amber in the viewport — the selected profile loops (outer + holes) and, for Revolve, the chosen axis line — drawn over the solid so the selection is always visible. Each selected profile also shows its **filled region** as a translucent amber area (ADR-0089), so it is obvious *which area* the operation consumes, not just its outline. **Click-to-pick (ADR-0096):** every detected profile region is clickable directly in the 3D view — clicking a region toggles that profile in the dialog (Fusion-style), so you can pick either from the checklist or from the model; selected regions fill brightly, unselected ones show a faint outline so all clickable areas are discoverable. Fillet/Chamfer highlight hovered and picked edges.

- **Extrude** (E): 1..n profiles → distance (one side / symmetric / two sides) or **Through All** (self-sizing, passes entirely through the target — the standard way to cut clean through a body), operation **New Body / Join / Cut / Intersect** (choosing a boolean op auto-selects a target body so OK is immediately usable, ADR-0053). **Multiple target bodies (#3, ADR-0101):** Join/Cut/Intersect apply to every ticked target in place (each is trimmed/clipped/fused independently), chosen from a target checklist. Taper: out of scope.
- **Revolve**: profiles + axis — an **axis/centerline or any line of the same sketch** (drawn with the Axis tool, listed first and named "Axis N") or an always-available origin axis (X/Y/Z); cross-sketch axis references are not allowed (dependency containment) + angle (default 360°), same operation options.
- **Body type — Solid / Thin wall / Surface** (Extrude and Revolve): a **Solid** (default) is the filled prism/revolution. A **Thin wall** (#7, ADR-0068) is hollowed to a **Wall Thickness** (mm) — a single-wall shell for enclosures — *before* the boolean, so it still Joins/Cuts/Intersects an existing body (reuses the Shell hollowing helper `closedHollow`; walls too thick collapse with a clear error). A **Surface** (ADR-0072) sweeps the profile **wires** instead of the face, producing a **zero-thickness surface body** (Fusion "as Surface") — the vase / single-wall case; it is always a **new body** (a surface can't take a boolean) and renders double-sided so it's never culled edge-on. **Open geometry (ADR-0097):** a Surface may also be swept from an **open** chain — a single line or a connected open polyline (a curtain, fin, single wall) — offered in the profile list **only** while body type = Surface; open profiles carry the same R7a hash identity as closed ones and persist across save/load. Solids/thin-walls still require closed profiles.
- Live ghost preview + direction arrows before confirm.
- **Transform ops (P1, ADR-0061; multi-source #3, ADR-0103/0104):** **Mirror** (I) reflects **one or more bodies** across a world origin plane (XY/XZ/YZ); **Pattern** (P) arrays **one or more bodies** **linearly** — along up to **three independent axes at once** (a box/grid: direction 1 plus optional directions 2 and 3, each a count + spacing + axis; a count of 1 disables a direction, capped at 1000 instances total, ADR-0065, #4) — or **circularly** (count + total angle about an axis); both offer **Join** (fuse into the source) or **New Body**. **Copy Body** (D) now also **rotates** (Euler XYZ) in addition to translating, and copies **one or more source bodies** at once (multi-select, ADR-0103). Mirror/Pattern/Copy pick their sources from a body checklist; each selected source produces its own result (a Join fuses each into its own source). **Move** (T, ADR-0066, #3) applies the same rigid transform (Euler XYZ rotation about the world origin, then XYZ translation in mm) to **one or more bodies in place** (multi-select, ADR-0102) — same body ids, no copy — for repositioning bodies in 3D. All reuse the shared transform/boolean helpers (heal included, ADR-0057).

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

## 10a. Monetization (M11, ADR-0081)
One-time perpetual **Pro** license, verified **offline** — no runtime backend. A license is an Ed25519-signed token; the app carries only the public key and verifies it locally via WebCrypto (fails closed). **Free** = full modeling + STL export **with a watermark**; **Pro** = STEP/3MF export + no watermark. Enter a key in the **License** dialog; it persists and re-verifies on load, so Pro works offline across sessions. Keys are issued out-of-bundle (`tools/license-issuer/`, private key a server secret) from a Merchant-of-Record purchase webhook. While the issuer is not yet live, a single **universal evaluation key `GYP$Y`** unlocks Pro for the owner and testers (ADR-0089) — matched literally before any crypto and returning a synthetic perpetual Pro payload; the real signed-token path is unchanged and still fails closed for everything else. Price / Free-Pro boundary / MoR are owner-confirm.

## 10b. Accounts (M13, ADR-0123, amended by ADR-0124)
Optional **user accounts** on top of 10a, adding registration and stronger, cracker-resistant enforcement **without** Fusion-style constant verification. **Register / log in with email + password** (a simple internal login — no third-party providers; passwords hashed server-side with PBKDF2-SHA256, opaque bearer sessions); the account service issues a **device-bound Pro lease** — the same offline-verified Ed25519 token, now carrying `accountId`, `deviceId`, and a ~30-day `expiresAt`. The app verifies it **entirely offline** and applies two account-only rules: **device binding** (a copied token is inert on another machine) and an **offline grace window** (Pro keeps working 14 days past expiry, and the app silently renews online within 7 days of expiry). So a leaked/revoked key stops renewing and dies, sharing is capped by a per-account device limit with revoke, and normal use never blocks on the network. The whole feature is **build-time gated** on `VITE_ACCOUNT_SERVICE_URL`: unset ⇒ the app is exactly the 10a experience (paste a key / `GYP$Y`, no accounts UI, zero network); set ⇒ the login form appears. The service is a Cloudflare Worker + D1 (`tools/account-service/`) touched only at register / log in / renew / device-management — never at runtime — so prime directive #7 holds. Private key stays a Worker secret (CI-guarded); `GYP$Y` still works. MoR webhook verification + CORS pinning are owner-deploy steps.

## 10b. Trust, samples & support (M12, ADR-0082)
**Local project folder (ADR-0089, supersedes the built-in Samples gallery, now removed):** Settings → *Project folder* points NomaDim at a real directory on the user's machine (File System Access API); the granted handle persists in IndexedDB and is silently re-authorized on load. A **PROJECTS** button (Shift+P) lists the folder's `.nomadim.xml` files and opens them through the ordinary load path, and saves the current project there — so a workshop keeps its jobs as real files with no backend (Chromium-only; other browsers get an explanatory note). **Legal:** real Terms, Privacy, EULA, Refund, and a Changelog/Roadmap page (`public/legal/*.html`) sit behind the landing footer (template pending counsel review). **Support:** a `mailto:` **Contact support** link in the help dialog and landing footer — no form, no backend. **Crash reporting:** opt-**in** and privacy-first — fully inert unless a Sentry DSN is set at build (`VITE_SENTRY_DSN`), user-disable toggle in the help dialog, PII-scrubbed (no design data or user text, stack paths reduced to basenames), a single stateless HTTPS POST with **no bundled SDK** and **no runtime backend**.

## 10c. Personalization, identity & diagnostics (post-M12, ADR-0083)
**Project name (F7):** a document carries a user-set name (header field, undoable via RenameDocument, persisted on the `<nomadim>` root) that drives **every** export filename through a configurable pattern (base · name · date-time · revision). **Admin panel** (shortcut `,`): UI language (EN today), default export parameters, autosave **retention** (default keep-forever; else discard a stale autosave after N days and open fresh), and the naming pattern — all device-local settings, never part of a document. **Header logo** links to the landing page. **Sketch exits:** Enter finishes a Line/Axis chain and returns to Select; Esc always exits the active tool so the view rotates. **Shading:** a hemisphere + key/fill light rig so orientation reads from any angle. **Graphic identity:** one brand-red node (`--color-origin`) shared by the logomark, the 3D world-origin ball, and the 2D sketch-origin dot (logomark shape redesign pending an owner reference). **Fillet/Chamfer diagnosis (F4):** a failed round/bevel is retried edge-by-edge to name the offending edge(s); the edit dialog shows the reason and flags those edges red on re-open. **Privacy:** the public contact address is `kontakt@nomadirection.pl` — no personal email in shipped docs; copyright reads "© 2026 NomaDim — all rights reserved".

## 11. Out of scope (v1) — explicit
Constraint solver & driving dimensions (v2) · assemblies · joints · drawings · parameters table/expressions · splines · loft/sweep/hole/thread · variable fillets · timeline reordering · Project/Include into sketch · multi-document · touch UI · slicer integration · dark theme.

*(Shipped since v1.1: Shell (ADR-0064), thin/single-wall Extrude & Revolve (ADR-0068), datum planes (ADR-0069).)*

## 12. Visual design (NomaDirection brand)
Teal `#1A6B5A` (primary/active/selection @40% alpha), navy `#0D1B2A` (panels), cream canvas, 8-px grid. Typography **Barlow** (600 headings / 400 body), monospace for numeric fields. Icons: Lucide stroke, token-colored. Light theme only. All values as CSS custom properties in `app/ui-tokens/tokens.css`; hardcoded colors fail lint. The full graphic identity — logo/logotype, palette, typography, usage — is documented in **`BRAND.md`** (the "N" mark lives in `public/brand/` + `src/app/features/brand/Logo.tsx`); use those assets as the default for visual changes.

**Restyle (ADR-0044):** the surface is intentionally elevated rather than flat — a navy elevation ramp (`--color-navy-500…900`), hairline borders + soft shadows (`--shadow-sm/md/lg`), a radius scale (`--radius-sm/md/lg`), a type scale (`--text-xs…xl`), and control-sizing tokens (`--control-h` 32 px / touch 44 px). One button language across every panel: rounded, raised, hover = teal border, active/primary = filled teal on cream, with a single `:focus-visible` ring. **Responsive (supersedes the ADR-0040 scroll-row for app actions):** on phone-width screens (iPhone 12+) the app-action cluster collapses behind a **hamburger** dropdown and controls grow to 44-px touch targets; the sketch tool row stays a horizontal scroller; desktop keeps the inline corner-anchored layout. Panels use solid raised surfaces + shadow (no `backdrop-filter` blur) to protect the 100-body ≥30 fps floor. **Menu-driven top bar (ADR-0046):** in modeling mode the browser tree and the view bar are **collapsed by default** behind `Browser` and `View` toggles grouped with the app menu in the top-right cluster (the Browser toggle carries a live body-count badge); each reveals its panel in place. **New Sketch** leads the 3D-operation (timeline) bar, before Extrude, as the start of the modeling flow. **Touch parity (ADR-0049):** every keyboard-only action has an on-screen affordance so the app is fully usable on iPhone — a **Delete** button in the sketch toolbar (removes the current selection) and a header **Undo/Redo** cluster stand in for the `Delete` key and `Ctrl+Z`/`Ctrl+Y`, which iOS Safari does not provide. **Docked tool strip (ADR-0050):** in both modes the tools live in one reserved bottom dock — the sketch toolbar when sketching, the 3D timeline otherwise — laid out as a **two-row** horizontal scroller. The dock is a layout sibling of the canvas (not an overlay), so the model is never hidden behind it. The Browser (origin planes / sketches / bodies with per-item visibility) is reachable in **both** modes, so bodies can be hidden while sketching. **Mobile WebGL stability (ADR-0050/0110):** the drawing-buffer pixel ratio is capped at 2 on desktop and **1.5 on touch devices** (buffer memory is ~dpr², so this cuts it a further ~44% on the phones that get OOM-killed), WebGL context loss is caught and recovered, and the render loop pauses while the tab is hidden. **Crash resilience (ADR-0110):** autosave flushes on `document` `visibilitychange` + `pagehide` (the last events before iOS discards a backgrounded tab), so a crash is lossless; and a `sessionStorage` crash-loop guard brings the app up in **safe mode** after repeated OOM reloads — the document is restored (Save works) but the 3D kernel waits behind a "Load 3D" recovery bar, breaking the reload loop instead of ending on a blank page. **Single top ribbon (ADR-0108, supersedes the ADR-0094 strip):** all icons and menus live on the **one top bar beside the logo**, split into MS-Office-style **thematic groups** (each a row of icons under a small caption): View · Sketch · Create · Modify · Pattern · Datum · Inspect · File · System · History. The create ops (Extrude/Revolve/Fillet/Chamfer/Combine/Copy Body/Mirror/Pattern/Shell/Move) are no longer a separate strip — they sit in the Create/Modify/Pattern groups; New Sketch is the primary in the Sketch group. The **timeline history** chips keep their place in the bottom dock. On phones the groups collapse into the hamburger dropdown (New Sketch stays visible outside it). **Clean phone header (ADR-0111):** a `useMediaQuery` hook drives a genuinely mobile layout — the top bar keeps only New Sketch + the hamburger (or Browser + Undo/Redo in a sketch), the Browser/View toggles and Undo/Redo move into the top of the dropdown (VIEW/HISTORY groups), the ribbon-group captions and pill chrome are dropped in the top bar, and the project-name field is hidden, so the header is one aligned row instead of a wrapping cluster. Each op button stays accessible/testable (aria-label = op name; "Label (Shortcut)" enabled, unmet-precondition reason when disabled). **Menus in the top bar (ADR-0093):** the icon menus (Browser/View + File/Create/System, including Settings and License) live in the header itself, right-aligned beside Undo/Redo — not floating over the model. Settings is therefore plainly visible; on phones the File/Create/System blocks still collapse behind the header hamburger. **Orbit while sketching (ADR-0092):** the model can be rotated during sketch editing — the **right** mouse button orbits (middle pans) while the **left** button stays reserved for drawing and selecting, so navigation never hijacks the pen. **Icon toolbars (ADR-0090):** the modeling top bar and the sketch dock share one minimal, Apple-like icon language — symbol buttons (24×24 line icons) grouped into blocks separated by hairline dividers, quiet until hovered, with a soft teal tint for the active/toggled state and a filled teal for primary entry points (Finish, New Sketch). Every button shows a picture over a **2–3-letter acronym caption** (#5b, ADR-0107 — e.g. line → LN, extrude → EXT) so tools are findable at a glance, and is fully accessible and testable: its label is the `aria-label` and, with the shortcut, the hover tooltip (master rule, ADR-0032). The top bar keeps the mobile hamburger (collapse to a dropdown on phones); the sketch dock is one calm horizontally-scrolling row. The timeline op-dock (Extrude/Revolve/Fillet/…) stays as labelled chips for discoverability. **Reliability hardening (ADR-0071):** rendering is fully **on-demand** — the render loop runs only during an active window that camera/data invalidations extend, then idles at zero GPU cost on a static model; **ResizeObserver callbacks coalesce** to one buffer reallocation per frame (killing the orientation-change realloc storm); and **regens coalesce** to one in-flight + one pending so an edit burst never backs up the single-threaded OCCT worker — the three baseline-pressure sources behind the iPhone crashes, on top of the deferred trimmed-WASM build (ADR-0011).

## 13. Open decisions (owner)
1. Repo name `nomadim`? 2. EN-only v1, PL in v1.1? 3. Default orbit scheme? 4. Camera in XML?
