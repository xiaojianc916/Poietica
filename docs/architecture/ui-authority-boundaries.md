# UI authority boundaries

## Status

Accepted architecture boundary.

## Goal

Hybrid Canvas does not require every UI component to live in the design-system
package. It requires every cross-feature visual rule and reusable interaction
primitive to have exactly one authority.

## Authority matrix

| Capability | Authority |
| --- | --- |
| Semantic colors, typography, radii, shadows, focus, motion | `foundations/design-system` |
| Reusable accessible interaction primitives | `foundations/design-system` |
| Workspace grid, rail, sidebar and inspector layout | `features/workspace` |
| Settings content and settings workflow | `features/settings` |
| Native window chrome and Tauri-specific presentation | `apps/desktop` |
| Canvas document state and canvas interaction | tldraw Editor and TLStore |
| tldraw official UI and StylePanel behavior | tldraw |
| tldraw CSS selector overrides | the single tldraw adapter CSS boundary |
| Failure classification and recovery policy | application composition |
| Generic toast presentation | design-system |

## Design-system rules

- The design system contains no canvas, workspace, settings or desktop-window
  business semantics.
- Base UI is wrapped by the design system before feature packages consume it.
- Feature packages may compose primitives but must not recreate generic dialog,
  menu, tooltip, select, combobox or toast interaction kernels.
- Product-layout dimensions do not belong to global design-system tokens.
- Public consumers import only from `@hybrid-canvas/design-system`.

## tldraw rules

- tldraw remains the visual and interaction authority inside the canvas.
- Official tldraw components are not rewritten merely to match product-shell
  components.
- Host theme tokens may be mapped into the tldraw UI through an explicit adapter.
- Direct `.tl-*` and `.tlui-*` selectors are restricted to one versioned CSS
  boundary.
- Every pinned tldraw upgrade must revalidate that boundary.

## Migration rule

When a new authority replaces an old implementation, the old implementation,
token family, style rule and export must be removed in the same migration. The
repository must not maintain indefinite dual UI paths.
