# Spec Delta

## ADDED Requirements

### Requirement: Automation Stack Ingress Routing

The gateway SHALL route configured automation subdomains (`SONARR_DOMAIN`, `RADARR_DOMAIN`, `PROWLARR_DOMAIN`) to their respective upstream containers on internal port mappings with TLS termination.

#### Scenario: Ingress routing for automation dashboards

- **WHEN** incoming requests target configured automation domain endpoints
- **THEN** Caddy terminates TLS and proxies traffic to `sonarr:8989`, `radarr:7878`, or `prowlarr:9696`
