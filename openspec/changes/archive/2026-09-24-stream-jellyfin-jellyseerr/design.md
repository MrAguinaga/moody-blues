# Design: Media Streaming Core via Jellyfin and Jellyseerr

## Context

The Moody Blues infrastructure operates on an OVHcloud VPS (2 vCores, 4 GB RAM, 40 GB NVMe SSD). Change 04 established an infinite virtual storage mount at `/mnt/media` backed by Real-Debrid via Zurg WebDAV and Rclone. Change 02 established Caddy as an automated TLS reverse proxy with modular configuration discovery (`conf.d/*.caddy`).

See `proposal.md` for problem background and motivation.

## Goals / Non-Goals

**Goals:**

- Deploy Jellyfin media server in `compose/stream/` with read-only access to `${MEDIA_MOUNT_PATH:-/mnt/media}`.
- Deploy Jellyseerr discovery and request portal in `compose/stream/` linked to Jellyfin for authentication.
- Configure path-based Caddy routing in `compose/gateway/conf.d/stream.caddy` on `{$JELLYFIN_DOMAIN:jellyfin.{$DOMAIN}}`:
  - `/request*` routes to Jellyseerr (`jellyseerr:5055`).
  - `/` and all other paths route to Jellyfin (`jellyfin:8096`).
- Inject `JELLYFIN_DOMAIN` into `compose/gateway/docker-compose.yml` with fallback to `jellyfin.${DOMAIN:-example.com}`.
- Document optional `# JELLYFIN_DOMAIN=jellyfin.example.com` in root `.env.example`.
- Enforce strict server resource boundaries: 100% Direct Play (no CPU transcoding) and zero Trickplay image generation.
- Integrate stream stack into `.github/workflows/deploy.yml` with pre-flight compose validation, remote orchestration, and Caddy configuration reload.

**Non-Goals:**

- Enabling server-side CPU video transcoding or hardware acceleration (2 vCores dedicated to network I/O and direct streaming).
- Generating Trickplay scrub thumbnails (protects the 40 GB SSD).
- Automating tracker indexing or torrent grabbing (reserved for Change 06: `media-automation-arr-stack`).

## Decisions

### Decision 1: Parameterized Ingress Routing (`JELLYFIN_DOMAIN`) with Service-Named Fallback

- **Choice:** Consolidate streaming and request services under domain `{$JELLYFIN_DOMAIN:jellyfin.{$DOMAIN}}` using Caddy path-based routing:
  - `handle_path /request*` forwards to `jellyseerr:5055` (stripping prefix).
  - Default `handle` forwards to `jellyfin:8096`.
- **Rationale:** Adheres strictly to the platform standard: every service defaults to its own name plus the domain (`jellyfin.${DOMAIN}`), while leaving the environment variable `JELLYFIN_DOMAIN` free and optional in `.env` for user overrides (e.g. `stream.domain` or custom subdomains). Requires only a single DNS `A` record (`jellyfin` -> VPS public IP) on Namecheap, avoids multiple domain certificates, and gives users a single URL destination.
- **Alternatives Considered:** Hardcoded subdomains — rejected in favor of environment override with service-named fallback.

### Decision 2: Read-Only Storage Bind Mount (`/media:ro`)

- **Choice:** Mount the virtual media filesystem into Jellyfin as a read-only bind mount:
  - `${MEDIA_MOUNT_PATH:-/mnt/media}:/media:ro`
- **Rationale:** Protects the virtual FUSE filesystem from accidental mutation or deletion by media server processes. All media writes and organisation are reserved for downstream automation (*Arr stack).

### Decision 3: Performance Guardrails (Direct Play & No Trickplay)

- **Choice:** Enforce global policies in Jellyfin server configuration:
  1. Video transcoding disabled in user playback profiles (100% Direct Play).
  2. Trickplay preview generation disabled globally.
- **Rationale:** A 2 vCore VPS cannot transcode 4K/1080p video streams on CPU without stalling the host. Direct Play offloads video decoding to client devices (Smart TVs, Chromecast, smartphones, laptops). Disabling Trickplay saves tens of gigabytes of disk space and millions of inode writes on the 40 GB SSD while leaving official TMDB episode posters intact.

### Decision 4: Persistent State Isolation via Named Volumes

- **Choice:** Isolate persistent application state in named Docker volumes:
  - `jellyfin_config`: User accounts, libraries, watch progress, resume points.
  - `jellyfin_cache`: Image caches and transient state.
  - `jellyseerr_config`: Application settings, request logs, invitation links.
- **Rationale:** Ensures state survives container recreation during CI/CD deployments and upgrades.

### Decision 5: Seamless Gateway Reload & Environment Synchronization in CI/CD Pipeline

- **Choice:** Extend `.github/workflows/deploy.yml` to:
  1. Validate `compose/stream/docker-compose.yml` during pre-flight checks.
  2. Synchronize `JELLYFIN_DOMAIN` into `.env` if missing during deployment.
  3. Deploy `compose/stream` and dynamically trigger Caddy reload:
     `docker compose --env-file .env -f compose/gateway/docker-compose.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile`
- **Rationale:** Activates the `stream.caddy` ingress route dynamically without restarting Caddy or dropping active TLS sessions.

## Risks / Trade-offs

- **[Client Player Codec Incompatibility]** → _Mitigation:_ Media automation in Change 06 will strictly prioritize standard universal codecs (H.264 / AAC / AC3 / HEVC) with embedded subtitles, ensuring universal Direct Play compatibility across client devices.
- **[Memory Spikes during Library Scan]** → _Mitigation:_ Bounded cache sizes in Jellyfin and container memory limits prevent OOM errors on 4 GB RAM host.
