export type FieldValue = string | number | boolean | null;

export interface NamedOption {
  option: string;
}

export type FieldDefinition = FieldValue | NamedOption;

export type SpecificationImplementation =
  | 'ReleaseTitleSpecification'
  | 'ReleaseGroupSpecification'
  | 'LanguageSpecification'
  | 'SourceSpecification';

export interface SpecificationDefinition {
  name: string;
  implementation: SpecificationImplementation;
  negate: boolean;
  required: boolean;
  fields: Readonly<Record<string, FieldDefinition>>;
}

export interface CustomFormatDefinition {
  name: string;
  includeCustomFormatWhenRenaming: boolean;
  specifications: readonly SpecificationDefinition[];
}

export interface ScoredFormat {
  format: CustomFormatDefinition;
  score: number;
}

export interface QualityLayer {
  groupName?: string;
  qualityNames: readonly string[];
  allowed: boolean;
}

export interface ProfilePlan {
  name: string;
  cutoffGroupName: string;
  upgradeAllowed: boolean;
  minFormatScore: number;
  cutoffFormatScore: number;
  minUpgradeFormatScore: number;
  languageName?: string;
  layers: readonly QualityLayer[];
  formats: readonly ScoredFormat[];
}

export class UnsupportedTierError extends Error {
  constructor(
    readonly tierId: string,
    readonly maxResolution: string,
  ) {
    super(
      `Quality tier "${tierId}" (${maxResolution}) is not supported yet; only 1080p tiers can be provisioned`,
    );
    this.name = 'UnsupportedTierError';
  }
}

export class UnsupportedAudioPriorityError extends Error {
  constructor(
    readonly symbol: string,
    readonly supported: readonly string[],
    reason: 'unknown' | 'repeated',
  ) {
    super(
      reason === 'unknown'
        ? `Unsupported audio priority "${symbol}"; supported values are ${supported.join(', ')}`
        : `Audio priority "${symbol}" is listed more than once`,
    );
    this.name = 'UnsupportedAudioPriorityError';
  }
}

export class QualityNotFoundError extends Error {
  constructor(readonly qualityName: string) {
    super(`The quality profile schema offers no quality named "${qualityName}"`);
    this.name = 'QualityNotFoundError';
  }
}

export class CustomFormatSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomFormatSchemaError';
  }
}

export class MissingResourceError extends Error {
  constructor(
    readonly kind: 'custom format' | 'language' | 'cutoff group',
    readonly resourceName: string,
  ) {
    super(`No ${kind} named "${resourceName}" is available to build the quality profile`);
    this.name = 'MissingResourceError';
  }
}
