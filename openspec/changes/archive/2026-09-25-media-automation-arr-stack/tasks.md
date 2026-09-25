# Tasks

## 1. Storage & Virtual Directory Partitioning

- [x] 1.1 Update `compose/storage/config.yml` with regex filters for `movies`, `shows`, `anime`, and `torrents` fallback

## 2. Automation Stack Orchestration

- [x] 2.1 Update `.env.example` with automation domain placeholders (`SONARR_DOMAIN`, `RADARR_DOMAIN`, `PROWLARR_DOMAIN`)
- [x] 2.2 Create `compose/automation/docker-compose.yml` declaring `sonarr`, `radarr`, `prowlarr`, and `rdt-client` services on `moody-blues-net`

## 3. Gateway Ingress Routing

- [x] 3.1 Update `compose/gateway/docker-compose.yml` to inject automation domain environment variables into Caddy container
- [x] 3.2 Create `compose/gateway/conf.d/automation.caddy` routing `sonarr`, `radarr`, and `prowlarr` with `security_headers` and `compression` snippets

## 4. CI/CD Deployment Integration

- [x] 4.1 Update `.github/workflows/deploy.yml` with pre-flight check and remote orchestration for `compose/automation` stack
