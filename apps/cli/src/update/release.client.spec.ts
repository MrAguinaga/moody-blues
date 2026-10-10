import { describe, expect, it, vi } from 'vitest';

import { fetchLatestRelease, LATEST_RELEASE_URL, UpdateCheckError } from './release.client';

function reply(status: number, body: unknown, headers: Record<string, string> = {}): typeof fetch {
  return vi.fn(
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }),
  ) as unknown as typeof fetch;
}

describe('fetchLatestRelease', () => {
  it('requests the latest release with the documented headers', async () => {
    const request = reply(200, {
      tag_name: 'v0.2.0',
      html_url: 'https://example.test/r',
      body: 'x',
    });

    await fetchLatestRelease({ cliVersion: '0.1.0', fetch: request });

    const [url, init] = vi.mocked(request).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(LATEST_RELEASE_URL);
    expect(url).toBe('https://api.github.com/repos/MrAguinaga/moody-blues/releases/latest');
    expect(init.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'moody-blues-cli/0.1.0',
    });
  });

  it('maps the response into a release', async () => {
    const release = await fetchLatestRelease({
      cliVersion: '0.1.0',
      fetch: reply(200, {
        tag_name: 'v0.2.0',
        html_url: 'https://github.com/MrAguinaga/moody-blues/releases/tag/v0.2.0',
        body: '\n- First\n- Second\n',
      }),
    });

    expect(release).toEqual({
      tag: 'v0.2.0',
      version: '0.2.0',
      url: 'https://github.com/MrAguinaga/moody-blues/releases/tag/v0.2.0',
      body: '- First\n- Second',
    });
  });

  it('tolerates a release without notes', async () => {
    const release = await fetchLatestRelease({
      cliVersion: '0.1.0',
      fetch: reply(200, { tag_name: 'v0.2.0', body: null }),
    });

    expect(release).toMatchObject({ body: '', url: '' });
  });

  it('returns undefined when no release exists', async () => {
    expect(
      await fetchLatestRelease({
        cliVersion: '0.1.0',
        fetch: reply(404, { message: 'Not Found' }),
      }),
    ).toBeUndefined();
  });

  it('explains a rate limit with its reset time', async () => {
    const request = reply(403, { message: 'rate limit' }, { 'x-ratelimit-reset': '1790000000' });

    await expect(fetchLatestRelease({ cliVersion: '0.1.0', fetch: request })).rejects.toThrow(
      /rate limit.*2026-09-2/,
    );
  });

  it('reports other HTTP failures with their status', async () => {
    await expect(
      fetchLatestRelease({ cliVersion: '0.1.0', fetch: reply(500, 'boom') }),
    ).rejects.toThrow('HTTP 500');
  });

  it('reports a network failure with a clear message', async () => {
    const request = vi.fn(async () => {
      throw new TypeError('fetch failed', {
        cause: new Error('getaddrinfo ENOTFOUND api.github.com'),
      });
    }) as unknown as typeof fetch;

    await expect(fetchLatestRelease({ cliVersion: '0.1.0', fetch: request })).rejects.toThrow(
      'Could not reach GitHub to look for releases: getaddrinfo ENOTFOUND api.github.com.',
    );
  });

  it('rejects a tag that is not a version and a response that is not JSON', async () => {
    await expect(
      fetchLatestRelease({ cliVersion: '0.1.0', fetch: reply(200, { tag_name: 'nightly' }) }),
    ).rejects.toThrow('"nightly" is not a valid version');
    await expect(
      fetchLatestRelease({ cliVersion: '0.1.0', fetch: reply(200, '<html>') }),
    ).rejects.toThrow(UpdateCheckError);
  });

  it('propagates the caller abort instead of masking it', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    const request = vi.fn(async () => {
      throw new Error('aborted');
    }) as unknown as typeof fetch;

    await expect(
      fetchLatestRelease({ cliVersion: '0.1.0', fetch: request, signal: controller.signal }),
    ).rejects.toThrow('stop');
  });
});
