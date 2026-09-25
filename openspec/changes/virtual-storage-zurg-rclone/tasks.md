# Tasks

## 1. Environment and Zurg WebDAV Configuration

- [ ] 1.1 Update root `.env.example` with Real-Debrid and storage variables (`RD_API_TOKEN`, `MEDIA_MOUNT_PATH`, `PUID`, `PGID`) and verify formatting.
- [ ] 1.2 Create `compose/storage/config.yml` with Zurg WebDAV configuration, token interpolation, and rate-limit parameters.

## 2. Docker Compose and Rclone Mount Orchestration

- [ ] 2.1 Scaffold `compose/storage/docker-compose.yml` defining `zurg` and `rclone` services on `moody-blues-net` with `SYS_ADMIN` capability, `/dev/fuse`, and `rshared` mount flags targeting `${MEDIA_MOUNT_PATH:-/mnt/media}`.
- [ ] 2.2 Create `compose/storage/rclone.conf` configuring the WebDAV remote pointing to the internal `zurg` container endpoint.
- [ ] 2.3 Verify syntax and structure of the storage stack using `docker compose --env-file .env.example -f compose/storage/docker-compose.yml config`.
