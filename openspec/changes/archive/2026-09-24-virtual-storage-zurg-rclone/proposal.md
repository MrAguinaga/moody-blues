# Proposal: Infinite Virtual Storage via Zurg and Rclone

## Why

Storing terabytes of high-definition 4K and 1080p media files locally is economically infeasible and quickly exhausts the VPS host's 40 GB NVMe SSD. Furthermore, running BitTorrent downloads directly on home internet consumes upload bandwidth and exposes consumer IP addresses.

To support high-concurrency streaming for ~30 users without massive physical disk arrays, the platform requires an infinite virtual cloud filesystem. By connecting Real-Debrid's multi-petabyte cached library through Zurg (high-speed WebDAV proxy) and mounting it into the host filesystem at `/mnt/media` using Rclone with VFS streaming cache flags, downstream media services (Jellyfin, Sonarr, Radarr) can read unlimited media files on-demand while consuming minimal local disk space.

## What Changes

- Create `compose/storage/` modular stack directory.
- Scaffold `compose/storage/docker-compose.yml`:
  - Service `zurg`: Official Zurg container connected to `moody-blues-net` exposing internal WebDAV on port 9999.
  - Service `rclone`: Official Rclone container configured with `SYS_ADMIN` capability, `/dev/fuse` device access, and `rshared` bind mount to expose `/mnt/media` to the host and downstream stacks.
- Add `compose/storage/config.yml`:
  - Declarative Zurg configuration defining WebDAV parameters, check intervals, and token injection.
- Add `compose/storage/rclone.conf`:
  - Pre-configured WebDAV remote pointing to the internal `zurg` container (`http://zurg:9999/dav`).
- Parameterize Real-Debrid credentials and mount paths in the canonical root `.env.example`:
  - `RD_API_TOKEN`: User API token obtained from Real-Debrid.
  - `MEDIA_MOUNT_PATH`: Host directory path for the virtual media mount (defaults to `/mnt/media`).
  - `PUID` / `PGID`: Permissions identifiers for shared mount read/write access.
- Enforce strict IP isolation: all requests to Real-Debrid originate exclusively from the deployment host IP.
- Update `.github/workflows/deploy.yml` with pre-flight syntax validation for the storage stack and automated remote deployment on the VPS host with directory initialization (`/mnt/media`).

## Capabilities

### New Capabilities

- `storage`: Infinite virtual filesystem integrating Real-Debrid through Zurg WebDAV and exposing an optimized streaming mount at `/mnt/media` via Rclone.

### Modified Capabilities

<!-- None -->

## Impact

- **Affected Code & Directories:**
  - Adds `compose/storage/docker-compose.yml`
  - Adds `compose/storage/config.yml`
  - Adds `compose/storage/rclone.conf`
  - Updates root `.env.example`
  - Updates `.github/workflows/deploy.yml`
- **Host Dependencies:**
  - Requires Linux FUSE kernel module (`/dev/fuse`) enabled on the host.
  - Creates host mount point `/mnt/media`.
- **Downstream Capabilities:**
  - Establishes the virtual media library prerequisite for Change 05 (`tv-streaming-jellyfin-jellyseerr`) and Change 06 (`media-automation-arr-stack`).
