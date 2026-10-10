import { describe, expect, it } from 'vitest';

import { createStubFetch, createTestContext, TEST_KEYS } from '../doctor-context.testing';
import { evaluatePolicies, jellyfinPolicyCheck } from './jellyfin-policy.check';

const OFF_POLICY = {
  EnableVideoPlaybackTranscoding: false,
  EnableAudioPlaybackTranscoding: true,
  EnablePlaybackRemuxing: true,
};
const DEFAULT_POLICY = {
  EnableVideoPlaybackTranscoding: true,
  EnableAudioPlaybackTranscoding: true,
  EnablePlaybackRemuxing: true,
};

const user = (name: string, policy: Record<string, unknown> = OFF_POLICY) => ({
  Id: `id-${name}`,
  Name: name,
  Policy: { IsAdministrator: false, ...policy },
});

function jellyfinWith(users: unknown, status = 200) {
  const stub = createStubFetch();
  stub.on('GET', '/Users', { status, body: users });
  return stub;
}

describe('evaluatePolicies', () => {
  it('lists the users whose policy differs from the mode, with the keys', () => {
    const result = evaluatePolicies([user('Admin'), user('Friend', DEFAULT_POLICY)], 'off');

    expect(result.drifted).toEqual([
      { name: 'Friend', drifted: ['EnableVideoPlaybackTranscoding'] },
    ]);
  });

  it('expects video transcoding to be on in cpu and hardware modes', () => {
    const users = [user('Admin', DEFAULT_POLICY)];

    expect(evaluatePolicies(users, 'cpu').drifted).toEqual([]);
    expect(evaluatePolicies(users, 'hardware').drifted).toEqual([]);
    expect(evaluatePolicies(users, 'off').drifted).toHaveLength(1);
  });

  it('treats a user without policy as drifted in every key', () => {
    const result = evaluatePolicies([{ Id: '1', Name: 'Ghost' }], 'off');

    expect(result.drifted[0]?.drifted).toHaveLength(3);
  });
});

describe('jellyfinPolicyCheck', () => {
  const env = { JELLYFIN_API_KEY: TEST_KEYS.jellyfin };

  it('is ok when every user follows the policy of the mode', async () => {
    const { ctx } = createTestContext({
      env,
      stubs: { jellyfin: jellyfinWith([user('Admin'), user('Friend')]) },
    });

    expect(await jellyfinPolicyCheck.run(ctx)).toEqual({
      status: 'ok',
      message: '2 users follow the "off" playback policy',
    });
  });

  it('warns about a user created later with the default policy and names the fix', async () => {
    const stub = jellyfinWith([user('Admin'), user('Friend', DEFAULT_POLICY)]);
    const { ctx } = createTestContext({ env, stubs: { jellyfin: stub } });

    const outcome = await jellyfinPolicyCheck.run(ctx);

    expect(outcome).toEqual({
      status: 'warning',
      message: '1 user does not follow the "off" playback policy',
      details: ['Friend: EnableVideoPlaybackTranscoding=true'],
      suggestion: 'Run "moody-blues config transcoding off" to apply the policy to every user.',
    });
    expect(stub.writes()).toEqual([]);
    expect(stub.requests[0]?.headers.authorization).toContain(TEST_KEYS.jellyfin);
  });

  it('suggests the configured mode', async () => {
    const { ctx } = createTestContext({
      env,
      stubs: { jellyfin: jellyfinWith([user('Admin')]) },
    });
    ctx.provision.config.transcoding = 'cpu';

    const outcome = await jellyfinPolicyCheck.run(ctx);

    expect(outcome.status).toBe('warning');
    expect(outcome.suggestion).toBe(
      'Run "moody-blues config transcoding cpu" to apply the policy to every user.',
    );
  });

  it('caps the detail lines', async () => {
    const users = Array.from({ length: 12 }, (_, index) => user(`U${index}`, DEFAULT_POLICY));
    const { ctx } = createTestContext({ env, stubs: { jellyfin: jellyfinWith(users) } });

    const outcome = await jellyfinPolicyCheck.run(ctx);

    expect(outcome.message).toBe('12 users do not follow the "off" playback policy');
    expect(outcome.details).toHaveLength(11);
    expect(outcome.details?.at(-1)).toBe('and 2 more');
  });

  it('warns without leaking secrets when the users cannot be read', async () => {
    const { ctx } = createTestContext({
      env,
      stubs: { jellyfin: jellyfinWith({ message: 'boom' }, 500) },
    });

    const outcome = await jellyfinPolicyCheck.run(ctx);

    expect(outcome.status).toBe('warning');
    expect(outcome.message).toBe('The Jellyfin users could not be read');
    expect(JSON.stringify(outcome)).not.toContain(TEST_KEYS.jellyfin);
  });

  it('is skipped without the API key', async () => {
    const { ctx } = createTestContext();

    expect((await jellyfinPolicyCheck.run(ctx)).status).toBe('skipped');
  });

  it('is skipped when the Jellyfin container is not running', async () => {
    const { ctx } = createTestContext({ env, services: { jellyfin: { state: 'exited' } } });

    expect(await jellyfinPolicyCheck.run(ctx)).toEqual({
      status: 'skipped',
      message: 'The jellyfin container is not running (see the Containers check)',
    });
  });
});
