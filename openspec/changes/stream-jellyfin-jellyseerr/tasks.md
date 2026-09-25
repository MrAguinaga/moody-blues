# Tasks

## 1. Ingress Routing and Environment Configuration

- [ ] 1.1 Document optional `JELLYFIN_DOMAIN` in root `.env.example` under the streaming configuration section.
- [ ] 1.2 Update `compose/gateway/docker-compose.yml` injecting `JELLYFIN_DOMAIN: ${JELLYFIN_DOMAIN:-jellyfin.${DOMAIN:-example.com}}` into Caddy's environment.
- [ ] 1.3 Create `compose/gateway/conf.d/stream.caddy` defining ingress `{$JELLYFIN_DOMAIN:jellyfin.{$DOMAIN}}` with `handle_path /request*` proxying to `jellyseerr:5055` and default `handle` proxying to `jellyfin:8096`.
- [ ] 1.4 Verify formatting and structure of gateway configuration using Prettier.

## 2. Stream Stack Orchestration (Jellyfin and Jellyseerr)

- [ ] 2.1 Scaffold `compose/stream/docker-compose.yml` declaring `jellyfin` (`jellyfin/jellyfin:latest`) with read-only media mount `${MEDIA_MOUNT_PATH:-/mnt/media}:/media:ro`, and `jellyseerr` (`fallenbagel/jellyseerr:latest`) on `moody-blues-net` with persistent volumes and healthchecks.
- [ ] 2.2 Verify syntax and environment interpolation of the stream stack using `docker compose --env-file .env.example -f compose/stream/docker-compose.yml config --quiet`.

## 3. Continuous Deployment Integration

- [ ] 3.1 Update `.github/workflows/deploy.yml` `pre-flight` job to validate `compose/stream/docker-compose.yml` syntax alongside gateway and storage stacks.
- [ ] 3.2 Update `.github/workflows/deploy.yml` remote deployment script to synchronize `JELLYFIN_DOMAIN` into `.env`, orchestrate `compose/stream/docker-compose.yml`, reload Caddy configuration (`caddy reload`), and verify running status for `jellyfin` and `jellyseerr`.
