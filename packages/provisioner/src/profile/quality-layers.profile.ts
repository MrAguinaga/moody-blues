import type { ArrKind } from '../arr/arr.types';
import type { QualityLayer } from './profile.types';

export const CUTOFF_GROUP_NAME = 'HD';

const single = (allowed: boolean, ...qualityNames: string[]): QualityLayer[] =>
  qualityNames.map((name) => ({ qualityNames: [name], allowed }));

const group = (groupName: string, allowed: boolean, ...qualityNames: string[]): QualityLayer => ({
  groupName,
  qualityNames,
  allowed,
});

export const QUALITY_LAYERS: Readonly<Record<ArrKind, readonly QualityLayer[]>> = {
  radarr: [
    ...single(false, 'Unknown', 'WORKPRINT'),
    ...single(true, 'CAM', 'TELESYNC', 'TELECINE', 'REGIONAL', 'DVDSCR'),
    ...single(true, 'SDTV', 'DVD', 'DVD-R'),
    group('WEB 480p', true, 'WEBDL-480p', 'WEBRip-480p'),
    ...single(true, 'Bluray-480p', 'Bluray-576p'),
    group(
      CUTOFF_GROUP_NAME,
      true,
      'HDTV-720p',
      'WEBDL-720p',
      'WEBRip-720p',
      'Bluray-720p',
      'HDTV-1080p',
      'Remux-1080p',
      'WEBRip-1080p',
      'WEBDL-1080p',
      'Bluray-1080p',
    ),
    ...single(false, 'HDTV-2160p'),
    group('WEB 2160p', false, 'WEBDL-2160p', 'WEBRip-2160p'),
    ...single(false, 'Bluray-2160p', 'Remux-2160p', 'BR-DISK', 'Raw-HD'),
  ],
  sonarr: [
    ...single(false, 'Unknown'),
    ...single(true, 'SDTV'),
    group('WEB 480p', true, 'WEBRip-480p', 'WEBDL-480p'),
    ...single(true, 'DVD', 'Bluray-480p', 'Bluray-576p'),
    group(
      CUTOFF_GROUP_NAME,
      true,
      'HDTV-720p',
      'WEBRip-720p',
      'WEBDL-720p',
      'Bluray-720p',
      'HDTV-1080p',
      'Bluray-1080p Remux',
      'WEBRip-1080p',
      'WEBDL-1080p',
      'Bluray-1080p',
    ),
    ...single(false, 'HDTV-2160p'),
    group('WEB 2160p', false, 'WEBRip-2160p', 'WEBDL-2160p'),
    ...single(false, 'Bluray-2160p', 'Bluray-2160p Remux', 'Raw-HD'),
  ],
};
