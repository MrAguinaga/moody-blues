import { describe, expect, it } from 'vitest';

import {
  applyFieldValues,
  fieldsMatch,
  type ProviderResource,
  UnknownProviderFieldError,
} from './provider-fields';

function schemaItem(): ProviderResource {
  return {
    name: '',
    implementation: 'QBittorrent',
    fields: [
      { name: 'host', value: 'localhost', type: 'textbox' },
      { name: 'port', value: 8080, type: 'textbox' },
      { name: 'urlBase', value: null, type: 'textbox' },
    ],
  };
}

describe('applyFieldValues', () => {
  it('sets values by name on a clone and keeps the other field attributes', () => {
    const template = schemaItem();

    const result = applyFieldValues(template, { host: 'decypharr', urlBase: '' });

    expect(result.fields).toEqual([
      { name: 'host', value: 'decypharr', type: 'textbox' },
      { name: 'port', value: 8080, type: 'textbox' },
      { name: 'urlBase', value: '', type: 'textbox' },
    ]);
    expect(template.fields[0]?.value).toBe('localhost');
  });

  it('rejects an unknown field name with a typed error', () => {
    expect(() => applyFieldValues(schemaItem(), { missing: 1 })).toThrow(UnknownProviderFieldError);
    expect(() => applyFieldValues(schemaItem(), { missing: 1 })).toThrow(/"missing"/);
  });
});

describe('fieldsMatch', () => {
  const existing = applyFieldValues(schemaItem(), { host: 'decypharr', port: 8282 });

  it('compares only the desired fields', () => {
    expect(fieldsMatch(existing, { host: 'decypharr' })).toBe(true);
    expect(fieldsMatch(existing, { host: 'decypharr', port: 8282 })).toBe(true);
  });

  it('detects differing values and absent fields', () => {
    expect(fieldsMatch(existing, { port: 9999 })).toBe(false);
    expect(fieldsMatch(existing, { unknown: 'x' })).toBe(false);
  });

  it('distinguishes an empty string from null', () => {
    expect(fieldsMatch(existing, { urlBase: '' })).toBe(false);
    expect(fieldsMatch(existing, { urlBase: null })).toBe(true);
  });
});
