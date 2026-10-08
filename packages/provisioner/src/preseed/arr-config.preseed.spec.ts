import { describe, expect, it } from 'vitest';

import { ARR_CONFIG_ELEMENTS, readArrApiKey, renderArrConfigXml } from './arr-config.preseed';
import type { ArrService } from './preseed.types';

function elements(xml: string): [string, string][] {
  return [...xml.matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map((match) => [match[1]!, match[2]!]);
}

describe('renderArrConfigXml', () => {
  it.each<[ArrService, Record<string, string>]>([
    ['sonarr', { Port: '8989', SslPort: '9898', Branch: 'main', InstanceName: 'Sonarr' }],
    ['radarr', { Port: '7878', SslPort: '9898', Branch: 'master', InstanceName: 'Radarr' }],
    ['prowlarr', { Port: '9696', SslPort: '6969', Branch: 'master', InstanceName: 'Prowlarr' }],
  ])('renders the %s values in the closed element order', (service, specific) => {
    const parsed = elements(renderArrConfigXml({ service, apiKey: 'abc123' }));

    expect(parsed.map(([name]) => name)).toEqual([...ARR_CONFIG_ELEMENTS]);
    const values = Object.fromEntries(parsed);
    expect(values).toMatchObject({
      BindAddress: '*',
      EnableSsl: 'False',
      LaunchBrowser: 'False',
      ApiKey: 'abc123',
      AuthenticationMethod: 'Forms',
      AuthenticationRequired: 'Enabled',
      LogLevel: 'info',
      UrlBase: '',
      AnalyticsEnabled: 'False',
      ...specific,
    });
  });

  it('never emits an element twice', () => {
    const names = elements(renderArrConfigXml({ service: 'sonarr', apiKey: 'abc123' })).map(
      ([name]) => name,
    );

    expect(new Set(names).size).toBe(names.length);
  });

  it('never emits legacy or insecure authentication settings', () => {
    const xml = renderArrConfigXml({ service: 'sonarr', apiKey: 'abc123' });

    expect(xml).not.toContain('AuthenticationEnabled');
    expect(xml).not.toContain('DisabledForLocalAddresses');
  });

  it('wraps the elements in a Config root', () => {
    const xml = renderArrConfigXml({ service: 'radarr', apiKey: 'abc123' });

    expect(xml.startsWith('<Config>\n')).toBe(true);
    expect(xml.endsWith('</Config>\n')).toBe(true);
  });

  it.each(['', '   '])('rejects the empty API key %j', (apiKey) => {
    expect(() => renderArrConfigXml({ service: 'sonarr', apiKey })).toThrow(/must not be empty/);
  });

  it('escapes XML metacharacters in the key', () => {
    const xml = renderArrConfigXml({ service: 'sonarr', apiKey: 'a&b<c' });

    expect(xml).toContain('<ApiKey>a&amp;b&lt;c</ApiKey>');
  });
});

describe('readArrApiKey', () => {
  it('extracts the key from a rendered file', () => {
    expect(readArrApiKey(renderArrConfigXml({ service: 'prowlarr', apiKey: 'k3y' }))).toBe('k3y');
  });

  it('returns undefined when there is no key', () => {
    expect(readArrApiKey('<Config></Config>')).toBeUndefined();
  });
});
