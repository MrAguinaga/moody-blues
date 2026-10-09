export { ensureJellyfinAccess } from './jellyfin.access';
export {
  createJellyfinClient,
  type JellyfinClient,
  type JellyfinClientOptions,
  type JellyfinReadyOptions,
} from './jellyfin.client';
export {
  ADMIN_USERNAME_PATTERN,
  ENCODING_SAFEGUARDS,
  JELLYFIN_API_KEY_APP,
  JELLYFIN_LIBRARIES,
  JELLYFIN_SERVER_SETTINGS,
  VAAPI_DEVICE_PATH,
} from './jellyfin.constants';
export { provisionJellyfin, type ProvisionJellyfinOptions } from './jellyfin.provision';
export {
  buildLibraryOptions,
  correctLibraryOptions,
  desiredEncodingSettings,
  desiredServerSettings,
  desiredTypeOptions,
  driftedKeys,
  type MetadataLocale,
  parseMetadataLocale,
} from './jellyfin.settings';
export type {
  AdminCredentials,
  ApiKeyResource,
  CollectionType,
  EncodingOptions,
  JellyfinAccess,
  LibraryChange,
  LibraryOptions,
  LibrarySpec,
  LibraryTypeOptions,
  NamedConfiguration,
  NamedConfigurationKey,
  PlaybackPolicy,
  PublicSystemInfo,
  ServerConfiguration,
  UserDto,
  UserPolicy,
  VirtualFolder,
} from './jellyfin.types';
export {
  createJellyfinProvisionStep,
  jellyfinProvisionStep,
  type JellyfinStepOverrides,
} from './jellyfin-provision.step';
export {
  provisionTranscoding,
  type ProvisionTranscodingOptions,
} from './jellyfin-transcoding.provision';
export {
  buildEncodingSettings,
  buildPlaybackPolicy,
  HardwareAccelerationMissingError,
} from './jellyfin-transcoding.settings';
export {
  createJellyfinTranscodingStep,
  jellyfinTranscodingStep,
} from './jellyfin-transcoding.step';
