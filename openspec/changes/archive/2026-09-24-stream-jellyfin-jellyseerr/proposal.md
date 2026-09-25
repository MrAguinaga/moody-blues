# Proposal: Media Streaming Core via Jellyfin and Jellyseerr

## Why

With the infinite virtual cloud storage stack operational at `/mnt/media`, the Moody Blues platform requires a user-facing media streaming interface and automated discovery portal for ~30 friends and family. Serving dozens of simultaneous users on an OVHcloud VPS with limited compute (2 vCores) and storage (40 GB NVMe) requires strict resource governance: 100% Direct Play without CPU-intensive transcoding, zero disk exhaustion from Trickplay thumbnails, and an intuitive Netflix-like web experience routed through parameterized domain ingress (`JELLYFIN_DOMAIN` with fallback to service-named subdomain `jellyfin.${DOMAIN}`).

## What Changes

- Create `compose/stream/` modular stack directory.
- Scaffold `compose/stream/docker-compose.yml`:
  - Service `jellyfin`: Official Jellyfin container (`jellyfin/jellyfin:latest`) on `moody-blues-net` with read-only bind mount `${MEDIA_MOUNT_PATH:-/mnt/media}:/media:ro`, published server URL referencing `${JELLYFIN_DOMAIN:-jellyfin.${DOMAIN:-example.com}}`, and persistent volumes for config and cache.
  - Service `jellyseerr`: Official Jellyseerr container (`fallenbagel/jellyseerr:latest`) on `moody-blues-net` with persistent config volume, exposing port 5055 internally.
- Add modular gateway route `compose/gateway/conf.d/stream.caddy`:
  - Route `{$JELLYFIN_DOMAIN:jellyfin.{$DOMAIN}}`:
    - Path `handle_path /request*` reverse proxies to `jellyseerr:5055`.
    - Catch-all `handle` reverse proxies to `jellyfin:8096`.
- Update `compose/gateway/docker-compose.yml`:
  - Injects `JELLYFIN_DOMAIN: ${JELLYFIN_DOMAIN:-jellyfin.${DOMAIN:-example.com}}` into Caddy's container environment.
- Document in root `.env.example`:
  - Adds optional `# JELLYFIN_DOMAIN=jellyfin.example.com` under the streaming configuration section.
- Enforce streaming resource guardrails:
  - Global CPU transcoding disabled to ensure zero CPU burn on 2 vCores.
  - Trickplay preview image extraction disabled to preserve the 40 GB NVMe SSD, while retaining TMDB official episode artwork.
  - User isolation: Individual watch history, resume points, and parental control profiles.
- Integrate into Continuous Deployment pipeline (`.github/workflows/deploy.yml`):
  - Pre-flight syntax validation of `compose/stream/docker-compose.yml`.
  - Self-healing environment variable synchronization for `JELLYFIN_DOMAIN`.
  - Remote deployment orchestration and container health checks for `jellyfin` and `jellyseerr`, with seamless Caddy reload for `stream.caddy`.

## Capabilities

### New Capabilities

- `streaming`: Centralized media streaming platform (Jellyfin) and request management portal (Jellyseerr) with strict Direct Play enforcement, parameterized ingress routing (`JELLYFIN_DOMAIN`), and automated CI/CD deployment.

### Modified Capabilities

<!-- None -->

## Impact

- **Affected Code & Directories:**
  - Adds `compose/stream/docker-compose.yml`
  - Adds `compose/gateway/conf.d/stream.caddy`
  - Updates `compose/gateway/docker-compose.yml`
  - Updates `.env.example`
  - Updates `.github/workflows/deploy.yml`
- **Host & Network Dependencies:**
  - DNS `A` record for subdomain `jellyfin.<domain>` (or configured `JELLYFIN_DOMAIN`) pointing to VPS public IP.
  - Read access to `/mnt/media` (provided by Change 04).
- **Downstream Capabilities:**
  - Establishes media library and request backend ready for Change 06 (`media-automation-arr-stack`).
