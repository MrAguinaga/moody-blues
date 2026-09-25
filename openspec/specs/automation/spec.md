# automation Specification

## Purpose

Orchestrates automated indexer search, media tracking, release evaluation, and debrid acquisition bridging Sonarr, Radarr, Prowlarr, and RDT-Client.

## Requirements

### Requirement: Indexer and Tracker Proxy Management via Prowlarr

The automation stack SHALL provide a centralized indexer proxy service via Prowlarr that synchronizes search indexers and trackers with downstream media managers.

#### Scenario: Prowlarr service startup and sync

- **WHEN** Prowlarr starts on `moody-blues-net`
- **THEN** it exposes its Web UI on port 9696 and allows indexer configuration and synchronization with Sonarr and Radarr

### Requirement: Series and Anime Management via Sonarr

The automation stack SHALL provide automated series tracking and anime management via Sonarr, monitoring requested shows and dispatching release queries to indexers.

#### Scenario: Sonarr service startup and media root path

- **WHEN** Sonarr initializes on `moody-blues-net`
- **THEN** it provides its Web UI on port 8989 and mounts `/mnt/media` to access categorized root library folders

### Requirement: Movie Management via Radarr

The automation stack SHALL provide automated movie tracking and release management via Radarr, monitoring requested films and dispatching queries to indexers.

#### Scenario: Radarr service startup and movie root path

- **WHEN** Radarr initializes on `moody-blues-net`
- **THEN** it provides its Web UI on port 7878 and mounts `/mnt/media` to access categorized movie root library folders

### Requirement: Virtual Debrid Download Client Bridging via RDT-Client

The automation stack SHALL expose a virtual download client proxy via RDT-Client that emulates the qBittorrent Web API for Sonarr and Radarr, offloading grabbed torrents to Real-Debrid and ensuring media files remain within the virtual filesystem mount.

#### Scenario: Torrent offloading to Real-Debrid

- **WHEN** Sonarr or Radarr grabs a release and dispatches the torrent to RDT-Client
- **THEN** RDT-Client adds the torrent to Real-Debrid, monitors cloud availability, and notifies Sonarr/Radarr when available in the virtual mount
