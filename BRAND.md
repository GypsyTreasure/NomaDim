# NomaDim — Brand & Graphic Identity

The single source of truth for NomaDim's visual identity. It aligns with the
**NomaDirection** house style (nomadirection.pl) and the design tokens in
`src/app/ui-tokens/tokens.css` (MASTER_DOCUMENT §12). Use these assets and
values as the default for every future visual change; do not introduce new
colors, fonts, or logo variants without updating this file.

© Kacper / NomaDirection — all rights reserved. (No open-source grant — ADR-0009.)

---

## 1. Essence

- **Product:** browser-based parametric 3D CAD for 3D-printing enthusiasts.
- **Personality:** precise, engineered, calm, self-hosted. Fusion-grade rigour
  with a lightweight, no-account, static-site feel.
- **Tagline:** _Parametric CAD, in your browser._

## 2. Logo

Two lockups, both built from the same **"N" mark** — a plotted vector path
(up → diagonal → up) with a filled **start node** echoing a sketch origin/point.
It reads simultaneously as the letter **N** (NomaDim / NomaDirection) and as a
toolpath.

| Asset                      | File                              | Use                                   |
| -------------------------- | --------------------------------- | ------------------------------------- |
| Logomark (tile)            | `public/brand/logomark.svg`       | App tile, social avatar, ≥ 32 px      |
| Logotype (mark + wordmark) | `public/brand/logotype.svg`       | Headers, docs, README                 |
| Favicon                    | `public/favicon.svg`              | Browser tab (rounded navy tile)       |
| In-app logotype            | `src/app/features/brand/Logo.tsx` | The app header (inline, token-driven) |

**Rules**

- Clear space around the mark ≥ the height of the start node.
- Minimum mark size 20 px (below that the start node is dropped).
- On dark surfaces (navy header) the mark stroke is teal, the node is canvas.
- Do **not** recolor the mark outside the palette, stretch it, add effects, or
  rebuild the wordmark in another typeface.

## 3. Color

Brand values live only in `tokens.css`; every stylesheet references the custom
properties (stylelint `no-hardcoded-color`). v1 is a light theme.

| Token                                  | Value     | Role                                    |
| -------------------------------------- | --------- | --------------------------------------- |
| `--color-teal` (`--color-primary`)     | `#1A6B5A` | Brand primary, active state, accents    |
| `--color-navy` (`--color-panel-bg`)    | `#0D1B2A` | Header/panels, mark tile, ink on light  |
| `--color-canvas` (`--color-canvas-bg`) | `#FAF7F0` | Viewport / app background, text on dark |
| `--color-border`                       | `#C9C2B4` | Hairline borders, dividers              |
| `--color-amber`                        | `#B5860A` | Warning / suppressed status             |
| `--color-error-red`                    | `#B3261E` | Errors                                  |
| `--color-grey-muted`                   | `#8A8578` | Skipped/disabled                        |

Derived: `--color-scrim` (navy 55%) for modal backdrops; `--color-teal-alpha-40`
for selection fills. Add new semantic aliases here rather than new literals.

## 4. Typography

- **Typeface:** **Barlow** (heading + body), system-sans fallback until the
  webfont is bundled locally — no CDN fetch (keeps C1 "no server calls" honest).
- **Weights:** headings 600, body 400. Monospace (`--font-mono`) for numeric
  fields and key chords.
- Tokens: `--font-heading`, `--font-body`, `--font-mono`,
  `--font-weight-heading`, `--font-weight-body`.

## 5. Layout & tone

- 8 px grid (`--grid-unit`); flat corners (`--radius-flat: 0`); 1 px borders.
- Restrained, engineered surfaces; teal reserved for emphasis and active state.
- UI copy: short, precise, Fusion-360 terminology (Prime directive #1). All
  user-visible strings via `t('key')`.
