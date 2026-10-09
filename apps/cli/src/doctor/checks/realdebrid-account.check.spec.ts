import { describe, expect, it } from 'vitest';

import type { FetchLike } from '@moody-blues/provisioner';

import { createTestContext, TEST_KEYS, TEST_NOW } from '../doctor-context.testing';
import { createRealDebridAccountCheck, evaluateAccount } from './realdebrid-account.check';

const DAY_MS = 86_400_000;

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    username: 'private-user',
    email: 'private@example.com',
    points: 100,
    type: 'premium',
    premium: 5_000_000,
    expiration: new Date(TEST_NOW + 60 * DAY_MS).toISOString(),
    ...overrides,
  };
}

function fetchReplying(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { impl, calls };
}

describe('evaluateAccount', () => {
  it('is ok with a subscription expiring in 60 days and reports the date', () => {
    const result = evaluateAccount(account(), TEST_NOW);

    expect(result.status).toBe('ok');
    expect(result.message).toBe(
      'The Real-Debrid subscription is active until 2026-12-08 (60 days left)',
    );
  });

  it('warns when it expires in 10 days', () => {
    const result = evaluateAccount(
      account({ expiration: new Date(TEST_NOW + 10 * DAY_MS).toISOString() }),
      TEST_NOW,
    );

    expect(result.status).toBe('warning');
    expect(result.message).toBe(
      'The Real-Debrid subscription expires on 2026-10-19 (10 days left)',
    );
  });

  it('is ok at exactly 14 days and warns at 13', () => {
    const at = (days: number) =>
      evaluateAccount(
        account({ expiration: new Date(TEST_NOW + days * DAY_MS).toISOString() }),
        TEST_NOW,
      ).status;

    expect(at(14)).toBe('ok');
    expect(at(13)).toBe('warning');
  });

  it.each([
    ['a free account', { type: 'free', premium: 0 }],
    ['no premium seconds left', { premium: 0 }],
    ['an expiration in the past', { expiration: new Date(TEST_NOW - DAY_MS).toISOString() }],
  ])('fails for %s', (_name, patch) => {
    const result = evaluateAccount(account(patch), TEST_NOW);

    expect(result.status).toBe('error');
    expect(result.message).toBe('The Real-Debrid account has no active subscription');
  });

  it('derives the date from the premium seconds when there is no expiration', () => {
    const result = evaluateAccount(
      account({ expiration: undefined, premium: 20 * 86_400 }),
      TEST_NOW,
    );

    expect(result.status).toBe('ok');
    expect(result.message).toContain('(20 days left)');
  });

  it('warns with only the field names when the format is unexpected', () => {
    const result = evaluateAccount({ id: 1, username: 'private-user' }, TEST_NOW);

    expect(result.status).toBe('warning');
    expect(result.details).toEqual(['fields received: id, username']);
    expect(JSON.stringify(result)).not.toContain('private-user');
  });
});

describe('createRealDebridAccountCheck', () => {
  it('reads GET /user once with the token as a bearer credential', async () => {
    const { impl, calls } = fetchReplying(200, account());
    const { ctx } = createTestContext();

    const result = await createRealDebridAccountCheck({ fetch: impl }).run(ctx);

    expect(result.status).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.real-debrid.com/rest/1.0/user');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe(
      `Bearer ${TEST_KEYS.realDebrid}`,
    );
  });

  it.each([401, 403])('fails when Real-Debrid answers %s', async (status) => {
    const { impl } = fetchReplying(status, { error: 'bad_token', error_code: 8 });
    const { ctx } = createTestContext();

    const result = await createRealDebridAccountCheck({ fetch: impl }).run(ctx);

    expect(result.status).toBe('error');
    expect(result.message).toBe(`Real-Debrid rejected the token (HTTP ${status})`);
  });

  it('warns on any other status', async () => {
    const { impl } = fetchReplying(503, 'unavailable');
    const { ctx } = createTestContext();

    expect((await createRealDebridAccountCheck({ fetch: impl }).run(ctx)).status).toBe('warning');
  });

  it('warns when Real-Debrid cannot be reached', async () => {
    const impl: FetchLike = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    const { ctx } = createTestContext();

    const result = await createRealDebridAccountCheck({ fetch: impl }).run(ctx);

    expect(result.status).toBe('warning');
    expect(result.message).toBe('Real-Debrid could not be reached');
  });

  it('never puts the token or the account data in the outcome', async () => {
    const { impl } = fetchReplying(200, account());
    const { ctx } = createTestContext();

    const result = await createRealDebridAccountCheck({ fetch: impl }).run(ctx);

    const text = JSON.stringify(result);
    expect(text).not.toContain(TEST_KEYS.realDebrid);
    expect(text).not.toContain('private-user');
    expect(text).not.toContain('private@example.com');
  });
});
