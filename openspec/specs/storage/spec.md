# storage Specification

## Purpose

Provides an infinite virtual cloud filesystem for the Moody Blues platform by mounting Real-Debrid cached torrents via Zurg WebDAV and Rclone with streaming-optimized VFS caching.

## Requirements

### Requirement: Real-Debrid API Integration via Zurg

The storage subsystem SHALL authenticate with the Real-Debrid API using an environment-provided token (`RD_API_TOKEN`) and expose the user's active torrent library over an internal WebDAV service on the shared network `moody-blues-net`.

#### Scenario: Successful WebDAV service startup

- **WHEN** the `zurg` service starts with a valid `RD_API_TOKEN`
- **THEN** it connects to Real-Debrid and begins serving the virtual filesystem directory tree over WebDAV on port 9999

#### Scenario: Invalid or missing token handling

- **WHEN** the `zurg` service starts with an empty or invalid `RD_API_TOKEN`
- **THEN** it logs an explicit authentication error and halts without crashing the host

---

### Requirement: Virtual Filesystem Host Mount via Rclone

The storage subsystem SHALL mount the internal Zurg WebDAV endpoint into `/mnt/media` on the host filesystem using Rclone with VFS streaming cache flags, enabling downstream containers to access media files as standard filesystem directories.

#### Scenario: Filesystem mount with streaming optimization

- **WHEN** the `rclone` container mounts the WebDAV remote to `/mnt/media`
- **THEN** media files are immediately readable with chunked read streaming and directory caching

#### Scenario: Proper permissions and host sharing

- **WHEN** downstream applications query `/mnt/media`
- **THEN** the mount provides read and traversal permissions governed by configured `PUID` and `PGID` via shared mount flags

---

### Requirement: Strict IP Isolation for Debrid Access

All external network interactions with Real-Debrid API endpoints and content delivery servers SHALL originate exclusively from the single IP address of the deployment host, preventing multi-IP concurrency bans.

#### Scenario: Outbound traffic strictly routed from host

- **WHEN** media streams or directory listings are fetched from Real-Debrid
- **THEN** all network connections originate exclusively from the host running the `zurg` container

---

### Requirement: Resilient Mount Recovery and Health Monitoring

The storage subsystem SHALL continuously verify the health of the WebDAV connection and mount availability, automatically attempting re-connection if network drops occur.

#### Scenario: Virtual mount verification

- **WHEN** the storage stack completes initialization
- **THEN** a healthcheck probe validates that `/mnt/media` contains accessible directories

#### Scenario: Recovery on transient disconnection

- **WHEN** external network connectivity to Real-Debrid drops and resumes
- **THEN** the storage subsystem re-establishes the WebDAV session without requiring manual container restarts

---

### Requirement: Automated CI/CD Deployment Orchestration

The deployment pipeline SHALL validate Docker Compose syntax for the storage stack during pre-flight checks and orchestrate container deployment with host directory initialization on the target VPS.

#### Scenario: Pre-flight syntax validation

- **WHEN** a pull request or push occurs on deployment branches
- **THEN** CI validates `compose/storage/docker-compose.yml` against environment templates before initiating SSH connections

#### Scenario: Remote host deployment

- **WHEN** deployment executes on the VPS host
- **THEN** the pipeline ensures `/mnt/media` exists, deploys the storage containers, and confirms they are in running state

---

### Requirement: Categorized Media Directory Structure

The storage subsystem SHALL expose categorized virtual subdirectories (`movies`, `shows`, `anime`, `torrents`) under `/mnt/media` via Zurg regex directory filtering.

#### Scenario: Virtual media directory partitioning

- **WHEN** Zurg mounts the Real-Debrid WebDAV endpoint
- **THEN** media items matching regex patterns are partitioned into `/mnt/media/movies`, `/mnt/media/shows`, and `/mnt/media/anime`, with `/mnt/media/torrents` acting as a comprehensive fallback
