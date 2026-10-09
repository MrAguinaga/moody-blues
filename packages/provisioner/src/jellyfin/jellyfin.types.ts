export interface PublicSystemInfo {
  LocalAddress?: string;
  ServerName?: string;
  Version?: string;
  Id?: string;
  StartupWizardCompleted: boolean;
}

export interface StartupUser {
  Name?: string;
}

export interface AuthenticationResult {
  AccessToken: string;
}

export interface ApiKeyResource {
  AccessToken: string;
  AppName: string;
  DateCreated?: string;
  DateRevoked?: string;
  [key: string]: unknown;
}

export interface ApiKeyList {
  Items: ApiKeyResource[];
}

export type PlaybackPolicy = {
  EnableVideoPlaybackTranscoding: boolean;
  EnableAudioPlaybackTranscoding: boolean;
  EnablePlaybackRemuxing: boolean;
};

export interface UserPolicy extends Partial<PlaybackPolicy> {
  IsAdministrator?: boolean;
  AuthenticationProviderId?: string;
  PasswordResetProviderId?: string;
  [key: string]: unknown;
}

export interface UserDto {
  Id: string;
  Name: string;
  Policy?: UserPolicy;
  [key: string]: unknown;
}

export interface ServerConfiguration {
  ServerName?: string;
  UICulture?: string;
  PreferredMetadataLanguage?: string;
  MetadataCountryCode?: string;
  EnableLegacyAuthorization?: boolean;
  EnableMetrics?: boolean;
  [key: string]: unknown;
}

export interface EncodingOptions {
  TranscodingTempPath?: string;
  EnableSegmentDeletion?: boolean;
  EnableThrottling?: boolean;
  SegmentKeepSeconds?: number;
  HardwareAccelerationType?: string;
  VaapiDevice?: string;
  EnableHardwareEncoding?: boolean;
  [key: string]: unknown;
}

export type NamedConfigurationKey = 'encoding';

export type NamedConfiguration = EncodingOptions;

export type CollectionType = 'movies' | 'tvshows';

export interface LibrarySpec {
  name: string;
  collectionType: CollectionType;
  path: string;
}

export interface LibraryTypeOptions {
  Type: string;
  MetadataFetchers: string[];
  ImageFetchers: string[];
  [key: string]: unknown;
}

export interface LibraryOptions {
  Enabled: boolean;
  EnableRealtimeMonitor: boolean;
  EnableLUFSScan: boolean;
  EnableChapterImageExtraction: boolean;
  ExtractChapterImagesDuringLibraryScan: boolean;
  EnableTrickplayImageExtraction: boolean;
  ExtractTrickplayImagesDuringLibraryScan: boolean;
  SaveTrickplayWithMedia: boolean;
  PathInfos: { Path: string }[];
  SaveLocalMetadata: boolean;
  AutomaticRefreshIntervalDays: number;
  PreferredMetadataLanguage: string;
  MetadataCountryCode?: string;
  TypeOptions?: LibraryTypeOptions[];
  [key: string]: unknown;
}

export interface VirtualFolder {
  Name: string;
  Locations: string[];
  CollectionType?: string;
  LibraryOptions: LibraryOptions;
  ItemId: string;
}

export interface LibraryChange {
  result: 'created' | 'updated' | 'unchanged';
  name: string;
  drifted?: string[];
  note?: string;
}

export interface AdminCredentials {
  username: string;
  password: string;
}

export interface JellyfinAccess {
  apiKey: string;
  created: boolean;
  persisted: boolean;
  warnings: string[];
}
