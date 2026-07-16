# NomaDim

Source-available, browser-based parametric 3D CAD for 3D-printing enthusiasts.
Inspired by Autodesk Fusion 360's workflow — sketch on a plane, dimension
precisely, extrude/revolve, finish with fillets/chamfers, export STL — running
entirely client-side (WASM + WebGL2, no backend, no account) as a static site
on GitHub Pages.

**Status:** Live at **https://gypsytreasure.github.io/NomaDim/**. Sketching
(all entities + snapping + numeric input), Extrude/Revolve/Fillet/Chamfer/
Combine, copy/paste, measure, the browser tree, sketching on base planes and
body faces, `.nomadim.xml` save/load, and the standard-view / projection /
shortcuts viewport polish are all in. See `MASTER_DOCUMENT.md` §8 for the
milestone roadmap.

## Using NomaDim

- **Sketch:** _New Sketch_ → pick a base plane (XY/XZ/YZ) or _Pick a face_ and
  click a flat body face. Draw with Line / Axis / Rectangle / Circle / Arc /
  Point / Polygon — type exact values as you go (Tab between fields, Enter to
  commit). The origin (0,0) and endpoints/mid/center/intersection snap, with
  horizontal/vertical/parallel/perpendicular/tangent inference. _Finish Sketch_.
- **Model:** _Extrude_ or _Revolve_ a profile (the selection highlights in 3D);
  _Fillet_ / _Chamfer_ picked edges; _Combine_ bodies (Join/Cut/Intersect).
- **Organize:** the left **browser tree** lists sketches and bodies — toggle
  visibility, recolour, rename, delete. Bodies are named _Body 1_, _Body 2_, …
- **Measure** distances/radii; **copy/paste** bodies (Ctrl+C / Ctrl+V);
  **undo/redo** (Ctrl+Z / Ctrl+Y).
- **Save / Open:** _Save_ downloads a `.nomadim.xml` file; _Open_ (or drag a
  file onto the viewport) reloads it — the whole timeline replays. **Export
  STL** for printing.
- **Navigate:** the top-centre view bar snaps to _Home_ (isometric) or the six
  standard faces (Front/Back/Left/Right/Top/Bottom), toggles between
  _Perspective_ and _Orthographic_ projection, and _Zoom to Fit_ frames the
  model. Orbit by dragging; scroll to zoom.
- **Shortcuts:** press `?` (or the _Shortcuts_ button) any time for the full
  keyboard reference. First-timers get a short getting-started hint on the
  empty canvas.

### Keyboard shortcuts

| Context      | Keys                    | Action                                            |
| ------------ | ----------------------- | ------------------------------------------------- |
| General      | `Ctrl+Z` / `Ctrl+Y`     | Undo / Redo                                       |
| General      | `Ctrl+C` / `Ctrl+V`     | Copy / paste the selected body                    |
| General      | `?`                     | Show / hide the shortcuts overlay                 |
| Sketch tools | `L` `R` `C` `A` `P` `G` | Line / Rectangle / Circle / Arc / Point / Polygon |
| Sketch tools | `X`                     | Toggle construction geometry                      |
| Sketch input | `Tab` / `Enter` / `Esc` | Next field / confirm value / cancel step          |
| Sketch input | `Delete`                | Delete selected entities                          |

## Documentation

Three binding documents govern this codebase (precedence order on conflict):

1. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — code structure, layer rules, patterns.
2. [`MASTER_DOCUMENT.md`](./MASTER_DOCUMENT.md) — product/functional specification.
3. [`CLAUDE.md`](./CLAUDE.md) — implementation working method.

Structural and product decisions are logged in [`DECISIONS.md`](./DECISIONS.md).

## Stack

TypeScript (strict) · React 18 · Vite · Zustand · Three.js · OpenCascade.js
(WASM, single-threaded, Web Worker) · fast-xml-parser · Vitest · Playwright ·
dependency-cruiser · ESLint + Prettier + stylelint. Node 22 LTS, npm.

## Commands

```bash
npm run dev         # start the dev server
npm run build       # typecheck + production build
npm run preview     # preview the production build
npm test            # unit tests (Vitest)
npm run e2e         # end-to-end smoke tests (Playwright)
npm run lint        # ESLint + stylelint
npm run typecheck   # tsc --noEmit
npm run depcheck    # dependency-cruiser layer enforcement
```

## Deployment

Pushes to `main` run the full CI gate (lint, typecheck, depcheck, test,
build) and deploy `dist/` to GitHub Pages via `.github/workflows/deploy.yml`.
The Pages base path is derived from the repository name at build time —
never hardcoded in source.

---

© Kacper / NomaDirection — all rights reserved.
