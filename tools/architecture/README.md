# Architecture checks

`node tools/architecture/run.mjs` is the only entry point. It walks the source
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
- `capability-scoped-directory-names` — no directory is named after a DDD layer or a catch-all bucket;
- `native-crates-stay-host-agnostic` — native crates depend on neither Tauri nor each other, and declare `[lints] workspace = true`;
- `file-size-ratchet` — `size-budget.json` freezes existing debt; entries may only shrink.
- `workspace-manifest-conventions` — workspace manifests share one shape: exports, subpath names, side-effect globs, script names, orchestration, and version ranges.
- `wildcard-module-declarations` — a wildcard `declare module` is global, so the repository holds exactly one.
- `documented-scripts-exist` — a colon-scoped `pnpm` script named in documentation exists in a manifest.

A rule carries either a `pattern` (a regular expression matched against source
files) or a `check` (a function handed the single filesystem inventory). Both
report through the same violation list. Neither may throw at import time: that
would hide every other rule's findings, which is what this runner exists to
prevent.

## Adding a rule

Add an object to `rules.config.mjs`. Do not add a script.

Standalone `check-*.mjs` files are themselves a violation: they encode a single
migration as a text snapshot, outlive it, and rot without failing. Assertions
about one component's implementation belong in that component's tests, where
they are deleted together with the migration.
