# Tasks

## 1. Documentation & SDD Setup

- [ ] 1.1 Update `README.md` to indicate that OpenSpec tooling is required to work on this repository.
- [ ] 1.2 Update `AGENTS.md` to define initial agent governance rules and repository conventions.
- [ ] 1.3 Update the existing `openspec/config.yaml` to include the Pragmatic SDD rule in the context.

## 2. Monorepo Initialization

- [ ] 2.1 Initialize `package.json` with `pnpm` as package manager.
- [ ] 2.2 Create `pnpm-workspace.yaml` declaring `compose/*` and `packages/*` as workspace packages.

## 3. Governance Configuration

- [ ] 3.1 Add `Husky`, `commitlint` (`@commitlint/config-conventional`), `prettier`, and `lint-staged` as `devDependencies` via `pnpm`.
- [ ] 3.2 Configure `commitlint.config.js` to strictly extend `@commitlint/config-conventional`.
- [ ] 3.3 Configure `.husky/commit-msg` to run `commitlint`.
- [ ] 3.4 Configure `.husky/pre-commit` to run `lint-staged`.
