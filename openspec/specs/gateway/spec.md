# gateway Specification

## Purpose

Provides a secure, centralized, and application-agnostic ingress point for the host via reverse proxy, automated TLS certificate lifecycle management, visual landing verification, and modular site configuration loading.

## Requirements

### Requirement: Automated TLS Termination

The gateway SHALL automatically obtain and renew TLS certificates for the configured root domain (`${DOMAIN}`) over HTTPS (port 443).

#### Scenario: HTTPS Certificate Provisioning

- **WHEN** incoming traffic requests the configured `${DOMAIN}` via port 443
- **THEN** the gateway terminates TLS with a valid certificate and serves the configured response

### Requirement: Visual Landing Verification

The gateway SHALL serve a visual "Hello World" landing page on the configured `${DOMAIN}` indicating the gateway and ingress proxy are operational.

#### Scenario: Visual Landing Page Served

- **WHEN** a client opens `https://${DOMAIN}/` in a web browser
- **THEN** the gateway responds with HTTP 200 and renders the visual landing page containing operational status details

### Requirement: Modular Configuration Loading

The gateway SHALL dynamically load modular route configurations from `/etc/caddy/conf.d/*.caddy`.

#### Scenario: Load modular site configurations

- **WHEN** valid configuration files are present in the `conf.d` directory
- **THEN** the gateway imports and serves the routes defined within those files

### Requirement: HTTP Security and Performance Snippets

The gateway SHALL provide reusable configuration snippets enforcing transport security headers and compression.

#### Scenario: Compression and Security Headers

- **WHEN** a response is served with security headers applied
- **THEN** the response includes Strict-Transport-Security headers and is encoded with zstd/gzip compression where supported

---

### Requirement: Automation Stack Ingress Routing

The gateway SHALL route configured automation subdomains (`SONARR_DOMAIN`, `RADARR_DOMAIN`, `PROWLARR_DOMAIN`) to their respective upstream containers on internal port mappings with TLS termination.

#### Scenario: Ingress routing for automation dashboards

- **WHEN** incoming requests target configured automation domain endpoints
- **THEN** Caddy terminates TLS and proxies traffic to `sonarr:8989`, `radarr:7878`, or `prowlarr:9696`
