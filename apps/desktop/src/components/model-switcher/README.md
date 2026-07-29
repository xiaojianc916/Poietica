# Model Switcher

React 19 selector for model + thinking level + run mode.

## Layout

    model-catalog.ts      single source of truth (descriptors, tiers, capabilities)
    useModelSwitcher.ts   hook: selection, recents, pins, fuzzy search, keyboard nav
    ModelSwitcher.tsx     shell: pill trigger + command-palette popover
    ModelRow.tsx          one row (chips, context, speed/cost meters, pin)
    SegmentedControl.tsx  segmented control replacing label-value-arrow rows
    Meter.tsx             relative speed/cost indicator
    model-switcher.css    semantic tokens (light/dark, reduced motion)

## Why

| Before | After |
| --- | --- |
| three stacked rows, nested submenus | one panel, everything visible |
| model name only | summary, context window, capabilities, speed/cost |
| mouse only | ARIA combobox: arrows, Enter, Esc, fuzzy search |
| model list hardcoded in the view | catalog module, provider-ready |
| ad-hoc colors, !important | token layer, dark mode, reduced motion |

## Usage

    import { ModelSwitcher } from './components/model-switcher'

    <ModelSwitcher dark={isDarkTheme} />

Pass `models` to render a runtime provider list instead of STATIC_MODELS.

## Constraints honoured

Written against tsconfig.base.json as-is: noUncheckedIndexedAccess,
exactOptionalPropertyTypes, verbatimModuleSyntax, erasableSyntaxOnly,
noPropertyAccessFromIndexSignature. No default exports, no `export *`,
no `!important`, no `any`.
