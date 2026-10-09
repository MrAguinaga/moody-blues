import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultConfig } from '../config/config.defaults';
import { createLayout } from '../home/home.paths';
import { renderCaddyfile } from './caddyfile.generator';
import { caddyfilePath, writeCaddyfile } from './caddyfile.writer';

const identity = { puid: 1000, pgid: 1000 };

function remoteConfig(acme: { email?: string; staging?: boolean } = {}) {
  return createDefaultConfig({
    mode: 'remote',
    domain: 'example.com',
    acme: { staging: false, ...acme },
    host: identity,
  });
}

describe('renderCaddyfile', () => {
  it('renders local mode with internal certificates and localhost sites', () => {
    const output = renderCaddyfile(createDefaultConfig({ host: identity }));

    expect(output.startsWith('{\n\tlocal_certs\n\tskip_install_trust\n}\n')).toBe(true);
    expect(output).toContain('\nlocalhost {\n');
    expect(output).toContain('\nwatch.localhost {\n');
    expect(output).toContain('\ndiscover.localhost {\n');
    expect(output).not.toContain('Strict-Transport-Security');
    expect(output).not.toContain('acme_ca');
  });

  it('renders remote mode with explicit sites, HSTS and the email', () => {
    const output = renderCaddyfile(remoteConfig({ email: 'admin@example.com' }));

    expect(output.startsWith('{\n\temail admin@example.com\n}\n')).toBe(true);
    expect(output).toContain('\nexample.com {\n');
    expect(output).toContain('\nwatch.example.com {\n');
    expect(output).toContain('\ndiscover.example.com {\n');
    expect(output).toContain('Strict-Transport-Security max-age=31536000');
    expect(output).not.toContain('local_certs');
    expect(output).not.toContain('*.');
  });

  it('points the staging CA only when acme.staging is enabled', () => {
    const staging = renderCaddyfile(remoteConfig({ email: 'a@b.co', staging: true }));
    const production = renderCaddyfile(remoteConfig({ email: 'a@b.co' }));

    expect(staging).toContain('\tacme_ca https://acme-staging-v02.api.letsencrypt.org/directory');
    expect(production).not.toContain('acme_ca');
  });

  it('omits the global block when remote mode has no email and no staging', () => {
    const output = renderCaddyfile(remoteConfig());

    expect(output.startsWith('(security) {')).toBe(true);
    expect(output).not.toContain('email');
  });

  it('defines the security snippet and imports it on every site', () => {
    for (const config of [createDefaultConfig({ host: identity }), remoteConfig()]) {
      const output = renderCaddyfile(config);

      expect(output.match(/^\(security\) \{$/gm)).toHaveLength(1);
      expect(output.match(/^\timport security$/gm)).toHaveLength(3);
      expect(output).toContain('\t\t-Server\n');
      expect(output).toContain('\t\tX-Content-Type-Options nosniff\n');
    }
  });

  it('proxies watch to jellyfin without buffering and discover to seerr', () => {
    const output = renderCaddyfile(remoteConfig());

    expect(output).toContain('\treverse_proxy jellyfin:8096 {\n\t\tflush_interval -1\n\t}\n');
    expect(output).toContain('\treverse_proxy seerr:5055\n');
  });

  it('serves a static HTML landing linking to watch and discover', () => {
    const output = renderCaddyfile(remoteConfig());

    expect(output).toContain('\theader Content-Type "text/html; charset=utf-8"\n');
    expect(output).toContain('href="https://watch.example.com"');
    expect(output).toContain('href="https://discover.example.com"');
  });

  it('is deterministic', () => {
    const config = remoteConfig({ email: 'admin@example.com', staging: true });

    expect(renderCaddyfile(config)).toBe(renderCaddyfile(structuredClone(config)));
  });

  it('rejects domains that would break the Caddyfile syntax', () => {
    expect(() => renderCaddyfile({ ...remoteConfig(), domain: 'bad domain {' })).toThrow(
      'Invalid domain',
    );
  });
});

describe('writeCaddyfile', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-caddy-'));
    mkdirSync(join(sandbox, 'config', 'caddy', 'etc'), { recursive: true });
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('writes the file once and reports no change on identical content', () => {
    const layout = createLayout(sandbox);
    const config = remoteConfig({ email: 'admin@example.com' });

    expect(writeCaddyfile(layout, config)).toEqual({ changed: true });
    expect(readFileSync(caddyfilePath(layout), 'utf8')).toBe(renderCaddyfile(config));
    expect(statSync(caddyfilePath(layout)).mode & 0o777).toBe(0o644);
    expect(writeCaddyfile(layout, config)).toEqual({ changed: false });
  });

  it('reports a change when the configuration differs', () => {
    const layout = createLayout(sandbox);

    writeCaddyfile(layout, remoteConfig());

    expect(writeCaddyfile(layout, remoteConfig({ email: 'admin@example.com' }))).toEqual({
      changed: true,
    });
  });
});
