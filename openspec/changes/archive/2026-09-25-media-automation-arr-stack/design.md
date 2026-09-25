# Design

## Context

The platform currently operates an ingress gateway (`compose/gateway`), a virtual filesystem backed by Real-Debrid (`compose/storage` via Zurg + Rclone mounting `/mnt/media`), and a media streaming core (`compose/stream` via Jellyfin on `watch.<domain>` and Jellyseerr on `discover.<domain>`). All services communicate over the bridge network `moody-blues-net`. To complete the automated media acquisition loop, downstream services must be orchestrated to bridge user requests in Jellyseerr to indexer queries, torrent additions to Real-Debrid, and library indexing in Jellyfin.

## Goals / Non-Goals

**Goals:**

- Provide a dedicated, modular automation stack in `compose/automation/docker-compose.yml` (`sonarr`, `radarr`, `prowlarr`, and `rdt-client`).
- Partition the virtual media filesystem via Zurg directory filters into categorized folders: `/mnt/media/movies`, `/mnt/media/shows`, `/mnt/media/anime`, and `/mnt/media/torrents`.
- Enable internal microservice communication over `moody-blues-net` without exposing download client credentials to the public internet.
- Provide secure Caddy reverse proxy routing for management dashboards (`sonarr.${DOMAIN}`, `radarr.${DOMAIN}`, `prowlarr.${DOMAIN}`) with automated TLS termination.
- Update GitHub Actions deployment pipeline for automated syntax validation and remote execution.

**Non-Goals:**

- Subtitle extraction and post-processing via Bazarr (deferred to a dedicated subtitles change).
- Downloading heavy torrent payload files to the VPS SSD (100% cloud streaming via Real-Debrid).
- Exposing `rdt-client` to the public internet (strictly internal on `moody-blues-net`).

## Decisions

### Decision 1: Use `rdt-client` as Virtual qBittorrent Emulation

- **Rationale:** Sonarr and Radarr require an active download client to receive grabbed releases. Traditional torrent clients (qBittorrent, Transmission) would download whole video files to the VPS SSD, exhausting the 40 GB NVMe disk. `rdt-client` emulates the qBittorrent Web API for Sonarr and Radarr, intercepts the release, submits it to Real-Debrid, and signals completion so the virtual files in `/mnt/media` are indexed without consuming local disk space.
- **Alternatives Considered:**
  - _qBittorrent with download scripts:_ Complex, risks downloading multi-gigabyte files locally.
  - _Torrent Blackhole:_ Prone to state synchronization errors and lacks status reporting back to the *Arr apps.

### Decision 2: Zurg Virtual Directory Partitioning

- **Rationale:** Instead of dumping all cached torrents into a flat `/torrents` directory, Zurg's `config.yml` supports regex-based filtering. We configure distinct virtual directory groups for `movies`, `shows`, and `anime`, maintaining `torrents` as a fallback. This allows Jellyfin, Sonarr, and Radarr to bind to dedicated library roots cleanly.
- **Alternatives Considered:**
  - _Manual host symlinks:_ Requires custom scripts and fragile maintenance.

### Decision 3: Internal Inter-Service Communication

- **Rationale:** All integrations between Jellyseerr, Sonarr, Radarr, Prowlarr, and RDT-Client execute over the internal Docker network `moody-blues-net` using internal container names and ports (e.g., `http://sonarr:8989`, `http://radarr:7878`, `http://prowlarr:9696`, `http://rdt-client:6500`).
- **Benefits:** Zero latency overhead, immune to external DNS issues or NAT loopback limitations, and maximum security.

### Decision 4: Dedicated Caddy Ingress for Administration

- **Rationale:** In accordance with the project's ingress architecture, management dashboards are exposed via subdomains with automated Let's Encrypt certificates loaded through `compose/gateway/conf.d/automation.caddy`.

## Risks / Trade-offs

- **[Risk] File movement / import conflicts:** Sonarr or Radarr might attempt to physically move or copy files from `/mnt/media` to local paths.  
  → _Mitigation:_ Configure Sonarr and Radarr root folders directly within `/mnt/media/shows` and `/mnt/media/movies`, and set RDT-Client to keep files in-place.
- **[Risk] RAM exhaustion on 4 GB VPS:** Running multiple .NET microservices alongside Jellyfin could pressure system memory.  
  → _Mitigation:_ LinuxServer images for Sonarr, Radarr, and Prowlarr are lightweight (consuming ~100–150 MB each). Total stack memory footprint remains under 1 GB, comfortably within the 4 GB VPS capacity.

## Migration Plan

1. **Phase 1 (Storage):** Update `compose/storage/config.yml` with categorized directory filters and reload Zurg.
2. **Phase 2 (Automation Stack):** Scaffold `compose/automation/docker-compose.yml` declaring `sonarr`, `radarr`, `prowlarr`, and `rdt-client`.
3. **Phase 3 (Gateway Ingress):** Create `compose/gateway/conf.d/automation.caddy` and update `compose/gateway/docker-compose.yml` with domain variables.
4. **Phase 4 (CI/CD Pipeline):** Update `.github/workflows/deploy.yml` with pre-flight compose validation and deployment orchestration.
