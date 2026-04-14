# Authoring documentation

Guidelines for keeping **promised-pipes** docs accurate, scannable, and low-maintenance.

## Sources of truth

1. **Runtime behavior** — `pipe.mjs` and `tests/pipe.test.mjs`.
2. **Type surface** — `pipe.d.ts` (consumed by TypeDoc and TypeScript users).
3. **Narrative** — `README.md` (overview, concepts, API prose).

When these disagree, fix the drift in this order: implementation → tests → `.d.ts` → README/samples.

## README

- Prefer **copy-pasteable** snippets over abstract prose.
- Avoid **hard-coded test counts** — they go stale; say “run `npm test`” instead.
- Cross-link **samples**, **CONTRIBUTING**, **CHANGELOG**, and **LICENSE** where helpful.
- For v0.2 **configure** extensions (`abort`, `pool`, `coalesce`), keep examples aligned with `configure()` validation rules in `pipe.mjs`.

## Samples (`samples/`)

- Each file should be **runnable** with `node samples/<name>.mjs` from repo root.
- Use `import … from '../pipe.mjs'` so samples work in a git checkout without publishing.
- End with a clear **`ok`** (or printed value) so CI or humans can spot failure quickly.
- Add new samples to [samples/README.md](./samples/README.md) index table.
- Run **`npm run samples`** after adding or changing samples so CI or contributors get a single command.

## API reference (TypeDoc)

- **Build**: `npm run docs:build` → HTML under `docs/api/` (see [.gitignore](./.gitignore); generated output is not committed by default).
- **Watch while editing types**: `npm run docs:watch`.
- **Config**: [typedoc.json](./typedoc.json) — entry point is `pipe.d.ts`; `compilerOptions.lib` must include APIs you reference (e.g. `PromiseSettledResult`).

## Type checking declarations

- `npm run check:types` runs `tsc` with [tsconfig.check.json](./tsconfig.check.json).
- After editing `pipe.d.ts`, run this alongside tests.

## Tone

Clear, direct, and respectful of the reader’s time. Prefer tables and short sections over long essays unless the topic demands depth (security, limitations).

## Release checklist (docs slice)

- [ ] `CHANGELOG.md` updated for the version.
- [ ] `README.md` version callouts if needed.
- [ ] `npm test` and `npm run check:types` pass.
- [ ] `npm run docs:build` succeeds (if publishing API docs).
- [ ] Samples index lists any new scripts.
