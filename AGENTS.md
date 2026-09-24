# Agent Guidelines

Welcome to the Moody Blues repository. This file serves as the canonical router for autonomous agents working on this codebase.

## Skills Router

This project strictly adheres to a Pragmatic SDD (Software Design Document) workflow. Agents **must not** perform ad-hoc coding without a documented plan.

When you are asked to perform tasks, route your execution through the following available skills:

- **Exploring ideas:** If the user is unsure and wants to brainstorm architecture before writing a proposal, use the `openspec-explore` skill.
- **Planning a new feature:** If the user wants to build something new, use the `openspec-propose` skill to generate the planning artifacts.
- **Updating a plan:** If the user wants to revise an existing plan, fold new decisions into it, or reconcile its artifacts, use the `openspec-update-change` skill.
- **Implementing a plan:** If there is an active OpenSpec change ready for implementation, use the `openspec-apply-change` skill to execute the tasks sequentially.
- **Continuing work:** If you hit a blocker or the user wants to resume an active workflow, use the `openspec-continue-change` skill.
- **Syncing specs:** If the user wants to update main specs with changes from a delta spec without archiving the change, use the `openspec-sync-specs` skill.
- **Verifying & Archiving:** When implementation is done, use `openspec-verify-change` to check coherence, and `openspec-archive-change` to finalize the branch.

## General Conventions

- **Monorepo Architecture:** The project is structured as a `pnpm` workspace, isolating services into dedicated directories (e.g., `compose/gateway`, `compose/tv`).
- **Commit Standards:** We use strictly conventional commits. `commitlint` is enforced locally via `husky`.
