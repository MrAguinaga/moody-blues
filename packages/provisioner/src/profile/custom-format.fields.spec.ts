import { describe, expect, it } from 'vitest';

import { createArrClient } from '../arr/arr.client';
import type { SpecificationSchemaResource } from '../arr/arr.types';
import { createFakeServarr } from '../testing/fake-servarr';
import { buildCodecFormats } from './codec-formats.profile';
import {
  customFormatMatches,
  resolveSpecificationFields,
  toApiFields,
  toCustomFormatResource,
} from './custom-format.fields';
import { buildLanguageFormats } from './language-formats.profile';
import { CustomFormatSchemaError } from './profile.types';

async function schemaFor(kind: 'sonarr' | 'radarr'): Promise<SpecificationSchemaResource[]> {
  const server = createFakeServarr({ kind, apiKey: 'key' });
  const client = createArrClient({
    kind,
    baseUrl: server.baseUrl,
    apiKey: 'key',
    fetch: server.fetch,
  });
  return client.getCustomFormatSchema();
}

const [original] = buildLanguageFormats(['original']);
const dualLatino = buildLanguageFormats(['es-419+original'])[0]!;

describe('toApiFields', () => {
  it('converts the object form used by community exports into the name/value array', () => {
    expect(toApiFields({ value: 7 })).toEqual([{ name: 'value', value: 7 }]);
  });

  it('keeps every entry of the object in order', () => {
    expect(toApiFields({ value: -2, exceptLanguage: false })).toEqual([
      { name: 'value', value: -2 },
      { name: 'exceptLanguage', value: false },
    ]);
  });
});

describe('resolveSpecificationFields', () => {
  it('resolves named options against the select options of the server schema', async () => {
    const schema = await schemaFor('radarr');
    const [webDl] = buildCodecFormats('radarr')[2]!.format.specifications.filter(
      (specification) => specification.implementation === 'SourceSpecification',
    );

    expect(resolveSpecificationFields(webDl!, schema)).toEqual({ value: 7 });
  });

  it('resolves the source options with the names of the target application', async () => {
    const schema = await schemaFor('sonarr');
    const sources = buildCodecFormats('sonarr')[2]!.format.specifications.filter(
      (specification) => specification.implementation === 'SourceSpecification',
    );

    expect(sources.map((source) => resolveSpecificationFields(source, schema).value)).toEqual([
      3, 4,
    ]);
  });

  it('fails when the schema does not offer the named option', async () => {
    const schema = await schemaFor('sonarr');
    const [webDl] = buildCodecFormats('radarr')[2]!.format.specifications.filter(
      (specification) => specification.implementation === 'SourceSpecification',
    );

    expect(() => resolveSpecificationFields(webDl!, schema)).toThrow(CustomFormatSchemaError);
  });

  it('fails when the server does not know the implementation', () => {
    expect(() => resolveSpecificationFields(dualLatino.format.specifications[0]!, [])).toThrow(
      /ReleaseTitleSpecification/,
    );
  });
});

describe('toCustomFormatResource', () => {
  it('always sends both fields of a language specification as an array', async () => {
    const resource = toCustomFormatResource(original!.format, await schemaFor('radarr'));

    expect(resource.specifications[0]).toMatchObject({
      implementation: 'LanguageSpecification',
      required: true,
      negate: false,
      fields: [
        { name: 'value', value: -2 },
        { name: 'exceptLanguage', value: false },
      ],
    });
    expect(Array.isArray(resource.specifications[0]?.fields)).toBe(true);
  });

  it('builds a resource without an id so it can be created or updated', async () => {
    const resource = toCustomFormatResource(dualLatino.format, await schemaFor('sonarr'));

    expect(resource).toMatchObject({ name: 'Dual Latino', includeCustomFormatWhenRenaming: true });
    expect(resource).not.toHaveProperty('id');
  });
});

describe('customFormatMatches', () => {
  it('ignores server decoration and the id', async () => {
    const desired = toCustomFormatResource(dualLatino.format, await schemaFor('radarr'));
    const stored = {
      ...structuredClone(desired),
      id: 4,
      specifications: desired.specifications.map((specification) => ({
        ...specification,
        id: 0,
        implementationName: 'Release Title',
        fields: specification.fields.map((field) => ({ ...field, label: 'Regex' })),
      })),
    };

    expect(customFormatMatches(stored, desired)).toBe(true);
  });

  it.each([
    [
      'a regular expression',
      (resource: any) => {
        resource.specifications[0].fields[0].value = 'other';
      },
    ],
    [
      'the negation flag',
      (resource: any) => {
        resource.specifications[1].negate = true;
      },
    ],
    [
      'the renaming flag',
      (resource: any) => {
        resource.includeCustomFormatWhenRenaming = false;
      },
    ],
    [
      'a missing specification',
      (resource: any) => {
        resource.specifications.pop();
      },
    ],
  ])('detects a difference in %s', async (_label, mutate) => {
    const desired = toCustomFormatResource(dualLatino.format, await schemaFor('radarr'));
    const stored = structuredClone(desired);
    mutate(stored);

    expect(customFormatMatches(stored, desired)).toBe(false);
  });
});
