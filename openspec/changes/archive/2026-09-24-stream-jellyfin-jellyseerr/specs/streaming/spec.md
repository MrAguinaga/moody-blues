# Spec Delta: Streaming Capability

## Purpose

Provides media streaming and user request services for the Moody Blues platform through Jellyfin and Jellyseerr, enforcing 100% Direct Play, parameterized ingress routing via `JELLYFIN_DOMAIN`, and unified path-based discovery.

## ADDED Requirements

### Requirement: Direct Play Media Streaming via Jellyfin

The streaming subsystem SHALL serve media content mounted at `/media` exclusively via Direct Play and Direct Stream without CPU video transcoding, ensuring concurrent playback for multiple users within host compute limits.

#### Scenario: Direct Play streaming playback

- **WHEN** an authenticated user initiates playback of a media item in `/media`
- **THEN** Jellyfin delivers the video and audio streams directly to the client player without invoking server-side CPU video transcoding

#### Scenario: Prevention of host compute exhaustion

- **WHEN** a client device requests playback with incompatible video codecs
- **THEN** server-side CPU video transcoding is disabled, preventing CPU saturation across the host vCores

---

### Requirement: Self-Service Content Requests via Jellyseerr

The streaming subsystem SHALL expose a user discovery and request portal linked to Jellyfin user authentication, enabling users to search, browse, and request media with automated request tracking.

#### Scenario: User discovery and request submission

- **WHEN** a user logs in to Jellyseerr and submits a request for a movie or series
- **THEN** Jellyseerr logs the request and marks it as approved for downstream automation

#### Scenario: Integrated Jellyfin authentication

- **WHEN** a user signs in to the request portal
- **THEN** Jellyseerr validates credentials against the Jellyfin media server user accounts

---

### Requirement: Parameterized Ingress Routing with Fallback Domain

The platform gateway SHALL route public HTTPS requests for the streaming domain configured by `JELLYFIN_DOMAIN` (falling back to `jellyfin.{$DOMAIN}`) to internal services based on request path: `/request*` routes to Jellyseerr on port 5055, and all remaining paths route to Jellyfin on port 8096.

#### Scenario: Accessing Jellyfin streaming interface with custom or fallback domain

- **WHEN** an HTTPS client visits the domain evaluated from `{$JELLYFIN_DOMAIN:jellyfin.{$DOMAIN}}`
- **THEN** Caddy reverse proxies the request to `jellyfin:8096` with automated TLS termination and security headers

#### Scenario: Accessing Jellyseerr request portal

- **WHEN** an HTTPS client visits `/request` or `/request/*` on the streaming domain
- **THEN** Caddy strips the `/request` prefix and reverse proxies the request to `jellyseerr:5055`

---

### Requirement: Strict Resource Conservation and Trickplay Safeguards

The streaming subsystem SHALL preserve host SSD and memory resources by disabling Trickplay preview frame extraction while maintaining TMDB official posters and metadata.

#### Scenario: Media library indexing without disk saturation

- **WHEN** Jellyfin scans libraries mounted from `/media`
- **THEN** metadata and posters are retrieved without generating millions of localized thumbnail frames on the NVMe SSD

---

### Requirement: Automated CI/CD Stream Stack Deployment and Ingress Reload

The deployment pipeline SHALL validate compose configurations for the stream stack during pre-flight checks and automatically orchestrate container deployment and gateway configuration reload on deployment branches.

#### Scenario: Pre-flight syntax validation

- **WHEN** a push or merge occurs on deployment branches
- **THEN** CI validates `compose/stream/docker-compose.yml` before opening remote SSH connections

#### Scenario: Remote stream stack orchestration

- **WHEN** deployment executes on the target VPS
- **THEN** the pipeline deploys `jellyfin` and `jellyseerr` on `moody-blues-net`, confirms container health, and reloads Caddy to activate `stream.caddy` routing
