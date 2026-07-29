# NomaDim — Step 0 Live Inspection Report

**Date:** 2026-07-29 · **Build inspected:** current `main` (commit `eb165f96`, the DXF-import deploy) via local `vite build && vite preview`.
**Method:** headless Chromium (Playwright) driving the running app; DOM/network/console/timing captured programmatically. Screenshots in [`inspection-shots/`](./inspection-shots/).

> **Observe-only.** No code was changed. This is the evidence base for M8 (delivery) and M9 (GUI hardening).

## Environment note — live URL not reachable from CI

The agent network policy denies outbound CONNECT to `github.io` (and general web hosts) — `https://gypsytreasure.github.io/nomadim/` returns `403` at the proxy. The **local preview serves the identical artifact that was deployed to Pages earlier today**, so all measurements below are representative of production _except_ GitHub Pages' transfer encoding, which is called out explicitly in §1.

---

## 1. Network / delivery (the M8 gate)

| Asset                               |     On-disk |              Transfer (local preview) | Notes                                     |
| ----------------------------------- | ----------: | ------------------------------------: | ----------------------------------------- |
| `wasm/opencascade.full.wasm`        | **50.3 MB** | **48.0 MB, `content-encoding: none`** | full untrimmed OCCT                       |
| `wasm/opencascade.full.js` (glue)   |      404 KB |                                  gzip |                                           |
| main app bundle `assets/index-*.js` |      975 KB |                                  gzip | single chunk, code-split warning at build |
| second JS chunk                     |       46 KB |                                  gzip |                                           |
| `assets/index-*.css`                |       31 KB |                                  gzip |                                           |

- **The WASM is served uncompressed.** `gzip` of the file is **13.2 MB**, `brotli -q11` would be ~10–11 MB (brotli binary not available in CI to measure exactly). GitHub Pages does **not** brotli-negotiate large `.wasm` blobs, so production almost certainly ships the full ~50 MB every cold visit. This must be confirmed post-M8 and is the reason M8 precompresses + serves `.wasm.br` with a JS fallback.
- **Measured WASM download** (localhost, unthrottled): **6.7 s** for the transfer alone. On real **Fast-3G (~1.6 Mbps)** the same 48 MB ≈ **~240 s**; even gzipped (13.2 MB) ≈ **~66 s**. This is the headline problem M8 exists to fix.
- No caching/service worker: every visit re-downloads the kernel (`cache-control` from Pages is short; no precache).

## 2. Timing

| Metric                               |     Unthrottled | Fast-3G (CDP throttled) |
| ------------------------------------ | --------------: | ----------------------: |
| DOMContentLoaded                     |          231 ms |                1 667 ms |
| App shell ready (New Sketch visible) |        1 116 ms |                2 006 ms |
| WASM finished downloading            |          ~7.2 s |   ~240 s (extrapolated) |
| Kernel ready (first successful op)   | _not captured_¹ |                       — |

¹ The automated rectangle-draw didn't register a profile (Playwright click without a preceding pointermove snaps to origin — the known snap artifact), so the extrude produced "Profiles: 0" and body-count never reached 1. Kernel readiness is dominated by the WASM download regardless; **the shell renders in ~1–2 s without the kernel**, which already satisfies M8's "interactive viewport < 5 s" once the viewport is confirmed to render pre-kernel. **M8's "kernel ready < 12 s" is not met today** — the untrimmed/uncompressed WASM makes it impossible on constrained links.

**Good news for M8:** the shell + empty viewport already appear well before the kernel loads, so the "lazy kernel" architecture is a small step, not a rewrite.

## 3. Console

Only benign warnings during load + a sketch run: repeated `GL Driver Message … GPU stall due to ReadPixels` (from the Intersect/section read-back). **No JS errors.** No uncaught exceptions, no failed fetches (other than the environment's inability to reach external hosts).

## 4. Button / accessibility audit (the M9 gate)

38 `<button>` elements enumerated. Full dump captured; highlights:

### 4a. Bare-shortcut tooltips — **19 buttons** (M9 must fix)

Every one of these has `title` equal to just its shortcut, so hovering shows a cryptic single character instead of a description:

`Measure="M"`, `Plane="G"`, `Axis="J"`, `New Project="Shift+N"`, `Save="Ctrl+S"`, `Open="Ctrl+O"`, `Export="Ctrl+E"`, `Shortcuts="?"`, `New Sketch="N"`, `Extrude="E"`, `Revolve="V"`, `Fillet="F"`, `Chamfer="H"`, `Combine="B"`, `Copy Body="D"`, `Mirror="I"`, `Pattern="P"`, `Shell="L"`, `Move="T"`.

**Fix pattern (M9):** `title={\`${t('op.extrude')} (E)\`}`→ "Extrude (E)". Labels exist as button text already; add`op._`/`help._` i18n keys where missing.

### 4b. Dead-button gating — **the core M9 problem**

Only **3** buttons are ever rendered `disabled`: Redo (nothing to redo ✅), Export (no bodies ✅), and a dialog's OK. **Every modeling op is always enabled** regardless of precondition:

| Button                            | Precondition                   | Gated today?           |
| --------------------------------- | ------------------------------ | ---------------------- |
| Extrude / Revolve                 | a profile in the active sketch | ❌ always enabled      |
| Fillet / Chamfer / Shell          | a body (+ edges)               | ❌ always enabled      |
| Combine / Mirror / Pattern / Move | a target body                  | ❌ always enabled      |
| Copy Body                         | a body                         | ❌ always enabled      |
| Export                            | ≥1 body in scope               | ✅ disabled when empty |

So Fillet/Shell/Combine/… are clickable with an empty document and silently no-op (or open a dialog with nothing to act on). Export already models the right pattern — **M9 should generalise it into a `useOpAvailability` selector driving both `disabled` and an explanatory `title` (e.g. `t('guard.needBody')`).**

### 4c. Accessible names

**0 buttons with no accessible name** — every button has visible text or an `aria-label`. (Icon-only controls like the orbit D-pad and browser-tree toggles carry `aria-label`s.) Good baseline; M9 just needs descriptive `title`s.

## 5. Screenshots (see `inspection-shots/`)

| File                                        | What it shows             | Observations                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1440-shell.png`                            | Cold load, empty viewport | "Loading 3D kernel…" progress bar (top); **"Welcome to NomaDim"** onboarding modal with 3 steps + "Got it"; New Project/Export correctly greyed; modeling ops appear dim but are **not** truly disabled (§4b)                                                               |
| `1440-sketch.png`                           | Sketch mode, tool active  | grid + plane, two-row bottom dock                                                                                                                                                                                                                                           |
| `1440-extrude-dialog.png`                   | Extrude dialog open       | draggable panel top-left; fields fit; footer "Profiles: 0 with holes: 0 open: 0"                                                                                                                                                                                            |
| `1440-body.png`                             | Post-op viewport          |                                                                                                                                                                                                                                                                             |
| `768-*` / `390-iphone-*` / `375-iphonese-*` | Tablet + phones           | Plane-picker modal centred and **fully contained at 375 px**; top bar collapses to Browser/View + **hamburger (☰)**; two-row dock present. No obviously clipped OK/Cancel seen, but M9 should verify every op dialog at 375 px (dialogs weren't all openable in this pass) |

## 6. `index.html` / SEO / PWA baseline (M8 + M9 + M10)

Current `<head>` is bare:

```html
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<title>NomaDim</title>
```

Missing (to be added in M8/M9): `meta description`, Open Graph + Twitter card, `theme-color`, canonical, web-app manifest, service worker. **The favicon href is hardcoded `/favicon.svg`** — it must go through `import.meta.env.BASE_URL` or it 404s under the `/nomadim/` Pages base. No `public/manifest.webmanifest`, no service worker, no PWA install path exist yet. Brand assets present: `public/brand/logomark.svg`, `logotype.svg` (no PNG/OG raster yet).

---

## 7. Prioritised findings → milestone mapping

| #   | Finding                                                                                 | Severity   | Milestone  |
| --- | --------------------------------------------------------------------------------------- | ---------- | ---------- |
| 1   | 50 MB uncompressed WASM re-downloaded every visit; ~240 s on Fast-3G                    | 🔴 blocker | **M8**     |
| 2   | No lazy kernel / progress %, no service worker / offline / install                      | 🔴         | **M8**     |
| 3   | 10 modeling buttons enabled with unmet preconditions (dead buttons)                     | 🟠         | **M9**     |
| 4   | 19 bare-shortcut tooltips                                                               | 🟠         | **M9**     |
| 5   | Bare `<head>` (no meta/OG/theme-color/manifest); hardcoded `/favicon.svg` base-path bug | 🟠         | **M8/M9**  |
| 6   | Onboarding modal exists but no "Load sample" affordance                                 | 🟡         | **M9/M12** |
| 7   | Verify every op dialog fits at 375 px (not all openable this pass)                      | 🟡         | **M9**     |
| 8   | WebGL ReadPixels GPU-stall warnings from Intersect section read-back                    | 🟢 perf    | later      |

## 8. Owner-decision blockers to resolve before the affected milestone

These do **not** block M8/M9 (proceed on documented defaults), but are needed before M10–M12 copy/code:

- **Positioning:** "3D-printing enthusiasts" vs "SME workshops" — sets tone, price, and lead Pro features (M10).
- **Price** (`TODO(confirm price)` in the pricing table) (M10).
- **Free/Pro feature boundary** — default proposed: Free = modeling + watermarked STL + complexity cap; Pro = STEP/3MF, no watermark, no cap (M11).
- **Merchant of Record:** Paddle vs Lemon Squeezy (M11).
- **Domain** for the marketing site + canonical/OG URLs (M10).
