# Contributing to envscope

Thanks for your interest in improving `envscope`! 🎉

## Getting started

```bash
git clone https://github.com/MohammadShehadeh/envscope.git
cd envscope
pnpm install
```

This project uses [pnpm](https://pnpm.io). With [Corepack](https://nodejs.org/api/corepack.html)
(`corepack enable`) the version pinned in `package.json` is used automatically.

### Useful scripts

| Script           | What it does                              |
| ---------------- | ----------------------------------------- |
| `pnpm build`     | Compile `src/` to `dist/` with `tsc`      |
| `pnpm dev`       | Run the CLI from source via `tsx`         |
| `pnpm test`      | Run the test suite (Vitest)              |
| `pnpm typecheck` | Type-check with `tsc --noEmit`            |
| `pnpm demo`      | Analyze the bundled `example/sample-monorepo` |
| `pnpm demo:find` | Reverse-lookup `STRIPE_SECRET` in the demo |

### Running the CLI locally

```bash
pnpm build
node dist/cli.js analyze --cwd /path/to/some/repo

# or straight from source, no build step:
pnpm exec tsx src/cli.ts analyze --cwd /path/to/some/repo
```

## Project structure

```
src/
├─ cli.ts        # arg parsing + command dispatch
├─ index.ts      # public programmatic API
├─ workspace.ts  # monorepo / single-repo discovery + app classification
├─ scanner.ts    # ts-morph AST: env usages + import specifiers
├─ graph.ts      # module resolver, import graph, reachability, find-chains
├─ analyze.ts    # pipeline: collect → scan → graph → aggregate → schema → shared
├─ schema.ts     # .env schema loading + missing/unused diff
├─ output.ts     # human / JSON / markdown renderers
├─ paths.ts      # cross-platform path normalization
└─ types.ts      # shared types
example/         # sample-monorepo + single-app fixtures
test/            # end-to-end attribution tests
```

## Guidelines

- **Add a test** for any bug fix or new behavior. The attribution engine lives or
  dies by its fixtures — extend `test/` and `example/` when you change detection.
- **Keep the engine pure.** `analyze.ts` / `graph.ts` / `scanner.ts` should not
  depend on `output.ts` or `cli.ts`.
- **Detect via AST, never regex.** Env usage is found through `ts-morph`; keep it
  that way to avoid false positives.
- **Run `pnpm typecheck` and `pnpm test`** before opening a PR.
- **Be honest in output.** A variable belongs to an app only if a file that uses
  it is reachable from that app — don't relax that invariant for convenience.

## Commit messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: detect import.meta.env in .astro files
fix: resolve workspace subpath exports on Windows
docs: clarify the reachability invariant
```

## Reporting bugs

Open an issue with the command you ran, the workspace layout (pnpm / npm / yarn /
single-package), and the output you expected vs. what you got. A minimal
reproduction is gold.

By contributing, you agree that your contributions will be licensed under the
project's [MIT License](./LICENSE).
