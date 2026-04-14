# Contributing to promised-pipes

Thank you for helping improve **promised-pipes**. This project values small, reviewable changes, clear tests, and documentation that stays aligned with behavior.

## Prerequisites

- **Node.js** ≥ 18 (matches `package.json` `engines`)
- **Git**

Optional: a recent **npm** for installing dev dependencies.

## Getting started

```sh
git clone https://github.com/Prakhar-Srivastava/promised-pipes.git
cd promised-pipes
npm install
```

## What to run before opening a PR

| Command | Purpose |
|---------|---------|
| `npm test` | Full `node:test` suite |
| `npm run bench` | Benchmark harness (longer; optional for tiny doc-only tweaks) |
| `npm run docs:build` | Regenerate API HTML under `docs/api/` (gitignored) |
| `npm run check:types` | Type-check `pipe.d.ts` with `tsc --noEmit` |
| `npm run samples` | Run all runnable samples under `samples/` |

For runnable examples:

```sh
node samples/01-basics.mjs
```

See [samples/README.md](./samples/README.md) for the full list.

## Project layout (short)

| Path | Role |
|------|------|
| `pipe.mjs` | Implementation and default export |
| `pipe.d.ts` | Public TypeScript surface |
| `tests/pipe.test.mjs` | Contract tests |
| `bench/` | Performance scenarios |
| `samples/` | Runnable use-case snippets |
| `typedoc.json` | API doc generation config |

## Pull request expectations

1. **One concern per PR** when possible (e.g. docs vs behavior vs benchmarks).
2. **Tests** for behavior changes; update or add samples/docs when user-visible API changes.
3. **No silent semver surprises** — breaking changes should be called out in [CHANGELOG.md](./CHANGELOG.md) and README where users look first.
4. **Style** — match existing formatting (tabs in `.mjs`, frozen API patterns). See [AUTHORING.md](./AUTHORING.md) for documentation norms.

## Reporting issues

Include Node version, a minimal reproduction, and expected vs actual behavior. For API questions, point to README or generated API docs after `npm run docs:build`.

## License

By contributing, you agree your contributions are licensed under the **MIT** license — see [LICENSE](./LICENSE).
