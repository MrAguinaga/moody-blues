import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createArrClient } from '../arr/arr.client';
import { ARR_KINDS, type ArrKind } from '../arr/arr.types';
import { createDefaultConfig } from '../config';
import { createLayout, type MbHomeLayout } from '../home';
import { HttpStatusError } from '../http/http.errors';
import { runPipeline } from '../pipeline/pipeline.runner';
import type { ContainerRuntime, ProvisionContext } from '../pipeline/pipeline.types';
import { createFakeServarr, type FakeServarr } from '../testing/fake-servarr';
import { applyMasterProfile } from './master-profile.apply';
import { buildProfilePlan } from './master-profile.plan';
import { createMasterProfileStep } from './master-profile.step';
import { MissingResourceError, type ProfilePlan } from './profile.types';

const API_KEYS: Record<ArrKind, string> = { sonarr: 'sonarr-key', radarr: 'radarr-key' };
const noSleep = async () => undefined;
const config = createDefaultConfig();
const [hd] = config.tiers;

function clientFor(kind: ArrKind, server: FakeServarr) {
  return createArrClient({
    kind,
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    fetch: server.fetch,
    sleep: noSleep,
    random: () => 0.5,
  });
}

function planFor(kind: ArrKind): ProfilePlan {
  return buildProfilePlan(hd!, config.languages, kind);
}

function apply(
  kind: ArrKind,
  server: FakeServarr,
  plan = planFor(kind),
  progress?: (m: string) => void,
) {
  return applyMasterProfile(clientFor(kind, server), plan, progress);
}

function profileScores(server: FakeServarr, name = 'Moody Blues'): Record<string, number> {
  const profile = server.state.qualityProfiles.find((candidate) => candidate.name === name);
  return Object.fromEntries(
    (profile?.formatItems as { name: string; score: number }[]).map((entry) => [
      entry.name,
      entry.score,
    ]),
  );
}

function sentWrites(server: FakeServarr, from = 0): string[] {
  return server
    .writes()
    .slice(from)
    .map((request) => `${request.method} ${request.path}`);
}

describe.each(ARR_KINDS)('applyMasterProfile (%s)', (kind) => {
  let server: FakeServarr;

  beforeEach(() => {
    server = createFakeServarr({ kind, apiKey: API_KEYS[kind] });
  });

  it('creates the eleven custom formats and the profile on the first run', async () => {
    const outcome = await apply(kind, server);

    expect(outcome.status).toBe('changed');
    expect(server.state.customFormats.map((format) => format.name)).toEqual([
      'Dual Latino',
      'Latino',
      'Original',
      'Castellano',
      '1080p',
      'Remux',
      'H.264',
      'Repack/Proper',
      'Subtítulos ajenos',
      'DV sin fallback HDR10',
      'AV1',
    ]);
    expect(profileScores(server)).toEqual({
      'Dual Latino': 4000,
      Latino: 3000,
      Original: 2000,
      Castellano: 1000,
      '1080p': 400,
      Remux: -300,
      'H.264': 150,
      'Repack/Proper': 5,
      'Subtítulos ajenos': -1500,
      'DV sin fallback HDR10': -10000,
      AV1: -10000,
    });
  });

  it('creates the custom formats before the profile', async () => {
    await apply(kind, server);

    const writes = sentWrites(server);
    expect(writes.slice(0, 11).every((write) => write === 'POST /api/v3/customformat')).toBe(true);
    expect(writes[11]).toBe('POST /api/v3/qualityprofile');
  });

  it('sends the specification fields as an array of name and value', async () => {
    await apply(kind, server);

    const original = server.state.customFormats.find((format) => format.name === 'Original');
    const [language] = original?.specifications as { fields: unknown }[];
    expect(language?.fields).toEqual([
      { name: 'value', value: -2 },
      { name: 'exceptLanguage', value: false },
    ]);
  });

  it('stores the cutoff as the HD group and keeps the planned quality order', async () => {
    await apply(kind, server);

    const profile = server.state.qualityProfiles.find(
      (candidate) => candidate.name === 'Moody Blues',
    );
    const items = profile?.items as { id?: number; name?: string; allowed: boolean }[];
    expect(items.find((item) => item.id === profile?.cutoff)).toMatchObject({
      name: 'HD',
      allowed: true,
    });
    expect(profile).toMatchObject({
      upgradeAllowed: true,
      minFormatScore: 0,
      cutoffFormatScore: 4400,
      minUpgradeFormatScore: 50,
    });
  });

  it('removes the factory profiles and leaves only the master profile', async () => {
    const outcome = await apply(kind, server);

    expect(server.state.qualityProfiles.map((profile) => profile.name)).toEqual(['Moody Blues']);
    expect(outcome.detail).toContain('removed 6 factory profiles');
    expect(server.count('DELETE')).toBe(6);
  });

  it('never deletes profiles with a name outside the factory list', async () => {
    const schema = await clientFor(kind, server).getQualityProfileSchema();
    server.state.qualityProfiles.push({ ...schema, id: 50, name: 'My Profile' });

    await apply(kind, server);

    expect(server.state.qualityProfiles.map((profile) => profile.name).sort()).toEqual([
      'Moody Blues',
      'My Profile',
    ]);
  });

  it('emits no write on the second run', async () => {
    await apply(kind, server);
    const before = server.writes().length;

    const outcome = await apply(kind, server);

    expect(outcome).toEqual({ status: 'unchanged' });
    expect(server.writes()).toHaveLength(before);
    expect(server.requests.at(-1)?.method).toBe('GET');
  });

  it('updates a profile stored with the previous quality tree and then stays quiet', async () => {
    const previous = planFor(kind);
    const encodes = /^(WEBRip|WEBDL|Bluray)-1080p$/;
    await apply(kind, server, {
      ...previous,
      cutoffGroupName: 'HD 1080p',
      cutoffFormatScore: 4000,
      layers: previous.layers.flatMap((layer) =>
        layer.groupName !== 'HD'
          ? [layer]
          : [
              ...layer.qualityNames
                .filter((name) => !encodes.test(name))
                .map((name) => ({ qualityNames: [name], allowed: true })),
              {
                groupName: 'HD 1080p',
                qualityNames: layer.qualityNames.filter((name) => encodes.test(name)),
                allowed: true,
              },
            ],
      ),
    });
    const before = server.writes().length;
    const profile = server.state.qualityProfiles[0]!;

    const outcome = await apply(kind, server);

    expect(outcome).toEqual({ status: 'changed', detail: 'updated profile Moody Blues' });
    expect(sentWrites(server, before)).toEqual([`PUT /api/v3/qualityprofile/${profile.id}`]);
    expect(server.state.qualityProfiles[0]).toMatchObject({ cutoffFormatScore: 4400 });
    expect(await apply(kind, server)).toEqual({ status: 'unchanged' });
    expect(server.writes()).toHaveLength(before + 1);
  });

  it('gives a foreign custom format a score of zero and keeps it untouched', async () => {
    await clientFor(kind, server).createCustomFormat({
      name: 'Foreign',
      includeCustomFormatWhenRenaming: false,
      specifications: [
        {
          name: 'Any',
          implementation: 'ReleaseTitleSpecification',
          negate: false,
          required: true,
          fields: [{ name: 'value', value: 'foreign' }],
        },
      ],
    });

    await apply(kind, server);
    const before = server.writes().length;
    await apply(kind, server);

    expect(profileScores(server).Foreign).toBe(0);
    expect(server.writes()).toHaveLength(before);
    expect(server.state.customFormats.find((format) => format.name === 'Foreign')).toBeDefined();
  });

  it('keeps the profile valid when a foreign custom format appears later', async () => {
    await apply(kind, server);
    await clientFor(kind, server).createCustomFormat({
      name: 'Late',
      includeCustomFormatWhenRenaming: false,
      specifications: [
        {
          name: 'Any',
          implementation: 'ReleaseTitleSpecification',
          negate: false,
          required: true,
          fields: [{ name: 'value', value: 'late' }],
        },
      ],
    });
    const before = server.writes().length;

    const outcome = await apply(kind, server);

    expect(outcome).toEqual({ status: 'unchanged' });
    expect(server.writes()).toHaveLength(before);
  });

  it('repairs a drifted custom format with a single update', async () => {
    await apply(kind, server);
    const before = server.writes().length;
    const drifted = structuredClone(server.state.customFormats[1]) as {
      id: number;
      specifications: { fields: { value: unknown }[] }[];
    };
    drifted.specifications[0]!.fields[0]!.value = 'something else';
    server.state.customFormats[1] = drifted;

    const outcome = await apply(kind, server);

    expect(outcome).toEqual({ status: 'changed', detail: 'updated custom formats Latino' });
    expect(sentWrites(server, before)).toEqual(['PUT /api/v3/customformat/2']);
  });

  it('repairs a drifted score with a single profile update', async () => {
    await apply(kind, server);
    const before = server.writes().length;
    const profile = server.state.qualityProfiles[0]!;
    (profile.formatItems as { score: number }[])[0]!.score = 1;

    const outcome = await apply(kind, server);

    expect(outcome).toEqual({ status: 'changed', detail: 'updated profile Moody Blues' });
    expect(sentWrites(server, before)).toEqual([`PUT /api/v3/qualityprofile/${profile.id}`]);
    expect(profileScores(server)['Dual Latino']).toBe(4000);
  });

  it('keeps a factory profile that is in use and reports it without failing', async () => {
    server = createFakeServarr({ kind, apiKey: API_KEYS[kind], profilesInUse: ['HD-1080p'] });

    const first = await apply(kind, server);
    const before = server.writes().length;
    const second = await apply(kind, server);

    expect(server.state.qualityProfiles.map((profile) => profile.name).sort()).toEqual([
      'HD-1080p',
      'Moody Blues',
    ]);
    expect(first.status).toBe('changed');
    expect(first.detail).toContain('kept factory profiles in use: HD-1080p');
    expect(second.status).toBe('unchanged');
    expect(second.detail).toBe('kept factory profiles in use: HD-1080p');
    expect(sentWrites(server, before)).toEqual(['DELETE /api/v3/qualityprofile/4']);
  });

  it('does not touch the factory profiles when the master profile cannot be built', async () => {
    const plan = { ...planFor(kind), cutoffGroupName: 'Missing group' };

    await expect(apply(kind, server, plan)).rejects.toBeInstanceOf(MissingResourceError);

    expect(server.state.qualityProfiles).toHaveLength(6);
    expect(server.count('DELETE')).toBe(0);
  });

  it('propagates deletion failures other than a profile in use', async () => {
    const client = clientFor(kind, server);
    client.deleteQualityProfile = async () => {
      throw new HttpStatusError('DELETE', 'http://x/qualityprofile/1', 500, 'boom');
    };

    await expect(applyMasterProfile(client, planFor(kind))).rejects.toMatchObject({ status: 500 });
  });

  it('reports unplanned qualities of the schema as disabled', async () => {
    const schema = await clientFor(kind, server).getQualityProfileSchema();
    expect(schema.items.length).toBeGreaterThan(0);
    const client = clientFor(kind, server);
    const original = client.getQualityProfileSchema;
    client.getQualityProfileSchema = async () => {
      const current = await original();
      current.items.push({ quality: { id: 900, name: 'Future' }, items: [], allowed: false });
      return current;
    };

    const outcome = await applyMasterProfile(client, planFor(kind));

    expect(outcome.detail).toContain('disabled unplanned qualities: Future');
  });

  it('reports progress for every phase', async () => {
    const messages: string[] = [];

    await apply(kind, server, planFor(kind), (message) => messages.push(message));

    expect(messages).toEqual([
      'Applying custom formats',
      'Applying quality profile Moody Blues',
      'Removing factory quality profiles',
    ]);
  });
});

describe('Radarr specifics', () => {
  it('stores the language Any in the profile', async () => {
    const server = createFakeServarr({ kind: 'radarr', apiKey: API_KEYS.radarr });

    await apply('radarr', server);

    expect(server.state.qualityProfiles[0]?.language).toEqual({ id: -1, name: 'Any' });
  });

  it('does not store a language in a Sonarr profile', async () => {
    const server = createFakeServarr({ kind: 'sonarr', apiKey: API_KEYS.sonarr });

    await apply('sonarr', server);

    expect(server.state.qualityProfiles[0]).not.toHaveProperty('language');
  });

  it('resolves the source options with the names of each application', async () => {
    const radarr = createFakeServarr({ kind: 'radarr', apiKey: API_KEYS.radarr });
    const sonarr = createFakeServarr({ kind: 'sonarr', apiKey: API_KEYS.sonarr });

    await apply('radarr', radarr);
    await apply('sonarr', sonarr);

    const sourceValues = (server: FakeServarr) => {
      const dolby = server.state.customFormats.find((f) => f.name === 'DV sin fallback HDR10');
      return (dolby?.specifications as { implementation: string; fields: { value: number }[] }[])
        .filter((spec) => spec.implementation === 'SourceSpecification')
        .map((spec) => spec.fields[0]?.value);
    };
    expect(sourceValues(radarr)).toEqual([7, 8]);
    expect(sourceValues(sonarr)).toEqual([3, 4]);
  });
});

describe('new custom format conditions', () => {
  const conditions = (server: FakeServarr, name: string) =>
    (
      server.state.customFormats.find((format) => format.name === name)?.specifications as {
        implementation: string;
        fields: { value: unknown }[];
      }[]
    ).map((spec) => [spec.implementation, spec.fields[0]?.value]);

  it('resolves the Remux and the resolution with the conditions of each application', async () => {
    const radarr = createFakeServarr({ kind: 'radarr', apiKey: API_KEYS.radarr });
    const sonarr = createFakeServarr({ kind: 'sonarr', apiKey: API_KEYS.sonarr });

    await apply('radarr', radarr);
    await apply('sonarr', sonarr);

    expect(conditions(radarr, 'Remux')).toEqual([['QualityModifierSpecification', 5]]);
    expect(conditions(sonarr, 'Remux')).toEqual([['SourceSpecification', 7]]);
    expect(conditions(radarr, '1080p')).toEqual([['ResolutionSpecification', 1080]]);
    expect(conditions(sonarr, '1080p')).toEqual([['ResolutionSpecification', 1080]]);
  });
});

describe('server rules enforced by the fake', () => {
  const specification = {
    name: 'Any',
    implementation: 'ReleaseTitleSpecification',
    negate: false,
    required: true,
    fields: [{ name: 'value', value: 'x' }],
  };

  it('rejects a duplicate name, a format without conditions and a field object', async () => {
    const server = createFakeServarr({ kind: 'radarr', apiKey: 'k' });
    const client = clientFor('radarr', server);
    const base = { name: 'One', includeCustomFormatWhenRenaming: false };
    await client.createCustomFormat({ ...base, specifications: [specification] });

    const duplicate = await client
      .createCustomFormat({ ...base, specifications: [specification] })
      .catch((error: unknown) => error);
    const empty = await client
      .createCustomFormat({
        name: 'Two',
        includeCustomFormatWhenRenaming: false,
        specifications: [],
      })
      .catch((error: unknown) => error);
    const objectFields = await client
      .createCustomFormat({
        name: 'Three',
        includeCustomFormatWhenRenaming: false,
        specifications: [{ ...specification, fields: { value: 'x' } as never }],
      })
      .catch((error: unknown) => error);

    expect((duplicate as HttpStatusError).validation[0]?.errorMessage).toBe('Must be unique.');
    expect((empty as HttpStatusError).validation[0]?.errorMessage).toContain('at least one');
    expect((objectFields as HttpStatusError).status).toBe(400);
  });

  it('rejects an unknown specification implementation', async () => {
    const server = createFakeServarr({ kind: 'sonarr', apiKey: 'k' });

    const error = await clientFor('sonarr', server)
      .createCustomFormat({
        name: 'Bad',
        includeCustomFormatWhenRenaming: false,
        specifications: [{ ...specification, implementation: 'Nope' }],
      })
      .catch((caught: unknown) => caught);

    expect((error as HttpStatusError).message).toContain(
      'not a valid specification implementation',
    );
  });

  it('rejects the schema skeleton of a profile without allowed qualities', async () => {
    const server = createFakeServarr({ kind: 'sonarr', apiKey: 'k' });
    const client = clientFor('sonarr', server);
    const skeleton = await client.getQualityProfileSchema();

    const error = await client
      .createQualityProfile({ ...skeleton, name: 'Skeleton' })
      .catch((caught: unknown) => caught);

    expect((error as HttpStatusError).status).toBe(400);
  });

  it('rejects a profile that omits an existing custom format', async () => {
    const server = createFakeServarr({ kind: 'sonarr', apiKey: 'k' });
    await apply('sonarr', server);
    const client = clientFor('sonarr', server);
    const profile = structuredClone(server.state.qualityProfiles[0]) as never as Parameters<
      typeof client.updateQualityProfile
    >[0];
    profile.formatItems.pop();

    const error = await client.updateQualityProfile(profile).catch((caught: unknown) => caught);

    expect((error as HttpStatusError).message).toContain('All Custom Formats');
  });
});

describe('master-profile step', () => {
  let sandbox: string;
  let layout: MbHomeLayout;
  let servers: Record<ArrKind, FakeServarr>;

  const fetchByOrigin = (url: string, init?: RequestInit) =>
    (url.startsWith('http://127.0.0.1:8989') ? servers.sonarr : servers.radarr).fetch(url, init);

  function context(overrides: Partial<ProvisionContext> = {}): ProvisionContext {
    return {
      config,
      secrets: { rdApiToken: 't', adminUsername: 'admin', adminPassword: 'password' },
      layout,
      identity: { puid: 1000, pgid: 1000 },
      runtime: {} as ContainerRuntime,
      flags: new Map(),
      cliVersion: '9.9.9',
      ...overrides,
    };
  }

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mb-profile-'));
    layout = createLayout(join(sandbox, 'home'));
    mkdirSync(layout.root, { recursive: true });
    writeFileSync(
      layout.envFile,
      [
        'SONARR_API_KEY=sonarr-key',
        'RADARR_API_KEY=radarr-key',
        'PROWLARR_API_KEY=prowlarr-key',
        'BAZARR_API_KEY=bazarr-key',
        'DECYPHARR_API_TOKEN=decypharr-token',
        'SEERR_API_KEY=seerr-key',
        '',
      ].join('\n'),
    );
    servers = {
      sonarr: createFakeServarr({ kind: 'sonarr', apiKey: 'sonarr-key' }),
      radarr: createFakeServarr({ kind: 'radarr', apiKey: 'radarr-key' }),
    };
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('applies the profile to Sonarr and Radarr and writes nothing on the second run', async () => {
    const step = createMasterProfileStep({ fetch: fetchByOrigin, sleep: noSleep });

    const first = await runPipeline([step], context(), { scope: 'setup' });
    const writes = servers.sonarr.writes().length + servers.radarr.writes().length;
    const second = await runPipeline([step], context(), { scope: 'setup' });

    expect(first.steps[0]).toMatchObject({ id: 'master-profile', status: 'changed' });
    expect(first.steps[0]?.detail).toContain('Sonarr: created 11 custom formats');
    expect(first.steps[0]?.detail).toContain('Radarr: created 11 custom formats');
    expect(second.steps[0]).toMatchObject({ id: 'master-profile', status: 'unchanged' });
    expect(servers.sonarr.writes().length + servers.radarr.writes().length).toBe(writes);
    for (const kind of ARR_KINDS) {
      expect(servers[kind].state.qualityProfiles.map((profile) => profile.name)).toEqual([
        'Moody Blues',
      ]);
    }
  });

  it('runs in every scope that provisions the services', () => {
    expect(createMasterProfileStep().scopes).toEqual(['setup', 'reset', 'config', 'update']);
  });

  it('prefixes the progress messages with the application name', async () => {
    const messages: string[] = [];
    const step = createMasterProfileStep({ fetch: fetchByOrigin, sleep: noSleep });

    await runPipeline([step], context(), {
      scope: 'setup',
      onEvent: (event) => {
        if (event.type === 'step-progress') messages.push(event.message);
      },
    });

    expect(messages).toContain('Sonarr: Applying custom formats');
    expect(messages).toContain('Radarr: Removing factory quality profiles');
  });

  it('fails the pipeline for a tier that is not supported yet', async () => {
    const step = createMasterProfileStep({ fetch: fetchByOrigin, sleep: noSleep });
    const uhd = { id: 'uhd', label: '4K', maxResolution: '2160p' };

    const report = await runPipeline(
      [step],
      context({ config: createDefaultConfig({ tiers: [uhd] }) }),
      { scope: 'setup' },
    );

    expect(report.success).toBe(false);
    expect(report.error).toContain('2160p');
    expect(servers.sonarr.writes()).toHaveLength(0);
  });

  it('fails when the environment file lacks the service keys', async () => {
    writeFileSync(layout.envFile, 'SONARR_API_KEY=sonarr-key\n');
    const step = createMasterProfileStep({ fetch: fetchByOrigin, sleep: noSleep });

    const report = await runPipeline([step], context(), { scope: 'setup' });

    expect(report.success).toBe(false);
    expect(report.error).toContain('Missing service keys');
  });
});
