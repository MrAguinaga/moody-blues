import type {
  CustomFormatResource,
  QualityProfileFormatItemResource,
  QualityProfileItemResource,
  QualityProfileResource,
} from '../arr/arr.types';
import { MissingResourceError, type ProfilePlan, QualityNotFoundError } from './profile.types';

type LanguageIds = Readonly<Record<string, number>>;

interface SchemaCatalog {
  qualities: Map<string, QualityProfileItemResource>;
  groupIds: Map<string, number>;
  order: string[];
  maxGroupId: number;
}

const isGroup = (item: QualityProfileItemResource) => !item.quality;

function catalogSchema(schema: QualityProfileResource): SchemaCatalog {
  const catalog: SchemaCatalog = {
    qualities: new Map(),
    groupIds: new Map(),
    order: [],
    maxGroupId: 0,
  };
  const addQuality = (item: QualityProfileItemResource) => {
    if (item.quality && !catalog.qualities.has(item.quality.name)) {
      catalog.qualities.set(item.quality.name, item);
      catalog.order.push(item.quality.name);
    }
  };
  for (const item of schema.items) {
    if (isGroup(item)) {
      catalog.groupIds.set(String(item.name), item.id ?? 0);
      catalog.maxGroupId = Math.max(catalog.maxGroupId, item.id ?? 0);
      item.items.forEach(addQuality);
    } else {
      addQuality(item);
    }
  }
  return catalog;
}

function plannedQualityNames(plan: ProfilePlan): Set<string> {
  return new Set(plan.layers.flatMap((layer) => layer.qualityNames));
}

export function findUnplannedQualities(
  plan: ProfilePlan,
  schema: QualityProfileResource,
): string[] {
  const planned = plannedQualityNames(plan);
  return catalogSchema(schema).order.filter((name) => !planned.has(name));
}

function qualityItem(
  catalog: SchemaCatalog,
  name: string,
  allowed: boolean,
): QualityProfileItemResource {
  const template = catalog.qualities.get(name);
  if (!template) {
    throw new QualityNotFoundError(name);
  }
  return { ...structuredClone(template), allowed };
}

export function materializeProfile(
  plan: ProfilePlan,
  schema: QualityProfileResource,
  formats: readonly CustomFormatResource[],
  languageIds: LanguageIds,
  existing?: QualityProfileResource,
): QualityProfileResource {
  const catalog = catalogSchema(schema);
  const existingGroupIds = new Map(
    (existing?.items ?? []).filter(isGroup).map((item) => [String(item.name), item.id ?? 0]),
  );
  let nextGroupId = catalog.maxGroupId + 1;
  const groupIds = new Map<string, number>();

  const groupId = (name: string): number => {
    const known = groupIds.get(name);
    if (known !== undefined) return known;
    const id = existingGroupIds.get(name) ?? catalog.groupIds.get(name) ?? nextGroupId++;
    groupIds.set(name, id);
    return id;
  };

  const items: QualityProfileItemResource[] = plan.layers.flatMap((layer) => {
    if (layer.groupName === undefined) {
      return layer.qualityNames.map((name) => qualityItem(catalog, name, layer.allowed));
    }
    return {
      id: groupId(layer.groupName),
      name: layer.groupName,
      items: layer.qualityNames.map((name) => qualityItem(catalog, name, layer.allowed)),
      allowed: layer.allowed,
    };
  });
  for (const name of findUnplannedQualities(plan, schema)) {
    items.push(qualityItem(catalog, name, false));
  }

  if (!plan.layers.some((layer) => layer.groupName === plan.cutoffGroupName)) {
    throw new MissingResourceError('cutoff group', plan.cutoffGroupName);
  }

  const scores = new Map(plan.formats.map(({ format, score }) => [format.name, score]));
  const formatItems: QualityProfileFormatItemResource[] = formats.map((format) => {
    if (format.id === undefined) {
      throw new MissingResourceError('custom format', format.name);
    }
    return { format: format.id, name: format.name, score: scores.get(format.name) ?? 0 };
  });
  for (const { format } of plan.formats) {
    if (!formats.some((candidate) => candidate.name === format.name)) {
      throw new MissingResourceError('custom format', format.name);
    }
  }

  let language: QualityProfileResource['language'];
  if (plan.languageName !== undefined) {
    const id = languageIds[plan.languageName];
    if (id === undefined) {
      throw new MissingResourceError('language', plan.languageName);
    }
    language = { id, name: plan.languageName };
  }

  return {
    ...(existing?.id !== undefined ? { id: existing.id } : {}),
    name: plan.name,
    upgradeAllowed: plan.upgradeAllowed,
    cutoff: groupId(plan.cutoffGroupName),
    items,
    minFormatScore: plan.minFormatScore,
    cutoffFormatScore: plan.cutoffFormatScore,
    minUpgradeFormatScore: plan.minUpgradeFormatScore,
    formatItems,
    ...(language ? { language } : {}),
  };
}

function cutoffName(profile: QualityProfileResource): string | undefined {
  for (const item of profile.items) {
    if (isGroup(item) ? item.id === profile.cutoff : item.quality?.id === profile.cutoff) {
      return isGroup(item) ? String(item.name) : item.quality?.name;
    }
  }
  return undefined;
}

function projectProfile(profile: QualityProfileResource) {
  return {
    upgradeAllowed: profile.upgradeAllowed,
    minFormatScore: profile.minFormatScore,
    cutoffFormatScore: profile.cutoffFormatScore,
    minUpgradeFormatScore: profile.minUpgradeFormatScore,
    language: profile.language?.name ?? null,
    cutoff: cutoffName(profile) ?? null,
    items: profile.items.map((item) =>
      isGroup(item)
        ? {
            group: item.name,
            allowed: item.allowed,
            members: item.items
              .map((member) => ({ quality: member.quality?.name, allowed: member.allowed }))
              .sort((left, right) => String(left.quality).localeCompare(String(right.quality))),
          }
        : { quality: item.quality?.name, allowed: item.allowed },
    ),
    scores: profile.formatItems
      .filter((entry) => entry.score !== 0)
      .map((entry) => [entry.name, entry.score] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  };
}

export function profilesEquivalent(
  left: QualityProfileResource,
  right: QualityProfileResource,
): boolean {
  return JSON.stringify(projectProfile(left)) === JSON.stringify(projectProfile(right));
}
