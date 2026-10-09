import type { ArrKind } from '../arr/arr.types';
import type { LanguageSettings, QualityTier } from '../config/config.types';
import { buildCodecFormats } from './codec-formats.profile';
import { buildLanguageFormats } from './language-formats.profile';
import { type ProfilePlan, UnsupportedTierError } from './profile.types';
import { CUTOFF_GROUP_NAME, QUALITY_LAYERS } from './quality-layers.profile';

export const MASTER_PROFILE_NAME = 'Moody Blues';
export const MIN_UPGRADE_FORMAT_SCORE = 50;
const SUPPORTED_RESOLUTION = '1080p';
const RADARR_ANY_LANGUAGE = 'Any';

export function tierProfileName(tier: QualityTier): string {
  if (tier.maxResolution !== SUPPORTED_RESOLUTION) {
    throw new UnsupportedTierError(tier.id, tier.maxResolution);
  }
  return MASTER_PROFILE_NAME;
}

export function buildProfilePlan(
  tier: QualityTier,
  languages: Pick<LanguageSettings, 'audioPriority'>,
  kind: ArrKind,
): ProfilePlan {
  const name = tierProfileName(tier);
  const languageFormats = buildLanguageFormats(languages.audioPriority);

  return {
    name,
    cutoffGroupName: CUTOFF_GROUP_NAME,
    upgradeAllowed: true,
    minFormatScore: 0,
    cutoffFormatScore: languageFormats[0]?.score ?? 0,
    minUpgradeFormatScore: MIN_UPGRADE_FORMAT_SCORE,
    ...(kind === 'radarr' ? { languageName: RADARR_ANY_LANGUAGE } : {}),
    layers: QUALITY_LAYERS[kind],
    formats: [...languageFormats, ...buildCodecFormats(kind)],
  };
}
