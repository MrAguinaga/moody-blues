# Design

## Context

We are establishing the repository structure and governance tooling for a new personal server deployment project. The goal is to enforce consistency from the beginning. See `proposal.md` for the motivation behind these changes.

## Goals / Non-Goals

**Goals:**

- Guarantee commit messages follow conventional commit guidelines locally.
- Configure proper OpenSpec constraints (`config.yaml`) and Agent router guidelines (`AGENTS.md`).

**Non-Goals:**

- We are not deploying any infrastructure in this phase.
- We are not setting up the full CI/CD deployment pipeline to the VPS yet (that is Change 07).
- We are not adding remote CI workflows (like `ci.yml`) or PR-specific validation workflows at this time, relying strictly on local git hooks.

## Decisions

- **Package Manager & Workspace:** `pnpm`
  - _Rationale:_ Fast, disk-efficient, and natively supports monorepos via `pnpm-workspace.yaml`. This enables us to manage `compose/*` services and future frontend/backend packages uniformly.
- **Git Hooks:** `husky` and `lint-staged`
  - _Rationale:_ Easiest way to enforce `commitlint` on `commit-msg` and formatting on `pre-commit` locally.
- **Commit Linting Rules:**
  - `extends: ['@commitlint/config-conventional']` to enforce the standard conventional commits structure (e.g., `feat:`, `fix:`, `chore:`).

## Risks / Trade-offs

- _Risk:_ New contributors or agents might forget standard guidelines without strict linting enforcement.
  - _Mitigation:_ Documenting repository expectations clearly in `AGENTS.md` provides sufficient guidance, while Husky prevents bad commits locally.
