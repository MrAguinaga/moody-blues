# Proposal: Gateway Caddy Proxy

## Why

A secure, modular, and completely service-agnostic ingress layer is required to terminate public TLS traffic and manage reverse proxy routing for all containerized stacks in the monorepo. Establishing this gateway early provides a unified entrypoint, standardizes security headers and compression, creates a modular extension point (`conf.d/`) for future services, and delivers a visual "Hello World" landing page to immediately verify live deployments and TLS termination in the browser.

## What Changes

- Provision Caddy as the central reverse proxy stack under `compose/gateway/`.
- Connect the gateway container to the shared external Docker network `moody-blues-net`.
- Expose standard host ports 80 (HTTP) and 443 (HTTPS) for public and LAN ingress.
- Configure automated TLS certificate provisioning for the configured root domain `${DOMAIN}`.
- Implement reusable Caddy snippets for modern HTTP compression (zstd/gzip) and security headers (HSTS, nosniff, etc.).
- Mount and serve a clean, modern visual "Hello World" landing page (`compose/gateway/html/index.html`) on `${DOMAIN}` to visually confirm operational readiness.
- Mount and configure a modular configuration directory (`compose/gateway/conf.d/`) via `import /etc/caddy/conf.d/*.caddy`.
- Provide a clean `.env.example` template at the repository root with `DOMAIN=example.com`.
- Define the architectural specification for the gateway capability.

## Capabilities

### New Capabilities

- `gateway`: Core reverse proxy, automated TLS termination, visual landing verification, reusable security/compression snippets, and modular route inclusion via `conf.d/`.

### Modified Capabilities

None.

## Impact

- Binds host ports 80 and 443; serves as the sole external ingress point for the entire host.
- Connects to the external Docker network `moody-blues-net`.
- Completely service-agnostic: zero coupling to media, audio, or book applications.
- Provides immediate visual feedback upon deployment before subsequent application stacks are provisioned.
