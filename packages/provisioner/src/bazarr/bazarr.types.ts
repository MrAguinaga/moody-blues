export type ProfileFlag = 'True' | 'False';

export type HearingImpairedMode = ProfileFlag | 'Excluded';

export interface ProfileItem {
  id: number;
  language: string;
  audio_exclude: ProfileFlag;
  audio_only_include: ProfileFlag;
  hi: HearingImpairedMode;
  forced: ProfileFlag;
}

export interface LanguageProfile {
  profileId: number;
  name: string;
  items: ProfileItem[];
  cutoff: number | null;
  originalFormat: boolean | number | null;
  mustContain: string[];
  mustNotContain: string[];
  tag: string | null;
}

export interface BazarrLanguage {
  name: string;
  code2: string;
  code3: string;
  enabled: boolean;
}

export interface BazarrStatus {
  bazarr_version: string;
  sonarr_version: string;
  radarr_version: string;
}

export type SettingsValue = string | number | boolean | readonly string[];

export interface SettingsEntry {
  key: string;
  value: SettingsValue;
}

export type BazarrSettings = Record<string, Record<string, unknown>>;

export interface BazarrTask {
  job_id: string;
  name: string;
  job_running: boolean;
}

export interface BazarrSeries {
  sonarrSeriesId: number;
  title: string;
  profileId: number | null;
}

export interface BazarrMovie {
  radarrId: number;
  title: string;
  profileId: number | null;
}

export interface ProfileAssignment {
  id: number;
  profileId: number;
}
