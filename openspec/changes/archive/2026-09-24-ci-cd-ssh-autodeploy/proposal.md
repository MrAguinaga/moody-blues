# Proposal: Automated CI/CD Deployment Pipeline via SSH

## Why

Currently, deploying and updating services on the remote VPS requires manual intervention, SSH access, and ad-hoc container management. As the platform expands across multiple microservice stacks (Gateway, Storage, TV, Music, Books), manual deployments become error-prone, lack auditability, and risk introducing broken configurations directly to production.

An automated continuous deployment pipeline is needed now to enable GitOps-driven delivery: pushing or merging into `development` and `main` must automatically validate configurations and deploy the stacks to the target host with zero downtime, immediately verifying live services such as the Ingress Gateway.

## What Changes

- Add GitHub Actions deployment workflow at `.github/workflows/deploy.yml`:
  - Triggers automatically on pushes to `main` and `development`, with manual trigger capability (`workflow_dispatch`).
  - Pre-flight syntax and configuration validation: runs `docker compose config` against all active compose stacks prior to connecting to the server.
  - Secure SSH connection using GitHub repository secrets (`SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `SSH_PORT`).
  - Atomic zero-downtime synchronization and container deployment at `/opt/moody-blues`.
  - Ensures the shared external network `moody-blues-net` exists before launching stacks.
  - Deploys active compose stacks (starting with `compose/gateway/docker-compose.yml`) using `docker compose up -d --remove-orphans`.
  - Post-deployment healthcheck step verifying that the deployed containers are running and operational.
- Keep repository code 100% agnostic: zero hardcoded IPs, user names, or domains in workflow definitions.

## Capabilities

### New Capabilities

- `ci-cd`: Automated continuous integration and deployment pipeline via SSH to remote host with pre-flight checks, atomic stack orchestration, and deployment verification.

### Modified Capabilities

<!-- None -->

## Impact

- **Affected Files:**
  - Adds `.github/workflows/deploy.yml`.
- **Infrastructure & Dependencies:**
  - Requires GitHub Repository Secrets: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, and optional `SSH_PORT`.
  - Targets VPS directory `/opt/moody-blues`.
  - Relies on standard GitHub Actions runners (`ubuntu-latest`).
