# Design: Gateway Caddy Proxy

## Context

Moody Blues is a modular, decoupled platform designed to run in cloud VPS, homelab LAN, or workstation environments. The gateway layer must be completely service-agnostic: it manages host-level TLS and networking, but must not hardcode or anticipate specific application backends. To support seamless verification across deployment stages (especially prior to CI/CD autodeploy in Change 03), the gateway serves a visual "Hello World" landing page on the root domain.

See `proposal.md` for background and motivation.

## Goals / Non-Goals

**Goals:**

- Provision the gateway compose stack under `compose/gateway/`.
- Configure `caddy` service using official `caddy:alpine`.
- Expose standard host ports 80 (HTTP) and 443 (HTTPS).
- Connect the container to the shared external Docker network `moody-blues-net`.
- Persist ACME certificates and runtime state across container lifecycles via named volumes (`caddy_data`, `caddy_config`).
- Mount a static HTML directory (`compose/gateway/html/`) to `/var/www/html:ro` serving a visual "Hello World" landing page via Caddy's `file_server` on `{$DOMAIN}`.
- Implement an agnostic base `Caddyfile` with:
  - Reusable snippets: `(security_headers)` and `(compression)`.
  - Static root file server for the landing page on `{$DOMAIN}`.
  - Dynamic inclusion directive: `import /etc/caddy/conf.d/*.caddy`.
- Mount local directory `compose/gateway/conf.d/` into `/etc/caddy/conf.d/`.
- Provide a clean root `.env.example` template declaring `DOMAIN=example.com`.

**Non-Goals:**

- Defining or configuring routes for any specific downstream service (Jellyfin, Jellyseerr, Navidrome, etc.) in this change.
- Exposing internal application ports on the host.

## Decisions

- **Caddy vs Nginx/Traefik:** Caddy is chosen for its zero-configuration automated TLS management, minimal Alpine footprint, native environment variable expansion, and clean `import` modular syntax.
- **Visual "Hello World" Landing Page:** Serving a static, styled `index.html` from `compose/gateway/html/` provides immediate visual proof in the browser that DNS, TLS, and ingress are working, which will directly validate the automated deployment pipeline in Change 03 (`ci-cd-ssh-autodeploy`).
- **Completely Agnostic Gateway:** The gateway contains zero application-specific routing rules. It acts strictly as an ingress runtime and snippet provider.
- **Modular Route Injection (`conf.d/`):** By importing `/etc/caddy/conf.d/*.caddy`, each downstream stack change is responsible for creating its own routing file (e.g., `tv.caddy`, `music.caddy`), preserving perfect monorepo decoupling.
- **External Network `moody-blues-net`:** Decouples compose stacks, allowing independent startup and lifecycles while preserving internal DNS service resolution.
- **Named Persistence Volumes:** Persisting `/data` and `/config` protects TLS certificates from being re-requested upon container recreation, preventing ACME rate-limiting.

## Risks / Trade-offs

- **[Empty `conf.d` directory during initial boot]** → Caddy handles wildcard imports (`import /etc/caddy/conf.d/*.caddy`) gracefully when matching files exist. We will include a `.gitkeep` to ensure the directory structure exists on checkout.
- **[External network dependency]** → The `moody-blues-net` Docker network must exist (`docker network create moody-blues-net`) before running the stack.
