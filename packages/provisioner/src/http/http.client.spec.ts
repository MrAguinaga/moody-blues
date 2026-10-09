import { describe, expect, it, vi } from 'vitest';

import { createFakeFetch, type FakeFetch } from '../testing/fake-fetch';
import { computeDelay, DEFAULT_RETRY_POLICY, parseRetryAfter } from './backoff.http';
import { createHttpClient } from './http.client';
import {
  HttpAbortError,
  HttpNetworkError,
  HttpStatusError,
  HttpTimeoutError,
  ProvisionHttpError,
} from './http.errors';
import type { HttpClient, HttpClientOptions, Sleep } from './http.types';

const API_KEY = 'super-secret-key-1234';
const BASE_URL = 'http://127.0.0.1:8989';

function connectionRefused(): Error {
  const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8989'), {
    code: 'ECONNREFUSED',
  });
  return Object.assign(new TypeError('fetch failed'), { cause });
}

function setup(overrides: Partial<HttpClientOptions> = {}) {
  const fake: FakeFetch = createFakeFetch();
  const sleep = vi.fn<Sleep>(async () => undefined);
  const client: HttpClient = createHttpClient({
    baseUrl: BASE_URL,
    headers: { 'X-Api-Key': API_KEY },
    fetch: fake.fetch,
    sleep,
    random: () => 0.5,
    ...overrides,
  });
  return { fake, sleep, client };
}

describe('computeDelay', () => {
  it('grows exponentially up to the cap without jitter', () => {
    const delays = [1, 2, 3, 4, 5, 6].map((retry) =>
      computeDelay(retry, DEFAULT_RETRY_POLICY, () => 0.5),
    );

    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });

  it('spreads the delay by the jitter fraction and never exceeds the cap', () => {
    expect(computeDelay(1, DEFAULT_RETRY_POLICY, () => 0)).toBe(400);
    expect(computeDelay(1, DEFAULT_RETRY_POLICY, () => 1)).toBe(600);
    expect(computeDelay(5, DEFAULT_RETRY_POLICY, () => 1)).toBe(8000);
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and http dates and ignores invalid values', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(
      parseRetryAfter('Wed, 21 Oct 2026 07:28:03 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')),
    ).toBe(3000);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('86400')).toBe(60_000);
  });
});

describe('createHttpClient requests', () => {
  it('sends the default headers and query and parses JSON', async () => {
    const { fake, client } = setup();
    fake.on('GET', '/api/v3/thing', { body: { id: 1 } });

    const result = await client.get('/api/v3/thing', { query: { page: 2, force: true } });

    expect(result).toEqual({ id: 1 });
    expect(fake.requests[0]).toMatchObject({
      method: 'GET',
      path: '/api/v3/thing',
      query: { page: '2', force: 'true' },
      headers: { 'x-api-key': API_KEY, accept: 'application/json' },
    });
    expect(fake.requests[0]?.headers['content-type']).toBeUndefined();
  });

  it('serializes bodies as JSON with a content type', async () => {
    const { fake, client } = setup();
    fake.on('POST', '/thing', { status: 201, body: { id: 7 } });
    fake.on('PUT', '/thing/7', { status: 202 });

    await expect(client.post('/thing', { name: 'x' })).resolves.toEqual({ id: 7 });
    await expect(client.put('/thing/7', { name: 'y' })).resolves.toBeUndefined();

    expect(fake.requests[0]?.headers['content-type']).toBe('application/json');
    expect(fake.requests[0]?.body).toEqual({ name: 'x' });
    expect(fake.requests[1]?.body).toEqual({ name: 'y' });
  });

  it('sends URLSearchParams bodies as url-encoded forms with repeated keys', async () => {
    const { fake, client } = setup();
    fake.on('POST', '/form', { status: 204 });
    const form = new URLSearchParams();
    form.append('tag', 'a b');
    form.append('tag', 'c&d');

    await expect(client.post('/form', form)).resolves.toBeUndefined();

    expect(fake.requests[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(fake.requests[0]?.body).toBe('tag=a+b&tag=c%26d');
  });

  it('accepts every 2xx and returns undefined for empty bodies', async () => {
    const { fake, client } = setup();
    fake.on('DELETE', '/thing/1', { status: 204 });
    fake.on('GET', '/accepted', { status: 202 });

    await expect(client.delete('/thing/1')).resolves.toBeUndefined();
    await expect(client.get('/accepted')).resolves.toBeUndefined();
  });

  it('joins base urls with and without a trailing slash', async () => {
    const withSlash = setup({ baseUrl: `${BASE_URL}/sonarr/` });
    withSlash.fake.on('GET', '/sonarr/ping', { body: { status: 'OK' } });

    await withSlash.client.get('/ping');

    expect(withSlash.fake.requests[0]?.path).toBe('/sonarr/ping');
  });

  it('fails with a typed error when a success response is not JSON', async () => {
    const { fake, client } = setup();
    fake.on('GET', '/html', { text: '<html>oops</html>' });

    await expect(client.get('/html')).rejects.toBeInstanceOf(HttpStatusError);
  });
});

describe('createHttpClient retries', () => {
  it('retries a GET on 503 and succeeds, sleeping with exponential backoff', async () => {
    const { fake, sleep, client } = setup();
    fake.on('GET', '/ping', { status: 503 }, { status: 503 }, { body: { status: 'OK' } });

    await expect(client.get('/ping')).resolves.toEqual({ status: 'OK' });

    expect(fake.count('GET', '/ping')).toBe(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  it('gives up after the configured attempts and throws the last status error', async () => {
    const { fake, sleep, client } = setup({ retry: { attempts: 3 } });
    fake.on('GET', '/down', { status: 500, text: 'boom' });

    const error = await client.get('/down').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpStatusError);
    expect(error).toMatchObject({ status: 500, bodySnippet: 'boom' });
    expect(fake.count('GET', '/down')).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('retries idempotent methods on network failures', async () => {
    const { fake, client } = setup();
    fake.on('PUT', '/thing/1', connectionRefused(), { status: 502 }, { status: 202 });

    await expect(client.put('/thing/1', {})).resolves.toBeUndefined();

    expect(fake.count('PUT')).toBe(3);
  });

  it.each([400, 401, 404, 409])('does not retry a definitive %i', async (status) => {
    const { fake, client } = setup();
    fake.on('GET', '/nope', { status });

    await expect(client.get('/nope')).rejects.toMatchObject({ status });

    expect(fake.count('GET')).toBe(1);
  });

  it.each([408, 425, 429, 500, 502, 503, 504])('retries a GET on %i', async (status) => {
    const { fake, client } = setup({ retry: { attempts: 2 } });
    fake.on('GET', '/flaky', { status }, { status: 200, body: {} });

    await expect(client.get('/flaky')).resolves.toEqual({});
  });

  it('does not repeat a POST after a response such as 500 or 502', async () => {
    const { fake, client } = setup();
    fake.on('POST', '/thing', { status: 500 });
    fake.on('POST', '/other', { status: 502 });

    await expect(client.post('/thing', {})).rejects.toMatchObject({ status: 500 });
    await expect(client.post('/other', {})).rejects.toMatchObject({ status: 502 });

    expect(fake.count('POST')).toBe(2);
  });

  it('repeats a POST on 429 and 503', async () => {
    const { fake, client } = setup();
    fake.on('POST', '/thing', { status: 429 }, { status: 503 }, { status: 201, body: { id: 1 } });

    await expect(client.post('/thing', {})).resolves.toEqual({ id: 1 });

    expect(fake.count('POST')).toBe(3);
  });

  it('repeats a POST only for failures that happen before any response', async () => {
    const { fake, client } = setup();
    fake.on('POST', '/thing', connectionRefused(), { status: 201, body: { id: 1 } });
    fake.on('POST', '/odd', new Error('socket hang up'));

    await expect(client.post('/thing', {})).resolves.toEqual({ id: 1 });
    await expect(client.post('/odd', {})).rejects.toBeInstanceOf(HttpNetworkError);

    expect(fake.count('POST', '/thing')).toBe(2);
    expect(fake.count('POST', '/odd')).toBe(1);
  });

  it('waits for the Retry-After interval when it exceeds the backoff', async () => {
    const { fake, sleep, client } = setup();
    fake.on('GET', '/limited', { status: 429, headers: { 'Retry-After': '3' } }, { body: {} });

    await client.get('/limited');

    expect(sleep.mock.calls[0]?.[0]).toBe(3000);
  });

  it('supports a per-request retry override', async () => {
    const { fake, client } = setup();
    fake.on('GET', '/down', { status: 503 });

    await expect(client.get('/down', { retry: { attempts: 1 } })).rejects.toMatchObject({
      status: 503,
    });

    expect(fake.count('GET')).toBe(1);
  });
});

describe('createHttpClient errors', () => {
  it('parses the validation failures of a 400 response', async () => {
    const { fake, client } = setup();
    fake.on('POST', '/thing', {
      status: 400,
      body: [
        {
          propertyName: 'Host',
          errorMessage: 'Unable to connect',
          detailedDescription: 'Name does not resolve',
          severity: 'error',
        },
        { propertyName: 'Name', errorMessage: 'Should be unique' },
      ],
    });

    const error = (await client
      .post('/thing', {})
      .catch((caught: unknown) => caught)) as HttpStatusError;

    expect(error.validation).toEqual([
      {
        propertyName: 'Host',
        errorMessage: 'Unable to connect',
        detailedDescription: 'Name does not resolve',
      },
      { propertyName: 'Name', errorMessage: 'Should be unique' },
    ]);
    expect(error.message).toBe(
      `POST ${BASE_URL}/thing responded 400: Host: Unable to connect (Name does not resolve); Name: Should be unique`,
    );
  });

  it('truncates the body snippet', async () => {
    const { fake, client } = setup();
    fake.on('GET', '/big', { status: 500, text: 'x'.repeat(5000) });

    const error = (await client
      .get('/big', { retry: { attempts: 1 } })
      .catch((caught: unknown) => caught)) as HttpStatusError;

    expect(error.bodySnippet).toHaveLength(200);
  });

  it('never leaks the api key or the query string in error messages', async () => {
    const { fake, client } = setup({ retry: { attempts: 1 } });
    fake.on('GET', '/status', { status: 500, text: 'internal error' });
    fake.on('GET', '/network', connectionRefused());
    fake.on('GET', '/slow', { hang: true });

    const failures = await Promise.all([
      client.get('/status', { query: { apikey: API_KEY } }).catch((caught: unknown) => caught),
      client.get('/network', { query: { apikey: API_KEY } }).catch((caught: unknown) => caught),
      client
        .get('/slow', { query: { apikey: API_KEY }, timeoutMs: 1 })
        .catch((caught: unknown) => caught),
    ]);

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(ProvisionHttpError);
      const error = failure as ProvisionHttpError;
      expect(error.message).not.toContain(API_KEY);
      expect(error.url).not.toContain(API_KEY);
      expect(error.url).not.toContain('?');
      expect(JSON.stringify({ message: error.message, url: error.url })).not.toContain(API_KEY);
    }
  });

  it('strips credentials embedded in the base url', async () => {
    const { fake, client } = setup({ baseUrl: 'http://user:pass@127.0.0.1:8989' });
    fake.on('GET', '/x', { status: 404 });

    const error = (await client.get('/x').catch((caught: unknown) => caught)) as HttpStatusError;

    expect(error.message).not.toContain('pass');
  });

  it('wraps the failure cause of a network error', async () => {
    const { fake, client } = setup({ retry: { attempts: 1 } });
    fake.on('GET', '/network', connectionRefused());

    const error = (await client
      .get('/network')
      .catch((caught: unknown) => caught)) as HttpNetworkError;

    expect(error).toBeInstanceOf(HttpNetworkError);
    expect(error.message).toContain('ECONNREFUSED');
    expect(error.cause).toBeInstanceOf(TypeError);
  });
});

describe('createHttpClient cancellation and timeouts', () => {
  it('throws an abort error without calling fetch when the signal is already aborted', async () => {
    const { fake, client } = setup();
    const controller = new AbortController();
    controller.abort();

    await expect(client.get('/ping', { signal: controller.signal })).rejects.toBeInstanceOf(
      HttpAbortError,
    );

    expect(fake.requests).toHaveLength(0);
  });

  it('aborts during the backoff wait without another attempt', async () => {
    const controller = new AbortController();
    const sleep = vi.fn<Sleep>(async (_ms, signal) => {
      controller.abort();
      signal?.throwIfAborted();
    });
    const { fake, client } = setup({ sleep });
    fake.on('GET', '/down', { status: 503 });

    await expect(client.get('/down', { signal: controller.signal })).rejects.toBeInstanceOf(
      HttpAbortError,
    );

    expect(fake.count('GET')).toBe(1);
  });

  it('aborts an in-flight request and does not retry it', async () => {
    const { fake, client } = setup();
    const controller = new AbortController();
    fake.on('GET', '/slow', { hang: true });

    const pending = client.get('/slow', { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(HttpAbortError);
    expect(fake.count('GET')).toBe(1);
  });

  it('honors the signal given in the client options', async () => {
    const controller = new AbortController();
    const { fake, client } = setup({ signal: controller.signal });
    fake.on('GET', '/slow', { hang: true });

    const pending = client.get('/slow');
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(HttpAbortError);
  });

  it('times out a hanging request and retries it when it is idempotent', async () => {
    const { fake, client } = setup({ retry: { attempts: 2 }, timeoutMs: 1 });
    fake.on('GET', '/slow', { hang: true }, { body: { ok: true } });

    await expect(client.get('/slow')).resolves.toEqual({ ok: true });

    expect(fake.count('GET')).toBe(2);
  });

  it('throws a timeout error and does not repeat a POST that timed out', async () => {
    const { fake, client } = setup({ timeoutMs: 1 });
    fake.on('POST', '/slow', { hang: true });

    const error = await client.post('/slow', {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpTimeoutError);
    expect(error).toMatchObject({ timeoutMs: 1 });
    expect(fake.count('POST')).toBe(1);
  });
});
