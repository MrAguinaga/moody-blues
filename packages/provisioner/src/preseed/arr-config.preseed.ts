import type { ArrConfigInput, ArrService } from './preseed.types';

interface ArrProfile {
  port: number;
  sslPort: number;
  branch: string;
  instanceName: string;
}

const ARR_PROFILES: Record<ArrService, ArrProfile> = {
  sonarr: { port: 8989, sslPort: 9898, branch: 'main', instanceName: 'Sonarr' },
  radarr: { port: 7878, sslPort: 9898, branch: 'master', instanceName: 'Radarr' },
  prowlarr: { port: 9696, sslPort: 6969, branch: 'master', instanceName: 'Prowlarr' },
};

export const ARR_CONFIG_ELEMENTS = [
  'BindAddress',
  'Port',
  'SslPort',
  'EnableSsl',
  'LaunchBrowser',
  'ApiKey',
  'AuthenticationMethod',
  'AuthenticationRequired',
  'Branch',
  'LogLevel',
  'UrlBase',
  'InstanceName',
  'AnalyticsEnabled',
] as const;

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function readArrApiKey(content: string): string | undefined {
  return /<ApiKey>([^<]*)<\/ApiKey>/.exec(content)?.[1];
}

export function renderArrConfigXml(input: ArrConfigInput): string {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new Error(`The ${input.service} API key must not be empty`);
  }
  const profile = ARR_PROFILES[input.service];

  const values: Record<(typeof ARR_CONFIG_ELEMENTS)[number], string> = {
    BindAddress: '*',
    Port: String(profile.port),
    SslPort: String(profile.sslPort),
    EnableSsl: 'False',
    LaunchBrowser: 'False',
    ApiKey: escapeXml(apiKey),
    AuthenticationMethod: 'Forms',
    AuthenticationRequired: 'Enabled',
    Branch: profile.branch,
    LogLevel: 'info',
    UrlBase: '',
    InstanceName: profile.instanceName,
    AnalyticsEnabled: 'False',
  };

  const lines = ARR_CONFIG_ELEMENTS.map((name) => `  <${name}>${values[name]}</${name}>`);
  return `<Config>\n${lines.join('\n')}\n</Config>\n`;
}
