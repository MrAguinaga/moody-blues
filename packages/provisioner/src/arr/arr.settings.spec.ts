import { describe, expect, it } from 'vitest';

import {
  buildDecypharrClient,
  buildDownloadClientConfigSettings,
  buildIndexerSettings,
  buildMediaManagementSettings,
  buildNamingSettings,
  buildUiSettings,
  resolveUiLanguageId,
  ROOT_FOLDER_PATHS,
  uiLanguageName,
} from './arr.settings';
import { ARR_KINDS } from './arr.types';

describe('disk safeguards (ADR-014)', () => {
  it('skips the free space check and keeps an empty recycle bin', () => {
    const settings = buildMediaManagementSettings();

    expect(settings.skipFreeSpaceCheckWhenImporting).toBe(true);
    expect(settings.recycleBin).toBe('');
  });

  it('keeps the other media management values chosen for FUSE-backed storage', () => {
    expect(buildMediaManagementSettings()).toMatchObject({
      downloadPropersAndRepacks: 'doNotPrefer',
      rescanAfterRefresh: 'afterManual',
      copyUsingHardlinks: true,
      enableMediaInfo: true,
    });
  });
});

describe('buildDecypharrClient', () => {
  it('describes the Sonarr client with explicit tv category and its own address', () => {
    const { properties, fields } = buildDecypharrClient('sonarr', 'sonarr-key');

    expect(properties).toEqual({
      name: 'Decypharr',
      implementation: 'QBittorrent',
      configContract: 'QBittorrentSettings',
      enable: true,
      protocol: 'torrent',
      priority: 1,
      removeCompletedDownloads: true,
      removeFailedDownloads: false,
      tags: [],
    });
    expect(fields).toMatchObject({
      host: 'decypharr',
      port: 8282,
      useSsl: false,
      urlBase: '',
      apiKey: '',
      username: 'http://sonarr:8989',
      password: 'sonarr-key',
      tvCategory: 'sonarr',
      tvImportedCategory: '',
    });
    expect(fields).not.toHaveProperty('movieCategory');
  });

  it('describes the Radarr client with explicit movie category', () => {
    const { fields } = buildDecypharrClient('radarr', 'radarr-key');

    expect(fields).toMatchObject({
      username: 'http://radarr:7878',
      password: 'radarr-key',
      movieCategory: 'radarr',
      movieImportedCategory: '',
    });
    expect(fields).not.toHaveProperty('tvCategory');
  });

  it.each(ARR_KINDS)('leaves the api key empty next to username and password in %s', (kind) => {
    const { fields } = buildDecypharrClient(kind, 'key');

    expect(fields.apiKey).toBe('');
    expect(fields.username).toBeTruthy();
    expect(fields.password).toBeTruthy();
  });

  it.each(ARR_KINDS)('uses a username without trailing slash in %s', (kind) => {
    expect(String(buildDecypharrClient(kind, 'key').fields.username).endsWith('/')).toBe(false);
  });

  it.each(ARR_KINDS)('never compares the write-only password in %s', (kind) => {
    const { comparableFields } = buildDecypharrClient(kind, 'key');

    expect(comparableFields).not.toHaveProperty('password');
  });

  it.each(ARR_KINDS)('never removes failed downloads in %s', (kind) => {
    expect(buildDecypharrClient(kind, 'key').properties.removeFailedDownloads).toBe(false);
  });
});

describe('buildDownloadClientConfigSettings', () => {
  it('adds the finished download interval only for Radarr', () => {
    expect(buildDownloadClientConfigSettings('sonarr')).toEqual({
      enableCompletedDownloadHandling: true,
      autoRedownloadFailed: true,
      autoRedownloadFailedFromInteractiveSearch: true,
    });
    expect(buildDownloadClientConfigSettings('radarr')).toMatchObject({
      checkForFinishedDownloadInterval: 1,
    });
  });
});

describe('buildNamingSettings', () => {
  it('keeps custom formats in Sonarr episode names', () => {
    const naming = buildNamingSettings('sonarr');

    expect(naming).toMatchObject({
      renameEpisodes: true,
      replaceIllegalCharacters: true,
      seriesFolderFormat: '{Series TitleYear} {imdb-{ImdbId}}',
      seasonFolderFormat: 'Season {season:00}',
    });
    expect(naming.standardEpisodeFormat).toContain('{Custom Formats}');
  });

  it('keeps custom formats in Radarr file names but not file tokens in folders', () => {
    const naming = buildNamingSettings('radarr');

    expect(naming).toMatchObject({ renameMovies: true, replaceIllegalCharacters: true });
    expect(naming.standardMovieFormat).toContain('{[Custom Formats]}');
    expect(naming.movieFolderFormat).toBe('{Movie CleanTitle} ({Release Year}) {imdb-{ImdbId}}');
    expect(String(naming.movieFolderFormat)).not.toMatch(
      /Quality|Custom Formats|Release Group|MediaInfo/,
    );
  });
});

describe('buildIndexerSettings', () => {
  it('slows RSS polling and removes the age and size limits', () => {
    expect(buildIndexerSettings('sonarr')).toEqual({
      minimumAge: 0,
      retention: 0,
      maximumSize: 0,
      rssSyncInterval: 30,
    });
    expect(buildIndexerSettings('radarr')).toMatchObject({
      rssSyncInterval: 30,
      allowHardcodedSubs: false,
      availabilityDelay: 0,
    });
  });
});

describe('ui language', () => {
  const languages = [
    { id: 1, name: 'English' },
    { id: 3, name: 'Spanish' },
    { id: 34, name: 'Spanish (Latino)' },
  ];

  it('maps the primary subtag of a locale to a Servarr language name', () => {
    expect(uiLanguageName('es-MX')).toBe('Spanish');
    expect(uiLanguageName('en-US')).toBe('English');
    expect(uiLanguageName('pt-BR')).toBe('Portuguese');
  });

  it('falls back to English for invalid or unknown locales', () => {
    expect(uiLanguageName('not a locale')).toBe('English');
    expect(uiLanguageName('zz')).toBe('English');
  });

  it('resolves the identifier by name and not by position or value', () => {
    expect(resolveUiLanguageId(languages, 'es-MX')).toBe(3);
    expect(resolveUiLanguageId([{ id: 9, name: 'spanish' }, ...languages], 'es')).toBe(9);
  });

  it('falls back to English when the app has no such language', () => {
    expect(resolveUiLanguageId(languages, 'fr-FR')).toBe(1);
    expect(resolveUiLanguageId([], 'es-MX')).toBeUndefined();
  });

  it('wraps the identifier in the settings object', () => {
    expect(buildUiSettings(3)).toEqual({ uiLanguage: 3 });
  });
});

describe('ROOT_FOLDER_PATHS', () => {
  it('uses the shared media tree', () => {
    expect(ROOT_FOLDER_PATHS).toEqual({ sonarr: '/data/media/tv', radarr: '/data/media/movies' });
  });
});
