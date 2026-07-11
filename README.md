# NomaDim

Source-available, browser-based parametric 3D CAD for 3D-printing enthusiasts.
Inspired by Autodesk Fusion 360's workflow — sketch on a plane, dimension
precisely, extrude/revolve, finish with fillets/chamfers, export STL — running
entirely client-side (WASM + WebGL2, no backend, no account) as a static site
on GitHub Pages.

**Status:** M0 — project scaffold. See `MASTER_DOCUMENT.md` §8 for the full
milestone roadmap.

## Documentation

Three binding documents govern this codebase (precedence order on conflict):

1. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — code structure, layer rules, patterns.
2. [`MASTER_DOCUMENT.md`](./MASTER_DOCUMENT.md) — product/functional specification.
3. [`CLAUDE.md`](./CLAUDE.md) — implementation working method.

Structural and product decisions are logged in [`DECISIONS.md`](./DECISIONS.md).

## Stack

TypeScript (strict) · React 18 · Vite · Zustand · Three.js · OpenCascade.js
(WASM, single-threaded, Web Worker) · fast-xml-parser · Vitest · Playwright ·
dependency-cruiser · ESLint + Prettier + stylelint. Node 20 LTS, npm.

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
