# NomaDim — GUI action-button audit (M9)

Every action button is either **(a)** enabled and functional, or **(b)** rendered
`disabled` with a `title` that explains the unmet precondition. No button renders
and silently no-ops. Tooltips read **"Label (Shortcut)"** — never a bare shortcut
character (ADR-0032). Enabled/disabled rules for the create-ops are driven by
`useOpAvailability` (`src/app/features/timeline/opAvailability.ts`), unit-tested in
`tests/app/op-availability.spec.ts`.

## Create-ops (Timeline bar) — gated by `useOpAvailability`

| Button     | Shortcut | Enabled when    | Disabled tooltip         |
| ---------- | -------- | --------------- | ------------------------ |
| New Sketch | N        | always          | —                        |
| Extrude    | E        | a sketch exists | Create a sketch first    |
| Revolve    | V        | a sketch exists | Create a sketch first    |
| Fillet     | F        | ≥ 1 body        | Create a body first      |
| Chamfer    | H        | ≥ 1 body        | Create a body first      |
| Shell      | L        | ≥ 1 body        | Create a body first      |
| Copy Body  | D        | ≥ 1 body        | Create a body first      |
| Mirror     | I        | ≥ 1 body        | Create a body first      |
| Pattern    | P        | ≥ 1 body        | Create a body first      |
| Move       | T        | ≥ 1 body        | Create a body first      |
| Combine    | B        | ≥ 2 bodies      | Needs two or more bodies |

> Extrude/Revolve gate on "a sketch exists" rather than "a closed profile exists":
> the Extrude/Revolve dialog surfaces the profile list (and "Profiles: 0" when a
> sketch has none), which is clearer than a disabled button with no dialog — and
> avoids running profile detection reactively on every render (a perf lever with
> large imported sketches, ADR-0077).

## Top action cluster

| Button            | Shortcut        | Enabled when          | Disabled tooltip                 |
| ----------------- | --------------- | --------------------- | -------------------------------- |
| Measure           | M               | always (toggle)       | —                                |
| Plane (Construct) | G               | always                | —                                |
| Axis (Construct)  | J               | always                | —                                |
| New Project       | Shift+N         | document is non-empty | (self-evident: nothing to clear) |
| Save              | Ctrl+S          | always                | —                                |
| Open              | Ctrl+O          | always                | —                                |
| Import STEP       | —               | always                | —                                |
| Export            | Ctrl+E          | ≥ 1 body              | Create a body first              |
| Shortcuts         | ?               | always                | —                                |
| Undo / Redo       | Ctrl+Z / Ctrl+Y | history available     | (disabled when none)             |

## Sketch toolbar (in sketch mode)

All carry "Label (Shortcut)" tooltips: Finish (F), Select (S), Change (M),
Dimension (D), Line (L), Axis (I), Rectangle 2-Point (R), Rectangle Center
(Shift+R), Circle (C), Arc 3-Point (A), Arc Center (Shift+A), Point (P), Polygon
(G), Spline (B), Construction (X), Snap (Q), Intersect (J), Mirror X (K), Mirror Y
(Shift+K). Delete is enabled only with a selection (`disabled` otherwise).

## Viewport view bar

Zoom Fit (Z), Home (0), Front/Back/Left/Right/Top/Bottom (1–6), Projection (O) —
each "Label (Key)".

## Empty & error states

- **Empty document:** the "Welcome to NomaDim" onboarding card (New Sketch → pick
  a plane → draw; Finish → Extrude/Revolve; `?` for shortcuts). A **Load sample**
  affordance is delivered with the in-app sample gallery in **M12**.
- **Kernel error:** shows the error text **plus a Reload button**
  (`data-testid="kernel-reload"`), `role="alert"` — not a bare string.

## Verification

- Unit: `tests/app/op-availability.spec.ts` — every create-op's enable rule + the
  "no op enabled on an empty document" invariant.
- E2E: `tests/e2e/gui-hardening.spec.ts` — with an empty document, Fillet is
  `disabled` with the "Create a body first" tooltip and its click is a no-op.
