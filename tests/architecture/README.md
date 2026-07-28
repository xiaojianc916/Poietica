# Architecture checks

`node tests/architecture/run.mjs` is the only entry point. It walks the source
roots once, applies every rule declared in `rules.config.mjs`, and reports all
violations as `file:line:column`.

## Enforced invariants

- foundations do not depend on higher-level packages;
- editor code stays independent of desktop application and platform packages;
- features do not import Tauri or desktop runtime packages directly;
- platform packages do not depend on application entry packages;
- cross-package imports use public package exports instead of `src/` deep paths;
- relative imports do not cross top-level package boundaries;
- design-system components consume `--ui-*` tokens instead of raw utility classes.

## Adding a rule

Add an object to `rules.config.mjs`. Do not add a script.

Standalone `check-*.mjs` files are themselves a violation: they encode a single
migration as a text snapshot, outlive it, and rot without failing. Assertions
about one component's implementation belong in that component's tests, where
they are deleted together with the migration.
