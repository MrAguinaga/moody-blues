import { describe, expect, it } from 'vitest';

import { HttpStatusError } from '../http/http.errors';
import { createFakeJellyfin, type FakeJellyfinOptions } from '../testing/fake-jellyfin';
import { createJellyfinClient } from './jellyfin.client';
import { JELLYFIN_LIBRARIES } from './jellyfin.constants';
import { buildLibraryOptions } from './jellyfin.settings';

const noSleep = async () => undefined;
const CREDENTIALS = { username: 'Admin', password: 'p@ss word' };
const MOVIES = JELLYFIN_LIBRARIES[0]!;

function setup(options: FakeJellyfinOptions = {}) {
  const fake = createFakeJellyfin(options);
  const client = createJellyfinClient({
    baseUrl: fake.baseUrl,
    fetch: fake.fetch,
    sleep: noSleep,
    random: () => 0.5,
  });
  return { fake, client };
}

describe('createJellyfinClient', () => {
  it('sends the MediaBrowser header with the four client fields and never the legacy ones', async () => {
    const { fake, client } = setup({ wizardCompleted: true });

    await client.getPublicInfo();
    await client.authenticate(CREDENTIALS);

    for (const request of fake.requests) {
      expect(request.headers.authorization).toMatch(
        /^MediaBrowser Client="moody-blues", Device="provisioner", DeviceId="moody-blues-provisioner", Version="1\.0\.0"/,
      );
      expect(request.headers).not.toHaveProperty('x-emby-authorization');
      expect(request.headers).not.toHaveProperty('x-emby-token');
      expect(request.query).not.toHaveProperty('api_key');
    }
  });

  it('adds the token only after authenticating or choosing one', async () => {
    const { fake, client } = setup({ wizardCompleted: true });

    await client.getPublicInfo();
    const token = await client.authenticate(CREDENTIALS);
    await client.listApiKeys();
    await client.logout();

    const tokens = fake.requests.map((request) =>
      request.headers.authorization?.includes('Token='),
    );
    expect(tokens).toEqual([false, false, true, true]);
    await expect(client.listApiKeys()).rejects.toMatchObject({ status: 401 });
    expect(token).toBe('fake-session-1');
  });

  it('reuses the same device id so sign-ins replace the previous session', async () => {
    const { fake, client } = setup({ wizardCompleted: true });

    await client.authenticate(CREDENTIALS);
    await client.authenticate(CREDENTIALS);

    expect(fake.state.sessions.size).toBe(1);
  });

  it('tries the sign-in once and surfaces a rejected login as 401', async () => {
    const { fake, client } = setup({ wizardCompleted: true });

    await expect(
      client.authenticate({ username: 'Admin', password: 'nope' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fake.count('POST', '/Users/AuthenticateByName')).toBe(1);
    expect(fake.state.failedLogins).toBe(1);
  });

  it('waits for the public info endpoint through the 503 window', async () => {
    const { fake, client } = setup({ readyAfterFailures: 2 });

    await client.waitReady({ sleep: noSleep });

    expect(fake.count('GET', '/System/Info/Public')).toBe(4);
  });

  it('does not take the bootstrap host answer for a ready server', async () => {
    const { fake, client } = setup({ bootstrapResponses: 2, readyAfterFailures: 1 });

    await client.waitReady({ sleep: noSleep });

    expect(await client.getPublicInfo()).toMatchObject({ StartupWizardCompleted: false });
    expect(fake.count('GET', '/Startup/User')).toBe(0);
  });

  it('runs the startup wizard in order and treats a second user write as a 403', async () => {
    const { fake, client } = setup();

    await expect(client.setFirstUser('Admin', 'secret')).rejects.toMatchObject({ status: 404 });
    expect(await client.getFirstUser()).toEqual({ Name: 'MyJellyfinUser' });
    await client.setFirstUser('Admin', 'secret');
    await expect(client.setFirstUser('Admin', 'secret')).rejects.toMatchObject({ status: 403 });
    await client.completeStartup();

    expect((await client.getPublicInfo()).StartupWizardCompleted).toBe(true);
    expect(fake.canLogin('Admin', 'secret')).toBe(true);
    await expect(client.getFirstUser()).rejects.toBeInstanceOf(HttpStatusError);
  });

  it('refuses an empty first password', async () => {
    const { client } = setup();
    await client.getFirstUser();

    await expect(client.setFirstUser('Admin', '')).rejects.toMatchObject({ status: 400 });
  });

  it('creates an API key whether the server answers 204 or a JSON body', async () => {
    for (const apiKeyReply of ['empty', 'json'] as const) {
      const { client } = setup({ wizardCompleted: true, apiKeyReply });
      await client.authenticate(CREDENTIALS);

      await client.createApiKey('moody-blues');

      const keys = await client.listApiKeys();
      expect(keys.map((key) => key.AppName)).toEqual(['moody-blues']);
    }
  });

  it('finds users by name ignoring case and changes a password with only the new one', async () => {
    const { fake, client } = setup({ wizardCompleted: true });
    await client.authenticate(CREDENTIALS);

    const user = await client.findUserByName('ADMIN');
    expect(user?.Name).toBe('Admin');
    expect(await client.findUserByName('ghost')).toBeUndefined();

    await client.setPassword(user!.Id, 'fresh-secret');
    expect(fake.canLogin('Admin', 'fresh-secret')).toBe(true);
    expect(fake.requests.at(-1)?.body).toEqual({ NewPw: 'fresh-secret' });
    expect(fake.requests.at(-1)?.query).toEqual({ userId: user!.Id });
  });

  it('replaces the whole server and encoding configuration objects', async () => {
    const { fake, client } = setup({ wizardCompleted: true });
    await client.authenticate(CREDENTIALS);

    const config = await client.getServerConfiguration();
    await client.saveServerConfiguration({ ...config, ServerName: 'Moody Blues' });
    const encoding = await client.getNamedConfiguration('encoding');
    await client.saveNamedConfiguration('encoding', { ...encoding, SegmentKeepSeconds: 300 });

    expect(fake.state.config).toEqual({ ...config, ServerName: 'Moody Blues' });
    expect(fake.state.encoding).toMatchObject({ SegmentKeepSeconds: 300, EnableThrottling: false });
  });

  it('creates libraries with the path and collection type in the query and options in the body', async () => {
    const { fake, client } = setup({ wizardCompleted: true });
    await client.authenticate(CREDENTIALS);

    await client.createLibrary(MOVIES, buildLibraryOptions(MOVIES, { language: 'es' }));

    const request = fake.requests.at(-1);
    expect(request?.query).toEqual({
      name: 'Películas',
      collectionType: 'movies',
      paths: '/data/media/movies',
      refreshLibrary: 'false',
    });
    expect(request?.body).toHaveProperty('LibraryOptions.PathInfos');
    expect((await client.listLibraries()).map((library) => library.Name)).toEqual(['Películas']);
  });

  it('explains a library rejected because its path is missing in the container', async () => {
    const { client } = setup({ wizardCompleted: true, existingPaths: [] });
    await client.authenticate(CREDENTIALS);

    await expect(
      client.createLibrary(MOVIES, buildLibraryOptions(MOVIES, { language: 'es' })),
    ).rejects.toThrow(/\/data\/media\/movies exists inside the container/);
  });

  it('replaces library options by id and answers 404 for an unknown id', async () => {
    const { fake, client } = setup({ wizardCompleted: true });
    await client.authenticate(CREDENTIALS);
    const options = buildLibraryOptions(MOVIES, { language: 'es' });
    await client.createLibrary(MOVIES, options);
    const [library] = await client.listLibraries();

    await client.updateLibraryOptions(library!.ItemId, { ...options, Enabled: false });

    expect(fake.state.libraries[0]?.LibraryOptions.Enabled).toBe(false);
    await expect(client.updateLibraryOptions('missing', options)).rejects.toMatchObject({
      status: 404,
    });
  });
  describe('user policy', () => {
    it('lists every user with the complete policy', async () => {
      const { client } = setup({
        wizardCompleted: true,
        extraUsers: [{ name: 'Friend', policy: { EnableVideoPlaybackTranscoding: false } }],
      });
      await client.authenticate(CREDENTIALS);

      const users = await client.listUsers();

      expect(users.map((user) => user.Name)).toEqual(['Admin', 'Friend']);
      expect(users[1]?.Policy).toMatchObject({
        EnableVideoPlaybackTranscoding: false,
        AuthenticationProviderId: expect.stringContaining('DefaultAuthenticationProvider'),
      });
    });

    it('replaces the policy of the user in the path', async () => {
      const { fake, client } = setup({ wizardCompleted: true, extraUsers: [{ name: 'Friend' }] });
      await client.authenticate(CREDENTIALS);
      const [, friend] = await client.listUsers();

      await client.updateUserPolicy(friend!.Id, {
        ...friend!.Policy,
        EnableVideoPlaybackTranscoding: false,
      });

      const request = fake.requests.at(-1);
      expect(request).toMatchObject({ method: 'POST', path: `/Users/${friend!.Id}/Policy` });
      expect(fake.state.users[1]?.policy.EnableVideoPlaybackTranscoding).toBe(false);
    });

    it('rejects a policy without the provider ids with a 400', async () => {
      const { client } = setup({ wizardCompleted: true });
      await client.authenticate(CREDENTIALS);
      const [admin] = await client.listUsers();
      const incomplete = { ...admin!.Policy, AuthenticationProviderId: undefined };

      await expect(client.updateUserPolicy(admin!.Id, incomplete)).rejects.toMatchObject({
        status: 400,
      });
    });

    it('refuses to demote the last administrator and answers 404 for an unknown user', async () => {
      const { client } = setup({ wizardCompleted: true });
      await client.authenticate(CREDENTIALS);
      const [admin] = await client.listUsers();

      await expect(
        client.updateUserPolicy(admin!.Id, { ...admin!.Policy, IsAdministrator: false }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(client.updateUserPolicy('missing', admin!.Policy!)).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});
