# Moody Blues

Personal modular multimedia streaming server platform, engineered for 100% portability, high availability, and declarative infrastructure.

---

## Architecture Overview

Moody Blues is architected as a pnpm monorepo organizing modular Docker Compose stacks interconnected through a unified Docker bridge network:

- **Ingress Gateway (`compose/gateway`)**: Powered by [Caddy](https://caddyserver.com/), providing automated HTTPS/TLS termination, reverse proxy routing, and static landing page delivery. Modular configuration snippets are loaded dynamically from `compose/gateway/conf.d/`.
- **Shared Network (`moody-blues-net`)**: An external Docker bridge network enabling isolated, declarative communication between the ingress gateway and downstream services without exposing internal ports to the host.
- **Modular Stacks (`compose/*`)**: Independent application stacks (such as streaming engines, media servers, and dashboards) deployed alongside the gateway.

```
                           +------------------------+
                           |     Internet / User    |
                           +-----------+------------+
                                       | HTTP(80) / HTTPS(443)
                                       v
                     +------------------------------------+
                     |      Moody Blues Gateway (Caddy)    |
                     |         compose/gateway            |
                     +-----------------+------------------+
                                       |
                   External Bridge Network (moody-blues-net)
                                       |
            +--------------------------+--------------------------+
            |                          |                          |
            v                          v                          v
  +-------------------+      +-------------------+      +-------------------+
  |   Static Landing  |      |   Media Backend   |      | Additional Stacks |
  |   (Hello World)   |      |  (Future Stacks)  |      |   (compose/*)     |
  +-------------------+      +-------------------+      +-------------------+
```

---

## Prerequisites

### For Local Development & Testing:

- **Docker Engine** (24.0+) & **Docker Compose** (v2.20+)
- **Node.js** (v20+ or v22+) & **pnpm** (v9+ / v12+)
- **OpenSpec CLI** (for architectural planning):
  ```bash
  npm install -g @fission-ai/openspec@latest
  ```

### For Target VPS Host:

- Linux OS (Ubuntu 22.04/24.04 LTS or Debian 12 recommended)
- **Docker CE** & **Docker Compose v2** installed
- Target deployment directory at `/opt/moody-blues` with appropriate write permissions
- SSH access configured with public key authentication for a dedicated deploy user

---

## Local Quickstart (Testing on Localhost)

To run and verify the gateway locally:

### 1. Configure the Environment

Copy the environment template and configure your domain:

```bash
cp .env.example .env
```

Ensure `.env` sets `DOMAIN` to `localhost`:

```dotenv
DOMAIN=localhost
```

### 2. Create the Shared Network

Create the external Docker bridge network required by the stacks:

```bash
docker network create moody-blues-net
```

### 3. Launch the Gateway

Start the Caddy gateway container in detached mode:

```bash
docker compose --env-file .env -f compose/gateway/docker-compose.yml up -d
```

### 4. Verify in Browser

Open your browser and navigate to:

- `http://localhost` or `https://localhost`

You will see the Moody Blues "Hello World" landing page confirming the ingress gateway and Caddy configuration are running properly.

To inspect running containers and logs:

```bash
docker compose --env-file .env -f compose/gateway/docker-compose.yml ps
docker compose --env-file .env -f compose/gateway/docker-compose.yml logs -f
```

### 5. Tear Down

To stop the local stack:

```bash
docker compose --env-file .env -f compose/gateway/docker-compose.yml down
```

---

## Continuous Deployment (CI/CD)

Deployments are automated through GitHub Actions (`.github/workflows/deploy.yml`) using a secure SSH push model.

### Pipeline Workflow:

1. **Trigger**: Executes automatically on pushes to `main` and `development`, or manually via `workflow_dispatch`.
2. **Concurrency Control**: Deployments use `group: production-deploy` with `cancel-in-progress: false` to ensure atomic, sequential deployments without collision.
3. **Pre-Flight Validation**: Syntactically checks all Docker Compose configurations (`docker compose config --quiet`) on the runner to abort the pipeline immediately if invalid YAML or missing variables are detected.
4. **Remote SSH Execution**: Securely connects to the remote host using `appleboy/ssh-action@v1.2.0`, pulls the corresponding branch into `/opt/moody-blues`, provisions the `.env` file if absent, ensures `moody-blues-net` exists, and runs:
   ```bash
   docker compose --env-file .env -f compose/gateway/docker-compose.yml up -d --remove-orphans
   ```
5. **Post-Deployment Verification**: Asserts that the `caddy` container reports `running` status, failing the workflow if startup fails.

### Required GitHub Repository Secrets:

Configure the following secrets in your GitHub repository (**Settings -> Secrets and variables -> Actions**):

| Secret Name       | Description                                    | Example                                  |
| :---------------- | :--------------------------------------------- | :--------------------------------------- |
| `SSH_HOST`        | Target VPS IP address or hostname              | `203.0.113.10` or `vps.example.com`      |
| `SSH_USER`        | Deploy user configured on target host          | `deploy`                                 |
| `SSH_PORT`        | SSH port (defaults to 22 if omitted)           | `22`                                     |
| `SSH_PRIVATE_KEY` | OpenSSH private key with access to target host | `-----BEGIN OPENSSH PRIVATE KEY-----...` |

> [!IMPORTANT]
> Never hardcode or commit IP addresses, user credentials, or private keys directly into the repository. All deployment credentials must remain securely stored in GitHub Secrets.

---

## Development & Governance (SDD)

This repository strictly adheres to a **Pragmatic SDD (Software Design Document)** workflow and conventional commits. Direct ad-hoc coding without documented planning is prohibited.

- **OpenSpec Workflow**: All feature proposals, design decisions, specification deltas, and implementation task lists are managed under `openspec/changes/`.
- **Git Hooks & Linting**: Monorepo tooling uses `husky`, `lint-staged`, and `@commitlint/config-conventional` to enforce clean commit messages and Prettier formatting across all files.

```bash
# Install dependencies and setup git hooks
pnpm install

# Check formatting across repository
pnpm exec prettier --check .
```

---

## License

This project is licensed under the [MIT License](LICENSE).
