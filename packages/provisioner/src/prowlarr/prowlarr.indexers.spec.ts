import { describe, expect, it } from 'vitest';

import { MIN_SEEDERS, PROWLARR_INDEXERS } from './prowlarr.indexers';

const names = PROWLARR_INDEXERS.map((entry) => entry.definitionName);

describe('PROWLARR_INDEXERS', () => {
  it('lists the 19 public definitions without duplicates', () => {
    expect(names).toHaveLength(19);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps the exact case of the definition names', () => {
    expect(names).toContain('Knaben');
    expect(names).toContain('SubsPlease');
    expect(names).not.toContain('knaben');
    expect(names).not.toContain('subsplease');
  });

  it('excludes adult and unresponsive definitions', () => {
    for (const excluded of ['ehentai', '52bt', 'Anidex', 'tokyotosho', 'magnetcat']) {
      expect(names).not.toContain(excluded);
    }
  });

  it('keeps 1337x and EZTV in the catalog', () => {
    expect(names).toEqual(expect.arrayContaining(['1337x', 'eztv']));
  });

  it('uses the shared minimum seeders', () => {
    expect(PROWLARR_INDEXERS.every((entry) => entry.minimumSeeders === MIN_SEEDERS)).toBe(true);
  });
});
