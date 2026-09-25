# Design: Virtual Cloud Storage via Zurg and Rclone

## Context

The Moody Blues infrastructure runs on an OVHcloud VPS with 40 GB NVMe SSD storage. Media libraries for ~30 users require access to tens of terabytes of media files without storing raw video files permanently on local disk. Real-Debrid provides high-speed cloud caching of torrent content, which can be queried via API.

See `proposal.md` for problem background and motivation.

## Goals / Non-Goals

**Goals:**

- Provide a POSIX-compliant virtual filesystem at `/mnt/media` exposing the user's Real-Debrid library.
- Deploy `zurg` to maintain an internal WebDAV server on port 9999 connected to the shared network `moody-blues-net`.
- Deploy `rclone` with FUSE access to mount the WebDAV endpoint to `/mnt/media`.
- Tune Rclone VFS caching flags to ensure smooth multi-stream playback while bounding local disk usage to $\le 10\text{ GB}$.
- Enforce strict single-IP origin for all Real-Debrid API calls.
- Keep configuration 100% agnostic with environment parametrization (`RD_API_TOKEN`, `MEDIA_MOUNT_PATH`, `PUID`, `PGID`).

**Non-Goals:**

- Running local torrent download clients (qBittorrent, Transmission) on the VPS.
- Permanent local mirroring of the entire video library.
- Exposing the Zurg WebDAV port (9999) to the public internet (it remains internal to `moody-blues-net`).

## Decisions

### Decision 1: Architecture Pattern (Zurg + Rclone Mount)

- **Choice:** Run Zurg as an API/WebDAV proxy and Rclone as the FUSE filesystem client.
- **Rationale:** Zurg manages Real-Debrid API interactions, torrent repairs, and WebDAV directory structuring. Rclone converts the WebDAV stream into a standard Linux directory mount (`/mnt/media`) that Jellyfin, Sonarr, and Radarr can access natively as if it were a physical disk.
- **Alternatives Considered:** Direct WebDAV in media servers — rejected because Jellyfin does not support WebDAV directly as a library storage backend, and *Arr automation requires standard filesystem operations.

### Decision 2: Container Privileges and Mount Propagation

- **Choice:** Configure Rclone with `cap_add: [SYS_ADMIN]`, `devices: [/dev/fuse]`, `security_opt: [apparmor:unconfined]`, and mount `${MEDIA_MOUNT_PATH:-/mnt/media}:/mnt/media:rshared`.
- **Rationale:** Creating a FUSE filesystem mount inside a container requires kernel device access and `SYS_ADMIN`. The `rshared` mount propagation flag is mandatory so that the mount created inside Rclone is propagated to the host filesystem and visible to downstream sibling containers.

### Decision 3: Rclone VFS Streaming Cache Tuning

- **Choice:** Apply tailored VFS caching parameters:
  - `--vfs-cache-mode full`: Allows full read/write buffering and fast random seek.
  - `--vfs-cache-max-size 10G`: Hard cap ensuring VFS cache never consumes more than 10 GB of the host's 40 GB NVMe SSD.
  - `--vfs-read-chunk-size 64M`: Reads files in 64 MB chunks for rapid initial playback start.
  - `--vfs-read-chunk-size-limit 2G`: Doubles chunk size progressively for high-bitrate continuous streams.
  - `--buffer-size 64M`: In-memory buffer per active stream.
  - `--dir-cache-time 15s`: Frequently refreshes directory listings when new media is added.
- **Rationale:** Balances instant streaming responsiveness with strict memory and disk protection on a 4 GB RAM / 40 GB SSD host.

### Decision 4: Parameterization and Zero-Hardcoding

- **Choice:** Centralize configuration in root `.env.example` with `RD_API_TOKEN`, `MEDIA_MOUNT_PATH=/mnt/media`, `PUID=1000`, `PGID=1000`. In `compose/storage/config.yml`, reference the token dynamically.
- **Rationale:** Maintains 100% portability without committing secrets or assuming fixed system usernames.

### Decision 5: CI/CD Pipeline Integration and Deployment Orchestration

- **Choice:** Extend `.github/workflows/deploy.yml` with:
  1. Pre-flight Docker Compose validation of `compose/storage/docker-compose.yml` using `.env.example`.
  2. Remote SSH execution ensuring `/mnt/media` directory creation on the host and orchestrating `docker compose -f compose/storage/docker-compose.yml up -d --remove-orphans`.
  3. Status inspection verifying `zurg` and `rclone` containers are running.
- **Rationale:** Prevents configuration drift and ensures the virtual storage stack is deployed automatically alongside the gateway upon merge to `development` or `main`.

## Risks / Trade-offs

- **[Host SSD Exhaustion]** → _Mitigation:_ `--vfs-cache-max-size 10G` limits cache footprint; cache automatically evicts oldest chunks when threshold is reached.
- **[Real-Debrid API Rate Limiting]** → _Mitigation:_ Zurg configuration enforces rate-limiting safeguards (`check_for_changes_every_secs: 15`).
- **[Mount Drop on Network Interruption]** → _Mitigation:_ Docker container healthcheck verifies `/mnt/media` readability and container `restart: unless-stopped` automatically recovers failed sessions.
