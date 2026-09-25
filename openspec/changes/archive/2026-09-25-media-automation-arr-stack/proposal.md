# Proposal

## Why

While Jellyfin streaming and Jellyseerr discovery are operational, media acquisition remains completely manual. Requests in Jellyseerr have nowhere to go without the automation pipeline. Implementing the *Arr stack (`sonarr`, `radarr`, `prowlarr`) paired with `rdt-client` and categorized Zurg directory filters creates an autonomous media pipeline where requests in Jellyseerr automatically trigger indexer searches, send torrents to Real-Debrid, and surface them in categorized Jellyfin libraries (`shows`, `movies`, `anime`) within minutes.

## What Changes

- **Automation Stack Orchestration (`compose/automation/docker-compose.yml`):**
  - `sonarr`: Automated tracking and management for TV shows and anime (port 8989).
  - `radarr`: Automated tracking and management for movies (port 7878).
  - `prowlarr`: Centralized tracker and indexer proxy connected to Sonarr and Radarr (port 9696).
  - `rdt-client`: Virtual download client emulating qBittorrent API that offloads torrents to Real-Debrid and mounts them to virtual storage (port 6500).
- **Zurg Categorized Directory Filtering (`compose/storage/config.yml`):**
  - Update Zurg WebDAV configuration to split `/mnt/media` into categorized virtual directories: `movies`, `shows`, `anime`, and `torrents` fallback.
- **Gateway Ingress Configuration (`compose/gateway/conf.d/automation.caddy`):**
  - Secure TLS reverse proxy routing for management dashboards (`sonarr.${DOMAIN}`, `radarr.${DOMAIN}`, `prowlarr.${DOMAIN}`).
- **CI/CD Deployment Pipeline (`.github/workflows/deploy.yml`):**
  - Update pre-flight syntax checks and remote orchestration to include the `compose/automation` stack.
- **Environment Template (`.env.example`):**
  - Document domain variables and API key configuration placeholders.

## Capabilities

### New Capabilities

- `automation`: End-to-end media automation, indexing, and debrid acquisition bridging Sonarr, Radarr, Prowlarr, and RDT-Client.

### Modified Capabilities

- `storage`: Provide categorized virtual directory mapping (`shows`, `movies`, `anime`, `torrents`) in Zurg.
- `gateway`: Expose automation service ingress endpoints via Caddy.

## Impact

- **Services**: Adds 4 new lightweight containers (`sonarr`, `radarr`, `prowlarr`, `rdt-client`) to `moody-blues-net`.
- **Storage**: Updates Zurg configuration; requires reload of `compose/storage` without wiping data.
- **Routing**: Caddy gateway loads `conf.d/automation.caddy` with automatic TLS for administration endpoints.
- **CI/CD**: Adds pre-flight compose check and health verification in GitHub Actions workflow.
