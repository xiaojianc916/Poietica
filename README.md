# Poietica

> A local-first, AI-assisted space for thinking, exploring, and creating.

Poietica helps people turn incomplete thoughts into creative work.

Start with a question, a note, a fragment, a reference, or a sketch. Use AI to explore possibilities, organize ideas in a visual space, collect materials, and gradually develop a direction into something meaningful.

Poietica is not designed to replace creative judgment. It is designed to help people keep moving when their ideas are still uncertain.

## Why Poietica

Creative work rarely begins with a clean outline.

It often starts with scattered notes, unfinished questions, references, sketches, associations, and directions that are not yet clear. Poietica brings these materials together in one workspace so they can be explored, connected, revised, and developed over time.

The product is built around a few principles:

- **Creation comes first** — tools should help people think, explore, express, and finish work.
- **People stay in control** — AI provides suggestions and proposals; it does not silently decide or overwrite work.
- **Multiple creative entry points** — writing, AI, notes, materials, and the canvas can each be a starting point.
- **Local-first by default** — documents belong to their creators and should save, recover, export, and behave predictably.
- **Intentional AI boundaries** — user content is only shared with external AI services through explicit, understandable product flows.

## What Poietica Is Building

Poietica is evolving into a desktop creative environment with:

- **Description and notes** for capturing questions, intentions, fragments, and evolving ideas.
- **AI-assisted exploration** for generating perspectives, questions, variations, and editable proposals.
- **A visual canvas** for arranging, connecting, comparing, and developing ideas and materials.
- **Local documents and assets** with reliable saving, recovery, and file behavior.
- **Workspace tools** for navigation, panels, commands, settings, and creative organization.

## Current Status

Poietica is under active development.

The current focus is building a reliable local-first foundation for documents, assets, editor behavior, desktop capabilities, AI workflows, and recoverable file operations before expanding the product surface.

## Technology

- **React + TypeScript** for the interface and product interaction.
- **tldraw** for canvas editing and canvas document state.
- **Tauri + Rust** for the desktop runtime, native file operations, and platform integration.
- **Vite** for frontend development and builds.
- **pnpm + Turborepo** for the monorepo and task orchestration.
- **Biome** for formatting and linting.
- **Vitest + Playwright** for automated testing.
- **Valibot** for runtime validation at application boundaries.

## Getting Started

### Prerequisites

- Node.js version specified in [`.node-version`](./.node-version)
- pnpm 11
- Rust toolchain specified in [`rust-toolchain.toml`](./rust-toolchain.toml)
- Platform prerequisites required by [Tauri](https://v2.tauri.app/start/prerequisites/)

### Run the desktop app

```bash
git clone https://github.com/xiaojianc916/poietica.git
cd poietica

corepack enable
pnpm install
pnpm tauri:dev
```

## Common Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the desktop frontend development workflow. |
| `pnpm tauri:dev` | Start the full Tauri desktop application. |
| `pnpm check` | Run formatting, linting, TypeScript, architecture, frontend, and Rust checks. |
| `pnpm typecheck` | Type-check the TypeScript workspace. |
| `pnpm lint` | Run Biome linting. |
| `pnpm format:check` | Verify source formatting. |
| `pnpm test:architecture` | Verify architectural and UI-boundary constraints. |
| `pnpm test` | Run frontend and Rust tests. |
| `pnpm build` | Build the desktop frontend. |
| `pnpm tauri:build` | Build the Tauri desktop application. |
| `pnpm clippy` | Run Rust Clippy with warnings treated as errors. |
| `pnpm audit` | Check JavaScript dependencies for high-severity vulnerabilities. |
| `pnpm audit:rust` | Check Rust dependency advisories, licenses, and source policies. |

## Repository Layout

```text
apps/          Desktop application composition
editor/        Canvas, documents, assets, persistence, and extensions
features/      AI, settings, workspace, and product-facing capabilities
foundations/   Stable shared primitives and design-system building blocks
platforms/     Desktop runtime adapters and typed IPC contracts
docs/          Architecture notes, ADRs, RFCs, and operational guides
tests/         Architecture, integration, and product verification
```

## Documentation

- [Architecture](./docs/architecture/README.md) — stable system boundaries and implementation guidance.
- [Architecture Decision Records](./docs/adr) — accepted technical decisions.
- [RFCs](./docs/rfcs) — proposals and in-progress designs.
- [Runbooks](./docs/runbooks) — development and operational procedures.
- [Contribution and AI collaboration guide](./AGENTS.md) — repository rules, safety boundaries, and validation requirements.

## Contributing

Contributions should preserve Poietica's core guarantees:

- no second source of truth for canvas document state;
- no hidden AI changes to user work;
- no unvalidated data across file, network, plugin, AI, or IPC boundaries;
- no platform capabilities leaking into product-domain packages;
- no architecture shortcuts that create permanent parallel paths.

Before opening a pull request, run:

```bash
pnpm check
pnpm audit
pnpm audit:rust
```

## License

Poietica is licensed under the [Apache License 2.0](./LICENSE).
