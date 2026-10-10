import type { TitleResource } from '@moody-blues/provisioner';

import type { RemoveKind, RemoveLibrary, RemoveTarget } from './remove.types';

const COMBINING_MARKS = /\p{M}/gu;

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function toRemoveTarget(kind: RemoveKind, resource: TitleResource): RemoveTarget {
  return {
    kind,
    id: resource.id,
    title: resource.title,
    year: resource.year,
    path: resource.path,
    tmdbId: resource.tmdbId,
    tvdbId: resource.tvdbId,
  };
}

function namesOf(resource: TitleResource): string[] {
  return [resource.title, resource.originalTitle].flatMap((name) =>
    name ? [normalizeText(name)] : [],
  );
}

function compareTargets(left: RemoveTarget, right: RemoveTarget): number {
  return (
    normalizeText(left.title).localeCompare(normalizeText(right.title)) ||
    (left.year ?? 0) - (right.year ?? 0) ||
    left.kind.localeCompare(right.kind)
  );
}

export function findTitles(query: string, library: RemoveLibrary): RemoveTarget[] {
  const needle = normalizeText(query);
  if (needle === '') {
    return [];
  }
  const candidates = [
    ...library.movies.map((resource) => ({ kind: 'movie' as const, resource })),
    ...library.series.map((resource) => ({ kind: 'series' as const, resource })),
  ];
  const matches = candidates.filter(({ resource }) =>
    namesOf(resource).some((name) => name.includes(needle)),
  );
  const exact = matches.filter(({ resource }) => namesOf(resource).includes(needle));
  return (exact.length > 0 ? exact : matches)
    .map(({ kind, resource }) => toRemoveTarget(kind, resource))
    .sort(compareTargets);
}

export function findTitleByExternalId(
  kind: RemoveKind,
  externalId: number,
  library: RemoveLibrary,
): RemoveTarget | undefined {
  const resource =
    kind === 'movie'
      ? library.movies.find((movie) => movie.tmdbId === externalId)
      : library.series.find((series) => series.tvdbId === externalId);
  return resource && toRemoveTarget(kind, resource);
}
