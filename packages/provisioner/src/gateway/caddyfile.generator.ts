import type { MoodyBluesConfig } from '../config/config.types';

const ACME_STAGING_CA = 'https://acme-staging-v02.api.letsencrypt.org/directory';

function landingPage(watchHost: string, discoverHost: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Moody Blues</title></head><body><h1>Moody Blues</h1><ul>' +
    `<li><a href="https://${watchHost}">Watch</a></li>` +
    `<li><a href="https://${discoverHost}">Discover</a></li>` +
    '</ul></body></html>'
  );
}

function securitySnippet(hsts: boolean): string[] {
  return [
    '(security) {',
    '\theader {',
    '\t\tX-Content-Type-Options nosniff',
    '\t\tReferrer-Policy strict-origin-when-cross-origin',
    '\t\tX-Frame-Options SAMEORIGIN',
    ...(hsts ? ['\t\tStrict-Transport-Security max-age=31536000'] : []),
    '\t\t-Server',
    '\t}',
    '}',
  ];
}

function globalOptions(config: MoodyBluesConfig): string[] {
  const options =
    config.mode === 'local'
      ? ['local_certs', 'skip_install_trust']
      : [
          ...(config.acme.email ? [`email ${config.acme.email}`] : []),
          ...(config.acme.staging ? [`acme_ca ${ACME_STAGING_CA}`] : []),
        ];
  return options.length === 0 ? [] : ['{', ...options.map((option) => `\t${option}`), '}'];
}

export function renderCaddyfile(config: MoodyBluesConfig): string {
  const domain = config.domain.trim();
  if (!domain || /[\s{}]/.test(domain)) {
    throw new Error(`Invalid domain for Caddyfile: "${config.domain}"`);
  }

  const base = config.mode === 'local' ? 'localhost' : domain;
  const watchHost = `watch.${base}`;
  const discoverHost = `discover.${base}`;

  const blocks: string[][] = [
    globalOptions(config),
    securitySnippet(config.mode === 'remote'),
    [
      `${base} {`,
      '\timport security',
      '\theader Content-Type "text/html; charset=utf-8"',
      `\trespond \`${landingPage(watchHost, discoverHost)}\` 200`,
      '}',
    ],
    [
      `${watchHost} {`,
      '\timport security',
      '\treverse_proxy jellyfin:8096 {',
      '\t\tflush_interval -1',
      '\t}',
      '}',
    ],
    [`${discoverHost} {`, '\timport security', '\treverse_proxy seerr:5055', '}'],
  ];

  return (
    blocks
      .filter((block) => block.length > 0)
      .map((block) => block.join('\n'))
      .join('\n\n') + '\n'
  );
}
