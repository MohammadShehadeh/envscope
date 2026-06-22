# envscope

> Which environment variables does each app **actually** require — traced through its real dependency graph?

`envscope` analyzes a repository (a **monorepo** _or_ a plain **single-package** repo) and, for every app, computes the set of environment variables it depends on at runtime — including variables used deep inside shared internal packages. It uses **AST parsing** (the TypeScript compiler via `ts-morph`), never regex, and attributes each variable to an app **only if it is reachable through that app's dependency graph**.

```
App: apps/web

Required env vars (9):

  - API_URL
      packages/api-client/src/client.ts:2 (process.env)
  - STRIPE_SECRET
      packages/payments/src/stripe.ts:2 (process.env)
  - AUTH_SECRET
      apps/web/src/auth/session.ts:4 (process.env)
  ...
```

## Why

In a monorepo, env vars are used deep inside shared packages, indirectly required by apps, undocumented, and duplicated. A global `.env` scan can't answer _"what does **this** app need?"_ — because it doesn't know app boundaries. `envscope` does: it builds the import graph and only counts a variable for an app if a file using it is actually reachable from that app.

## Install / run

```bash
pnpm install
pnpm build           # compiles to dist/, exposes the `envscope` bin

# or run straight from source during dev:
pnpm exec tsx src/cli.ts analyze --cwd path/to/repo
```

## Commands

```bash
envscope                      # analyze every app (default)
envscope analyze              # same as above
envscope app apps/web         # analyze a single app (by relPath or package name)
envscope find STRIPE_SECRET   # reverse lookup: which apps need it, and the chain
```

### Options

| Flag | Description |
| --- | --- |
| `--json` | Machine-readable JSON output |
| `--md`, `--markdown` | Markdown report (great for `> ENV_REPORT.md`) |
| `--cwd <dir>` | Repo root to analyze (default: current dir) |
| `--schema <file>` | Use a specific `.env` schema/example for diffing |
| `--no-color` | Disable ANSI colors |
| `-h`, `--help` / `-v`, `--version` | |

## Reverse lookup

```bash
$ envscope find STRIPE_SECRET
STRIPE_SECRET is used in:
  - apps/api → packages/payments → stripe.ts (packages/payments/src/stripe.ts:2)
  - apps/web → packages/payments → stripe.ts (packages/payments/src/stripe.ts:2)
```

The chain is the collapsed import path from an app entry to the file that reads the variable.

## What gets detected (AST, not regex)

| Pattern | Example |
| --- | --- |
| `process.env.X` | `const k = process.env.STRIPE_SECRET` |
| `process.env["X"]` | `process.env["API_TIMEOUT"]` |
| Destructuring | `const { STRIPE_WEBHOOK_SECRET } = process.env` |
| `import.meta.env.X` | `import.meta.env.VITE_THEME` (Vite/SvelteKit/Astro) |
| Typed env wrapper | `env.SESSION_TTL` — only when `env` is **imported** (t3-env style), to avoid false positives |

## Missing / unused / shared detection

If an app (or the repo root) has a `.env.schema`, `.env.example`, `.env.sample`, `.env.template`, or `.env.defaults`, envscope diffs it against real usage:

- ❌ **used but not defined** — referenced in code but absent from the schema (likely `undefined` at runtime)
- ⚠️ **defined but unused** — present in the schema but never referenced (drift / dead config)
- 🔁 **shared across apps** — the same variable required by more than one app

## How it works

```
discover workspace ─▶ collect source files ─▶ AST scan each file ─▶ build import graph
                                                     │                      │
                                          env usages per file      file ──imports──▶ file
                                                     │                      │
                                                     ▼                      ▼
                              per-app aggregation over the set of files REACHABLE
                              from that app's own files through the import graph
```

1. **Workspace discovery** (`src/workspace.ts`) — reads `pnpm-workspace.yaml`, `package.json` `workspaces` (npm/yarn), or `lerna.json`; falls back to the `apps/* + packages/*` folder convention; and falls back again to **treating a single-package repo as one app**. Apps are classified by directory convention, refined by "nobody depends on it ⇒ it's an app".
2. **AST scanning** (`src/scanner.ts`) — one `ts-morph` traversal per file extracts both env usages and module specifiers (static imports, `export … from`, dynamic `import()`, `require()`).
3. **Dependency graph** (`src/graph.ts`) — a deterministic resolver (no tsconfig needed) handles relative imports and **workspace-package** imports (`@scope/pkg`, subpaths, `exports`/`main`/`module`/`source` entries, and `./x.js → ./x.ts`). It builds a file-level import graph, does reachability BFS per app, and traces chains for `find`.
4. **Aggregation + schema** (`src/analyze.ts`, `src/schema.ts`) — dedupes, maps each variable to its file locations, computes per-app/shared/missing/unused.

The key invariant: **a variable belongs to an app only if a file that uses it is reachable from that app's own files.** That's why `apps/web` (which imports `@sample/ui`) gets `VITE_THEME`, while `apps/api` (which doesn't) never sees it — and `DATABASE_URL` is attributed to `apps/api` alone.

## Programmatic API

```ts
import { analyzeRepo, findEnvVar } from "envscope";

const result = analyzeRepo(process.cwd());
for (const app of result.analysis.apps) {
  console.log(app.app.relDir, app.envVars.map((v) => v.name));
}
console.log(findEnvVar(result, "STRIPE_SECRET"));
```

## Try the bundled examples

```bash
pnpm demo             # analyze example/sample-monorepo
pnpm demo:find        # find STRIPE_SECRET in the sample monorepo
pnpm test             # the test suite asserts the attribution above
```

`example/sample-monorepo` is a pnpm-style workspace (`apps/web`, `apps/api`, shared `packages/*`). `example/single-app` is a plain repo, proving the same engine works without any workspace config.

## Project structure

```
src/
  cli.ts        # arg parsing + command dispatch
  index.ts      # programmatic API
  workspace.ts  # monorepo / single-repo discovery + app classification
  scanner.ts    # ts-morph AST: env usages + import specifiers
  graph.ts      # module resolver, import graph, reachability, find-chains
  analyze.ts    # pipeline: collect → scan → graph → aggregate → schema → shared
  schema.ts     # .env schema loading + missing/unused diff
  output.ts     # human / JSON / markdown renderers
  paths.ts      # cross-platform path normalization
  types.ts      # shared types
example/
  sample-monorepo/   # pnpm workspace demo
  single-app/        # single-package demo
test/
  analyze.test.ts    # end-to-end attribution tests
```

## Roadmap (architected for, not yet built)

- **env drift** report across apps (same var, different schema defaults)
- `--write-example` to generate a per-app `.env.example` from detected usage
- visual dependency graph export (DOT / Mermaid)
- `--fail-on used-but-undefined` for CI gating

## License

MIT
