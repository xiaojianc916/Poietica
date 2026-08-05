# Architecture checks

`node tests/architecture/run.mjs` is the only entry point. It walks the source
roots once, applies every rule declared in `rules.config.mjs`, and reports all
violations as `file:line:column`.

## Enforced invariants

Every invariant below maps to a rule id emitted by `run.mjs`. The tier table
itself lives in `rules.config.mjs` and is reconciled against the packages on
disk at load time; this file does not restate it.

- `{pkg}-depends-downward` — a package imports only its own tier and below;
- `{pkg}-owns-its-entry` — a package is reached through its own entry point;
- `public-package-exports` — cross-package imports use package exports, not `src/` deep paths;
- `no-cross-boundary-relative-imports` — relative imports do not cross package boundaries;
- `design-system-token-authority` — design-system components consume `--ui-*` tokens, not raw utility classes;
- `no-task-scoped-guards` — no `check-*.mjs` file may exist in this directory;
- load-time governance — directory naming, the four native-crate rules from
  `docs/architecture/rust-layers.md`, and the `size-budget.json` ratchet.

## Adding a rule

Add an object to `rules.config.mjs`. Do not add a script.

Standalone `check-*.mjs` files are themselves a violation: they encode a single
migration as a text snapshot, outlive it, and rot without failing. Assertions
about one component's implementation belong in that component's tests, where
they are deleted together with the migration.
