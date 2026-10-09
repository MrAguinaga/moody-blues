import { describe, expect, it } from 'vitest';

import { createStubFetch, createTestContext } from '../doctor-context.testing';
import { bazarrProvidersCheck, evaluateProviders } from './bazarr-providers.check';

const provider = (name: string, status = 'Good', retry = '-') => ({ name, status, retry });

describe('evaluateProviders', () => {
  it('compares names without case or punctuation', () => {
    const result = evaluateProviders([provider('Gestdown'), provider('OpenSubtitles.com')], {
      opensubtitles: true,
    });

    expect(result).toEqual({ healthy: ['Gestdown', 'OpenSubtitles.com'], problems: [] });
  });

  it('does not expect OpenSubtitles.com without credentials', () => {
    const result = evaluateProviders([provider('gestdown')], { opensubtitles: false });

    expect(result.problems).toEqual([]);
    expect(result.healthy).toEqual(['Gestdown']);
  });

  it('reports a provider in another state with its retry', () => {
    const result = evaluateProviders(
      [provider('gestdown'), provider('opensubtitlescom', 'AuthenticationError', 'in 6 hours')],
      { opensubtitles: true },
    );

    expect(result.problems).toEqual([
      'OpenSubtitles.com is not in the Good state (AuthenticationError; retry in 6 hours)',
    ]);
  });

  it.each(['ConfigurationError', 'HTTPError', 'Throttled'])('reports the %s state', (status) => {
    const result = evaluateProviders([provider('gestdown', status)], { opensubtitles: false });

    expect(result.problems).toEqual([`Gestdown is not in the Good state (${status})`]);
  });

  it('reports an expected provider that is not listed', () => {
    const result = evaluateProviders([], { opensubtitles: true });

    expect(result.problems).toEqual([
      'Gestdown is not listed by Bazarr',
      'OpenSubtitles.com is not listed by Bazarr',
    ]);
  });

  it('ignores providers that are not expected', () => {
    const result = evaluateProviders([provider('gestdown'), provider('podnapisi', 'HTTPError')], {
      opensubtitles: false,
    });

    expect(result.problems).toEqual([]);
  });
});

function bazarrWith(providers: ReturnType<typeof provider>[], status = 200) {
  const stub = createStubFetch();
  stub.on('GET', '/api/providers', { status, body: { data: providers } });
  return stub;
}

const CREDENTIALS = { OPENSUBTITLES_USERNAME: 'user', OPENSUBTITLES_PASSWORD: 'password-value' };

describe('bazarrProvidersCheck', () => {
  it('is ok when the expected providers are Good', async () => {
    const { ctx } = createTestContext({
      env: CREDENTIALS,
      stubs: { bazarr: bazarrWith([provider('gestdown'), provider('opensubtitlescom')]) },
    });

    expect(await bazarrProvidersCheck.run(ctx)).toEqual({
      status: 'ok',
      message: 'Gestdown and OpenSubtitles.com in the Good state',
    });
  });

  it('warns about an isolated provider', async () => {
    const { ctx } = createTestContext({
      env: CREDENTIALS,
      stubs: {
        bazarr: bazarrWith([
          provider('gestdown'),
          provider('opensubtitlescom', 'Throttled', 'in 1 hour'),
        ]),
      },
    });

    const result = await bazarrProvidersCheck.run(ctx);

    expect(result.status).toBe('warning');
    expect(result.message).toBe(
      'OpenSubtitles.com is not in the Good state (Throttled; retry in 1 hour)',
    );
  });

  it('summarizes several problems in the details', async () => {
    const { ctx } = createTestContext({
      env: CREDENTIALS,
      stubs: { bazarr: bazarrWith([]) },
    });

    const result = await bazarrProvidersCheck.run(ctx);

    expect(result.message).toBe('2 subtitle providers need attention');
    expect(result.details).toHaveLength(2);
  });

  it('warns when the providers cannot be read', async () => {
    const { ctx } = createTestContext({ stubs: { bazarr: bazarrWith([], 500) } });

    expect((await bazarrProvidersCheck.run(ctx)).status).toBe('warning');
  });

  it('is skipped when the Bazarr container is stopped', async () => {
    const { ctx, stubs } = createTestContext({
      services: { bazarr: { state: 'exited', health: 'none' } },
    });

    expect((await bazarrProvidersCheck.run(ctx)).status).toBe('skipped');
    expect(stubs.bazarr.requests).toEqual([]);
  });
});
