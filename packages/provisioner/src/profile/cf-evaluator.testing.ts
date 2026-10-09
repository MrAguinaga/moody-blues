import type {
  CustomFormatDefinition,
  FieldDefinition,
  ScoredFormat,
  SpecificationDefinition,
} from './profile.types';

export interface ReleaseSample {
  title: string;
  releaseGroup?: string;
  source?: string;
  languages?: readonly string[];
  originalLanguage?: string;
}

const ORIGINAL_OPTION = 'Original';
const DEFAULT_ORIGINAL_LANGUAGE = 'English';

function optionName(value: FieldDefinition | undefined): string {
  return typeof value === 'object' && value !== null ? value.option : String(value);
}

function groupFromTitle(title: string): string {
  return /-([A-Za-z0-9]+)$/.exec(title)?.[1] ?? '';
}

function languageMatches(specification: SpecificationDefinition, release: ReleaseSample): boolean {
  const original = release.originalLanguage ?? DEFAULT_ORIGINAL_LANGUAGE;
  const present = release.languages ?? [original];
  const wanted = optionName(specification.fields.value);
  const target = wanted === ORIGINAL_OPTION ? original : wanted;
  return specification.fields.exceptLanguage === true
    ? present.some((language) => language !== target)
    : present.includes(target);
}

function satisfied(specification: SpecificationDefinition, release: ReleaseSample): boolean {
  switch (specification.implementation) {
    case 'ReleaseTitleSpecification':
      return new RegExp(String(specification.fields.value), 'i').test(release.title);
    case 'ReleaseGroupSpecification':
      return new RegExp(String(specification.fields.value), 'i').test(
        release.releaseGroup ?? groupFromTitle(release.title),
      );
    case 'SourceSpecification':
      return release.source === optionName(specification.fields.value);
    case 'LanguageSpecification':
      return languageMatches(specification, release);
  }
}

export function formatMatches(format: CustomFormatDefinition, release: ReleaseSample): boolean {
  const groups = new Map<string, SpecificationDefinition[]>();
  for (const specification of format.specifications) {
    groups.set(specification.implementation, [
      ...(groups.get(specification.implementation) ?? []),
      specification,
    ]);
  }
  return [...groups.values()].every((specifications) => {
    const outcomes = specifications.map((specification) => ({
      required: specification.required,
      matched: satisfied(specification, release) !== specification.negate,
    }));
    return (
      !outcomes.some((outcome) => outcome.required && !outcome.matched) &&
      outcomes.some((outcome) => outcome.matched)
    );
  });
}

export function matchingFormats(
  formats: readonly ScoredFormat[],
  release: ReleaseSample,
): string[] {
  return formats
    .filter(({ format }) => formatMatches(format, release))
    .map(({ format }) => format.name);
}

export function totalScore(formats: readonly ScoredFormat[], release: ReleaseSample): number {
  return formats
    .filter(({ format }) => formatMatches(format, release))
    .reduce((sum, { score }) => sum + score, 0);
}
