# Moody Blues

Moody Blues turns a small Linux server into a private, hands-off streaming service. It deploys and wires together the usual media stack (Sonarr, Radarr, Prowlarr, Bazarr, Jellyfin, Seerr, Decypharr and a Caddy gateway) on top of [Real-Debrid](https://real-debrid.com), so friends can request a title and watch it minutes later, with no manual configuration in any web panel.

Everything is driven by a single command line tool, `moody-blues`.

---

## Requirements

- A Debian or Ubuntu server (x86_64 or arm64) with a user that has `sudo`.
- A [Real-Debrid](https://real-debrid.com) subscription and its API token.
- For a public deployment (`remote` mode): a domain whose `A` records point to the server for the root name, `watch.` and `discover.` (for example `example.com`, `watch.example.com` and `discover.example.com`), with ports 80 and 443 open.
- `fuse3` and about 4 GB of RAM are recommended.

The installer takes care of Docker Engine with Compose, `fuse3`, `git`, `curl`, Node.js and pnpm.

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/MrAguinaga/moody-blues/main/install.sh | bash
```

The script installs what is missing, downloads the latest release into `/usr/local/lib/moody-blues`, builds it and links the `moody-blues` command in `/usr/local/bin`. It never asks for secrets and can be run again safely. Log out and back in afterwards if it added your user to the `docker` group.

| Variable                  | Purpose                                                        |
| :------------------------ | :------------------------------------------------------------- |
| `MOODY_BLUES_REF`         | Tag, branch or commit to install instead of the latest release |
| `MOODY_BLUES_DIR`         | Code directory (default `/usr/local/lib/moody-blues`)          |
| `MOODY_BLUES_SKIP_DOCKER` | Set to `1` to leave Docker alone                               |
| `MB_HOME`                 | Data directory created for you (default `/opt/moody-blues`)    |

Check the installation:

```bash
moody-blues --version
```

---

## Set up

Put your settings in a private file and run the setup. Nothing else needs to be configured by hand.

```bash
install -m 600 /dev/null ~/secrets.env
```

```ini
# Required
RD_API_TOKEN=<your Real-Debrid API token>
ADMIN_USERNAME=<administrator user name>
ADMIN_PASSWORD=<administrator password>

# Deployment: "local" (localhost only) or "remote" (public HTTPS with your domain)
MB_MODE=remote
MB_DOMAIN=example.com
MB_ACME_EMAIL=you@example.com

# Optional
MB_TRANSCODING=off            # off, cpu or hardware
OPENSUBTITLES_USERNAME=
OPENSUBTITLES_PASSWORD=
```

```bash
moody-blues setup --env-file ~/secrets.env
moody-blues doctor
```

`setup` validates the host, starts the containers and configures every service through its API. Run it again after changing the file (add `--rotate-credentials` when you change the administrator password).

When it finishes, friends request titles at `https://discover.<domain>` and watch them at `https://watch.<domain>`, signing in with the Jellyfin users you create.

---

## Everyday commands

| Command                          | What it does                                                    |
| :------------------------------- | :-------------------------------------------------------------- |
| `moody-blues status`             | Live health of every service                                    |
| `moody-blues doctor`             | Diagnoses the stack and offers fixes (`--fix`)                  |
| `moody-blues start` / `stop`     | Starts or stops the containers without deleting data            |
| `moody-blues logs <service>`     | Recent logs of a service, with secrets masked                   |
| `moody-blues config`             | Shows or changes transcoding and the quality cap                |
| `moody-blues remove <title>`     | Deletes a title from the library, Real-Debrid and Seerr         |
| `moody-blues retry <series>`     | Retries an incomplete series as a full season pack              |
| `moody-blues tunnel user@server` | Run on your own computer: opens SSH tunnels to the admin panels |
| `moody-blues update`             | Looks for a new release and updates after your confirmation     |

Every command accepts `--help`, plus the global `--headless`, `--json` and `--yes` flags for scripts.

---

## Update

Updates are never automatic. To see whether a new release exists without changing anything:

```bash
moody-blues update --check
```

To install it, run `moody-blues update`. It shows the changelog and asks for confirmation (`--yes` skips the question), then checks out the release tag, reinstalls the dependencies, rebuilds, pulls the new container images and reapplies the provisioning. If the code was updated but the last stage failed, `moody-blues update --redeploy` repeats just that stage.

---

## Development

### Repository Architecture

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

### Prerequisites

- **Node.js**: `>= 20.10.0` (LTS recommended)
- **pnpm**: `>= 10.0.0` (configured with `12.x`)
- **Docker Engine**: `>= 24.0.0` (with Docker Compose v2)

---

### Commands

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

### Git Hooks

Code quality and commit standards are enforced automatically via **Husky** and **lint-staged**:

- **`pre-commit`**: Runs ESLint (`--fix`) and Prettier (`--write`) on staged files before each commit.
- **`commit-msg`**: Validates commit messages using **Commitlint** against the [Conventional Commits](https://www.conventionalcommits.org/) specification.
