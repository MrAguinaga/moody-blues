# Tasks

## 1. Directory and Compose Configuration

- [x] 1.1 Create directory `compose/gateway/`, `compose/gateway/conf.d/` with `.gitkeep`, `compose/gateway/html/`, and root `.env.example` defining `DOMAIN=example.com`
- [x] 1.2 Create `compose/gateway/docker-compose.yml` declaring `caddy:alpine`, ports 80/443, persistence volumes (`caddy_data`, `caddy_config`), volume mounts for `conf.d` and `html`, and `moody-blues-net` external network

## 2. Visual Landing Page and Gateway Configuration

- [ ] 2.1 Create modern visual "Hello World" landing page in `compose/gateway/html/index.html` displaying Moody Blues gateway status
- [ ] 2.2 Create `compose/gateway/Caddyfile` with reusable snippets (`security_headers`, `compression`), static file server for `html` on `{$DOMAIN}`, and `import /etc/caddy/conf.d/*.caddy`
- [ ] 2.3 Verify compose configuration and Caddyfile syntax
