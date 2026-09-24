# ci-cd Specification

## Purpose

Provides automated continuous integration and deployment pipelines for the Moody Blues monorepo, executing pre-flight syntax checks, secure SSH deployment to the target host, and post-deployment service verification.

## Requirements

### Requirement: Automated Pipeline Triggers

The CI/CD system SHALL automatically trigger the deployment workflow when code is pushed or merged into the `development` or `main` branches, and SHALL allow manual execution via workflow dispatch.

#### Scenario: Code push to target branches

- **WHEN** a commit or pull request is merged into `development` or `main`
- **THEN** the continuous deployment workflow is triggered automatically

#### Scenario: Manual pipeline execution

- **WHEN** a repository maintainer triggers `workflow_dispatch` from the GitHub Actions interface
- **THEN** the workflow executes on the selected branch

---

### Requirement: Pre-Flight Configuration Validation

The CI/CD system SHALL perform pre-flight syntax and structural checks on all active Docker Compose stacks in the runner before establishing any connection to the remote target host.

#### Scenario: Valid compose files pass pre-flight

- **WHEN** all active Docker Compose stack configurations pass `docker compose config`
- **THEN** the workflow advances to the deployment stage

#### Scenario: Malformed compose file aborts pipeline

- **WHEN** a Docker Compose file contains syntax errors, invalid indentation, or unresolvable structure
- **THEN** the pre-flight job fails immediately and no SSH connection to the remote host is initiated

---

### Requirement: Secure Remote Host Authentication

The deployment workflow SHALL securely authenticate to the remote deployment target host via SSH using encrypted repository secrets (`SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, and `SSH_PORT`), without exposing credentials in build logs or source code.

#### Scenario: Authentication with valid SSH credentials

- **WHEN** the deployment step connects to the remote host using the configured secrets
- **THEN** the SSH connection is established successfully without exposing sensitive keys

#### Scenario: Failed authentication aborts deployment

- **WHEN** the SSH connection fails due to invalid credentials, key mismatch, or unreachable host
- **THEN** the workflow step reports failure and halts execution

---

### Requirement: Atomic Zero-Downtime Container Deployment

The deployment pipeline SHALL synchronize code into `/opt/moody-blues` on the target host, ensure the shared Docker network `moody-blues-net` exists, and deploy active stacks with `docker compose up -d --remove-orphans`.

#### Scenario: Stacks deployed on target host

- **WHEN** code is pulled onto the remote host
- **THEN** the shared network `moody-blues-net` is ensured to exist and active compose stacks are launched in detached mode

#### Scenario: Zero-downtime updates

- **WHEN** an updated configuration is deployed
- **THEN** Docker recreates only modified containers while preserving existing active volumes and unaffected services

---

### Requirement: Post-Deployment Service Verification

The deployment pipeline SHALL verify that deployed containers are running and healthy immediately following stack orchestration, failing the workflow if any service terminates unexpectedly.

#### Scenario: Successful service health verification

- **WHEN** deployed containers (including `caddy`) report running status after startup
- **THEN** the deployment step marks the pipeline execution as successful

#### Scenario: Container crash or exit failure

- **WHEN** a deployed container exits prematurely or fails health checks
- **THEN** the deployment step logs the failure and marks the GitHub Action run as failed
