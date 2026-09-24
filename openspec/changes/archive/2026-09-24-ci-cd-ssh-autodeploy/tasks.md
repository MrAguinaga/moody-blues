# Tasks

## 1. Pipeline Definition and Pre-Flight Validation

- [x] 1.1 Scaffold `.github/workflows/deploy.yml` with triggers for push to `main` and `development`, `workflow_dispatch`, and sequential concurrency control.
- [x] 1.2 Implement pre-flight validation job executing `docker compose config` against active stacks in `compose/` to block faulty configurations before SSH connection.

## 2. Remote SSH Deployment and Service Orchestration

- [x] 2.1 Configure remote SSH connection step using `appleboy/ssh-action@v1.2.0` parameterized via GitHub repository secrets (`SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `SSH_PORT`).
- [x] 2.2 Implement remote deployment sequence in `/opt/moody-blues` ensuring Git branch synchronization, network existence (`moody-blues-net`), and stack orchestration (`docker compose up -d --remove-orphans`).
- [x] 2.3 Implement post-deployment container verification checking that the deployed Caddy gateway container reports running status on the target host.
