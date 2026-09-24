# Design: Automated CI/CD Deployment Pipeline via SSH

## Context

The Moody Blues repository is a pnpm monorepo hosting modular Docker Compose stacks. The initial stack (`compose/gateway`) is fully implemented with Caddy and a visual "Hello World" landing page. The remote environment is an OVHcloud VPS running Debian/Ubuntu with Docker CE pre-installed and the repository located at `/opt/moody-blues`.

See `proposal.md` for motivation and background context.

## Goals / Non-Goals

**Goals:**

- Provide automated continuous deployment triggered by merges/pushes to `development` and `main`.
- Enforce pre-flight validation on compose files before attempting remote connection.
- Execute secure SSH deployment using repository secrets with zero hardcoded values in code.
- Ensure the external network `moody-blues-net` is provisioned if absent.
- Ensure containers are updated gracefully with `--remove-orphans`.
- Verify running container health on the target host.

**Non-Goals:**

- Setting up complex cluster orchestrators (Kubernetes/Swarm/Nomad) — single-host Docker Compose is deliberate.
- Provisioning host operating system dependencies (Docker CE and OS configuration are already complete).
- Managing or committing environment secrets (`.env`) in git.

## Decisions

### Decision 1: GitHub Actions Runner with Pre-Flight Checks

- **Choice:** Run pre-flight linting and compose syntax checks in GitHub Actions `ubuntu-latest` runner before initiating SSH.
- **Rationale:** Prevents syntax errors, broken YAML formatting, or missing required environment interpolations from impacting the remote server.
- **Alternatives Considered:** Running checks only on the server after pulling code — rejected because it risks leaving the server in an inconsistent state.

### Decision 2: SSH Execution via `appleboy/ssh-action`

- **Choice:** Use `appleboy/ssh-action@v1.2.0` to connect and execute deploy scripts remotely.
- **Rationale:** Standard, battle-tested action with first-class support for SSH keys, custom ports, script timeouts, and strict error handling (fails job on non-zero exit codes).
- **Alternatives Considered:** Manual `ssh-agent` / raw bash SSH — rejected to avoid unnecessary boilerplate and error-handling edge cases in the workflow file.

### Decision 3: Remote Target Working Directory and Network Guarantee

- **Choice:** Script executes in `/opt/moody-blues`, pulls the branch matching the workflow trigger, ensures `moody-blues-net` exists, and runs compose.
- **Script Sequence:**
  ```bash
  cd /opt/moody-blues
  git fetch origin
  git checkout ${{ github.ref_name }}
  git pull origin ${{ github.ref_name }}
  docker network inspect moody-blues-net >/dev/null 2>&1 || docker network create moody-blues-net
  docker compose -f compose/gateway/docker-compose.yml up -d --remove-orphans
  ```
- **Rationale:** Keeps deployment idempotent and supports multiple stacks modularly as new compose stacks are added in subsequent changes.

### Decision 4: Post-Deployment Verification

- **Choice:** Validate running state of deployed containers using `docker compose -f compose/gateway/docker-compose.yml ps`.
- **Rationale:** Ensures immediate visibility into whether services failed to start or crashed on boot.

## Risks / Trade-offs

- **[Missing Host `.env` File]** → _Mitigation:_ The remote deployment checks for `/opt/moody-blues/.env`. If missing, it copies `.env.example` as fallback and logs a warning to configure production values.
- **[Missing External Network]** → _Mitigation:_ The remote script runs `docker network inspect moody-blues-net >/dev/null 2>&1 || docker network create moody-blues-net` prior to compose execution.
- **[Concurrent Deployment Conflicts]** → _Mitigation:_ GitHub Actions concurrency group configured (`concurrency: production-deploy`) with `cancel-in-progress: false` to ensure atomic, sequential deployments.
