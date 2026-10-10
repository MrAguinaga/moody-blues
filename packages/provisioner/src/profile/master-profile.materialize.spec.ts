import { describe, expect, it } from 'vitest';

import { createArrClient } from '../arr/arr.client';
import {
  ARR_KINDS,
  type ArrKind,
  type CustomFormatResource,
  type QualityProfileItemResource,
  type QualityProfileResource,
} from '../arr/arr.types';
import { createDefaultConfig } from '../config';
import { createFakeServarr } from '../testing/fake-servarr';
import {
  findUnplannedQualities,
  materializeProfile,
  profilesEquivalent,
} from './master-profile.materialize';
import { buildProfilePlan } from './master-profile.plan';
import { MissingResourceError, QualityNotFoundError } from './profile.types';

const [hd] = createDefaultConfig().tiers;
const LANGUAGE_IDS = { Any: -1, Original: -2 };
const EXPECTED_QUALITY_COUNT: Record<ArrKind, number> = { radarr: 30, sonarr: 22 };

async function load(kind: ArrKind) {
  const server = createFakeServarr({ kind, apiKey: 'key' });
  const client = createArrClient({
    kind,
    baseUrl: server.baseUrl,
    apiKey: 'key',
    fetch: server.fetch,
  });
  const schema = await client.getQualityProfileSchema();
  const plan = buildProfilePlan(hd!, { audioPriority: ['es-419+original', 'es-419'] }, kind);
  const formats: CustomFormatResource[] = [
    ...plan.formats.map(({ format }, index) => ({
      id: index + 1,
      name: format.name,
      includeCustomFormatWhenRenaming: false,
      specifications: [],
    })),
    { id: 99, name: 'Foreign', includeCustomFormatWhenRenaming: false, specifications: [] },
  ];
  return { schema, plan, formats };
}

function qualityNames(items: QualityProfileItemResource[]): string[] {
  return items.flatMap((item) => (item.quality ? [item.quality.name] : qualityNames(item.items)));
}

describe.each(ARR_KINDS)('materializeProfile (%s)', (kind) => {
  it('places every quality of the schema exactly once', async () => {
    const { schema, plan, formats } = await load(kind);

    const profile = materializeProfile(plan, schema, formats, LANGUAGE_IDS);
    const names = qualityNames(profile.items);

    expect(names).toHaveLength(EXPECTED_QUALITY_COUNT[kind]);
    expect(new Set(names)).toEqual(new Set(qualityNames(schema.items)));
  });

  it('starts with the worst quality and disabled Unknown', async () => {
    const { schema, plan, formats } = await load(kind);

    const [first] = materializeProfile(plan, schema, formats, LANGUAGE_IDS).items;

    expect(first).toMatchObject({ quality: { name: 'Unknown' }, allowed: false });
  });

  it('merges the WEB 720p and WEB 1080p groups into one HD group and cuts off at it', async () => {
    const { schema, plan, formats } = await load(kind);

    const profile = materializeProfile(plan, schema, formats, LANGUAGE_IDS);
    const groups = profile.items.filter((item) => !item.quality);
    const hdGroup = groups.find((group) => group.name === 'HD');

    expect(groups.map((group) => group.name)).toEqual(['WEB 480p', 'HD', 'WEB 2160p']);
    expect(hdGroup).toMatchObject({ id: 1004, allowed: true });
    expect(hdGroup?.items.map((item) => item.quality?.name).sort()).toEqual(
      [
        'HDTV-720p',
        'WEBDL-720p',
        'WEBRip-720p',
        'Bluray-720p',
        'HDTV-1080p',
        kind === 'radarr' ? 'Remux-1080p' : 'Bluray-1080p Remux',
        'WEBRip-1080p',
        'WEBDL-1080p',
        'Bluray-1080p',
      ].sort(),
    );
    expect(profile.cutoff).toBe(1004);
  });

  it('keeps the SD qualities enabled below the HD group', async () => {
    const { schema, plan, formats } = await load(kind);

    const names = materializeProfile(plan, schema, formats, LANGUAGE_IDS).items.map(
      (item) => item.quality?.name ?? item.name,
    );
    const sd = names.filter((name) => /^(SDTV|DVD|Bluray-480p|Bluray-576p)$/.test(String(name)));

    expect(sd.length).toBeGreaterThanOrEqual(4);
    for (const name of sd) {
      expect(names.indexOf(name)).toBeLessThan(names.indexOf('HD'));
    }
  });

  it('builds valid groups with unique identifiers and unnamed single qualities', async () => {
    const { schema, plan, formats } = await load(kind);

    const profile = materializeProfile(plan, schema, formats, LANGUAGE_IDS);
    const groups = profile.items.filter((item) => !item.quality);

    expect(new Set(groups.map((group) => group.id)).size).toBe(groups.length);
    expect(groups.every((group) => (group.id ?? 0) > 0 && group.items.length >= 2)).toBe(true);
    expect(profile.items.filter((item) => item.quality).every((item) => !item.name)).toBe(true);
  });

  it('makes the cutoff an allowed group', async () => {
    const { schema, plan, formats } = await load(kind);

    const profile = materializeProfile(plan, schema, formats, LANGUAGE_IDS);

    expect(profile.items.find((item) => item.id === profile.cutoff)?.allowed).toBe(true);
  });

  it('disables 2160p, BR-DISK, Raw-HD and Workprint', async () => {
    const { schema, plan, formats } = await load(kind);

    const profile = materializeProfile(plan, schema, formats, LANGUAGE_IDS);
    const enabled = qualityNames(profile.items.filter((item) => item.allowed));

    expect(enabled.filter((name) => /2160p|BR-DISK|Raw-HD|WORKPRINT|Unknown/.test(name))).toEqual(
      [],
    );
    expect(enabled).toContain('Bluray-1080p');
  });

  it('lists every existing custom format with the planned score or zero', async () => {
    const { schema, plan, formats } = await load(kind);

    const profile = materializeProfile(plan, schema, formats, LANGUAGE_IDS);
    const scores = Object.fromEntries(
      profile.formatItems.map((entry) => [entry.name, entry.score]),
    );

    expect(profile.formatItems).toHaveLength(formats.length);
    expect(scores).toMatchObject({ 'Dual Latino': 2000, Latino: 1000, AV1: -10000, Foreign: 0 });
    expect(profile.formatItems.find((entry) => entry.name === 'Foreign')?.format).toBe(99);
  });

  it('sets the language Any only in Radarr', async () => {
    const { schema, plan, formats } = await load(kind);

    const profile = materializeProfile(plan, schema, formats, LANGUAGE_IDS);

    if (kind === 'radarr') {
      expect(profile.language).toEqual({ id: -1, name: 'Any' });
    } else {
      expect(profile).not.toHaveProperty('language');
    }
  });

  it('reuses the group identifiers and profile id of an existing profile', async () => {
    const { schema, plan, formats } = await load(kind);
    const first = materializeProfile(plan, schema, formats, LANGUAGE_IDS);
    const existing: QualityProfileResource = {
      ...first,
      id: 7,
      items: first.items.map((item) => (item.name === 'HD' ? { ...item, id: 2500 } : item)),
      cutoff: 2500,
    };

    const again = materializeProfile(plan, schema, formats, LANGUAGE_IDS, existing);

    expect(again.id).toBe(7);
    expect(again.cutoff).toBe(2500);
    expect(profilesEquivalent(existing, again)).toBe(true);
  });

  it('appends qualities the plan does not mention as disabled', async () => {
    const { schema, plan, formats } = await load(kind);
    schema.items.push({
      quality: { id: 900, name: 'Future-Quality' },
      items: [],
      allowed: false,
    });

    const profile = materializeProfile(plan, schema, formats, LANGUAGE_IDS);

    expect(findUnplannedQualities(plan, schema)).toEqual(['Future-Quality']);
    expect(profile.items.at(-1)).toMatchObject({
      quality: { name: 'Future-Quality' },
      allowed: false,
    });
  });

  it('fails with a typed error when the schema lacks a planned quality', async () => {
    const { schema, plan, formats } = await load(kind);
    schema.items = schema.items.filter((item) => item.quality?.name !== 'HDTV-1080p');

    expect(() => materializeProfile(plan, schema, formats, LANGUAGE_IDS)).toThrow(
      QualityNotFoundError,
    );
  });

  it('fails when a planned custom format does not exist yet', async () => {
    const { schema, plan, formats } = await load(kind);

    expect(() => materializeProfile(plan, schema, formats.slice(0, 2), LANGUAGE_IDS)).toThrow(
      MissingResourceError,
    );
  });
});

describe('materializeProfile language resolution', () => {
  it('fails when Radarr does not offer the Any language', async () => {
    const { schema, plan, formats } = await load('radarr');

    expect(() => materializeProfile(plan, schema, formats, { Original: -2 })).toThrow(
      MissingResourceError,
    );
  });
});

describe.each(ARR_KINDS)('profile stored with the previous quality tree (%s)', (kind) => {
  const ENCODES_1080P = /^(WEBRip|WEBDL|Bluray)-1080p$/;

  async function stored() {
    const { schema, plan, formats } = await load(kind);
    const previousLayers = plan.layers.flatMap((layer) => {
      if (layer.groupName !== 'HD') {
        return [layer];
      }
      const encodes = layer.qualityNames.filter((name) => ENCODES_1080P.test(name));
      return [
        ...layer.qualityNames
          .filter((name) => !ENCODES_1080P.test(name))
          .map((name) => ({ qualityNames: [name], allowed: true })),
        { groupName: 'HD 1080p', qualityNames: encodes, allowed: true },
      ];
    });
    const previous = materializeProfile(
      { ...plan, cutoffGroupName: 'HD 1080p', cutoffFormatScore: 4000, layers: previousLayers },
      schema,
      formats,
      LANGUAGE_IDS,
    );
    return { schema, plan, formats, existing: { ...previous, id: 7 } };
  }

  it('is not equivalent to the new profile', async () => {
    const { schema, plan, formats, existing } = await stored();

    const desired = materializeProfile(plan, schema, formats, LANGUAGE_IDS, existing);

    expect(profilesEquivalent(existing, desired)).toBe(false);
  });

  it('is rebuilt on the same profile id with the HD cutoff and the new cutoff score', async () => {
    const { schema, plan, formats, existing } = await stored();

    const desired = materializeProfile(plan, schema, formats, LANGUAGE_IDS, existing);

    expect(desired.id).toBe(7);
    expect(desired.cutoffFormatScore).toBe(plan.cutoffFormatScore);
    expect(desired.items.filter((item) => !item.quality).map((item) => item.name)).toEqual([
      'WEB 480p',
      'HD',
      'WEB 2160p',
    ]);
    expect(desired.items.find((item) => item.id === desired.cutoff)?.name).toBe('HD');
    expect(
      profilesEquivalent(desired, materializeProfile(plan, schema, formats, LANGUAGE_IDS, desired)),
    ).toBe(true);
  });
});

describe('profilesEquivalent', () => {
  async function built() {
    const { schema, plan, formats } = await load('radarr');
    return materializeProfile(plan, schema, formats, LANGUAGE_IDS);
  }

  it('ignores ids of the profile and zero scores of other formats', async () => {
    const profile = await built();
    const stored = structuredClone({ ...profile, id: 3 });
    stored.formatItems.push({ format: 120, name: 'Another', score: 0 });

    expect(profilesEquivalent(stored, profile)).toBe(true);
  });

  it.each([
    ['a score', (profile: any) => (profile.formatItems[0].score += 1)],
    ['a threshold', (profile: any) => (profile.minUpgradeFormatScore = 1)],
    ['an allowed flag', (profile: any) => (profile.items[2].allowed = false)],
    ['the item order', (profile: any) => profile.items.reverse()],
    ['the cutoff', (profile: any) => (profile.cutoff = 6)],
    ['the language', (profile: any) => (profile.language = { id: -2, name: 'Original' })],
  ])('detects a difference in %s', async (_label, mutate) => {
    const profile = await built();
    const stored = structuredClone(profile);
    mutate(stored);

    expect(profilesEquivalent(stored, profile)).toBe(false);
  });

  it('treats the order of the members inside a group as irrelevant', async () => {
    const profile = await built();
    const stored = structuredClone(profile);
    stored.items.find((item) => item.name === 'HD')?.items.reverse();

    expect(profilesEquivalent(stored, profile)).toBe(true);
  });
});
