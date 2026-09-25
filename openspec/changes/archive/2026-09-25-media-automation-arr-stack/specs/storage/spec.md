# Spec Delta

## ADDED Requirements

### Requirement: Categorized Media Directory Structure

The storage subsystem SHALL expose categorized virtual subdirectories (`movies`, `shows`, `anime`, `torrents`) under `/mnt/media` via Zurg regex directory filtering.

#### Scenario: Virtual media directory partitioning

- **WHEN** Zurg mounts the Real-Debrid WebDAV endpoint
- **THEN** media items matching regex patterns are partitioned into `/mnt/media/movies`, `/mnt/media/shows`, and `/mnt/media/anime`, with `/mnt/media/torrents` acting as a comprehensive fallback
