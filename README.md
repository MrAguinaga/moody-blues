# Moody Blues

Autonomous, portable media management stack with headless provisioning and an interactive CLI.

---

## Repository Architecture

This project is organized as a monorepo using `pnpm workspaces`:

```text
moody-blues/
├── apps/
│   └── cli/                      # Interactive terminal CLI (@moody-blues/cli)
├── packages/
│   └── provisioner/              # Headless provisioning engine (@moody-blues/provisioner)
└── compose/                      # Modular Docker Compose manifests
```

---

## Prerequisites

- **Node.js**: `>= 20.10.0` (LTS recommended)
- **pnpm**: `>= 10.0.0` (configured with `12.x`)
- **Docker Engine**: `>= 24.0.0` (with Docker Compose v2)

---

## Development

```bash
# Install monorepo dependencies and set up Git hooks
pnpm install

# Build internal packages and apps
pnpm build

# Run type checking across all workspaces
pnpm typecheck

# Lint source files with ESLint
pnpm lint

# Check code formatting with Prettier
pnpm format:check

# Format files with Prettier
pnpm format

# Run CLI in development mode
pnpm cli

# Create conventional commit interactively using Commitizen
pnpm commit
```

---

## Git Hooks

Code quality and commit standards are enforced automatically via **Husky** and **lint-staged**:

- **`pre-commit`**: Runs ESLint (`--fix`) and Prettier (`--write`) on staged files before each commit.
- **`commit-msg`**: Validates commit messages using **Commitlint** against the [Conventional Commits](https://www.conventionalcommits.org/) specification.
