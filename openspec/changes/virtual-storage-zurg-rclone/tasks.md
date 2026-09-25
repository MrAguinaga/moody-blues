# Tasks

## 1. Environment and Zurg WebDAV Configuration

- [x] 1.1 Update root `.env.example` with Real-Debrid and storage variables (`RD_API_TOKEN`, `MEDIA_MOUNT_PATH`, `PUID`, `PGID`) and verify formatting.
- [x] 1.2 Create `compose/storage/config.yml` with Zurg WebDAV configuration, token interpolation, and rate-limit parameters.

## 2. Docker Compose and Rclone Mount Orchestration

- [x] 2.1 Scaffold `compose/storage/docker-compose.yml` defining `zurg` and `rclone` services on `moody-blues-net` with `SYS_ADMIN` capability, `/dev/fuse`, and `rshared` mount flags targeting `${MEDIA_MOUNT_PATH:-/mnt/media}`.
- [x] 2.2 Create `compose/storage/rclone.conf` configuring the WebDAV remote pointing to the internal `zurg` container endpoint.
- [x] 2.3 Verify syntax and structure of the storage stack using `docker compose --env-file .env.example -f compose/storage/docker-compose.yml config`.

## 3. Continuous Deployment Orchestration

- [x] 3.1 Update `.github/workflows/deploy.yml` pre-flight job to validate `compose/storage/docker-compose.yml` with `--env-file .env.example`.
- [x] 3.2 Update `.github/workflows/deploy.yml` remote deployment script to create `/mnt/media`, orchestrate `compose/storage/docker-compose.yml`, and verify container health.
