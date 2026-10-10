import type { MissingEpisodeResource } from '@moody-blues/provisioner';

import { MAX_DETAIL_LINES, NEW_EPISODE_GRACE_MS, NEW_SERIES_GRACE_MS } from '../doctor.constants';
import type { DoctorCheck } from '../doctor.types';
import { errorText, gateService } from './check-gate.utils';

export interface IncompleteSeason {
  seasonNumber: number;
  missing: number;
}

export interface IncompleteSeries {
  seriesId: number;
  title: string;
  year?: number;
  seasons: IncompleteSeason[];
}

export interface LibraryEvaluationOptions {
  now: number;
}

function isOlderThan(timestamp: string | undefined, graceMs: number, now: number): boolean {
  const parsed = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
  return !Number.isNaN(parsed) && now - parsed >= graceMs;
}

function isSettled(episode: MissingEpisodeResource, now: number): boolean {
  const series = episode.series;
  return (
    series !== undefined &&
    series.monitored !== false &&
    episode.seasonNumber > 0 &&
    isOlderThan(episode.airDateUtc, NEW_EPISODE_GRACE_MS, now) &&
    (series.added === undefined || isOlderThan(series.added, NEW_SERIES_GRACE_MS, now))
  );
}

export function evaluateLibrary(
  missing: readonly MissingEpisodeResource[],
  queuedSeriesIds: ReadonlySet<number>,
  { now }: LibraryEvaluationOptions,
): IncompleteSeries[] {
  const found = new Map<number, IncompleteSeries>();

  for (const episode of missing) {
    const series = episode.series;
    if (!series || queuedSeriesIds.has(series.id) || !isSettled(episode, now)) {
      continue;
    }
    const entry = found.get(series.id) ?? {
      seriesId: series.id,
      title: series.title,
      year: series.year,
      seasons: [],
    };
    const season = entry.seasons.find((item) => item.seasonNumber === episode.seasonNumber);
    if (season) {
      season.missing += 1;
    } else {
      entry.seasons.push({ seasonNumber: episode.seasonNumber, missing: 1 });
    }
    found.set(series.id, entry);
  }

  return [...found.values()]
    .map((entry) => ({
      ...entry,
      seasons: entry.seasons.sort((left, right) => left.seasonNumber - right.seasonNumber),
    }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function describeIncompleteSeries({ title, year, seasons }: IncompleteSeries): string {
  const name = year ? `${title} (${year})` : title;
  const detail = seasons
    .map(
      ({ seasonNumber, missing }) =>
        `season ${seasonNumber}: ${missing} ${missing === 1 ? 'episode' : 'episodes'}`,
    )
    .join(', ');
  return `${name} — ${detail} without a file`;
}

export const libraryCheck: DoctorCheck = {
  id: 'library',
  name: 'Incomplete series',
  run: async (ctx) => {
    const gate = await gateService(ctx, 'sonarr');
    if (gate) {
      return gate;
    }
    try {
      const [missing, queue] = await Promise.all([
        ctx.clients.sonarr.listMissing(),
        ctx.clients.sonarr.listQueue(),
      ]);
      const queued = new Set(queue.flatMap((record) => record.seriesId ?? []));
      const incomplete = evaluateLibrary(missing, queued, { now: ctx.now() });

      if (incomplete.length === 0) {
        return { status: 'ok', message: 'Every series has all of its aired episodes' };
      }
      const shown = incomplete.slice(0, MAX_DETAIL_LINES).map(describeIncompleteSeries);
      const hidden = incomplete.length - shown.length;
      const first = incomplete[0];
      return {
        status: 'warning',
        message: `${incomplete.length} ${incomplete.length === 1 ? 'series has' : 'series have'} aired episodes without a file and nothing downloading`,
        details: [...shown, ...(hidden > 0 ? [`and ${hidden} more`] : [])],
        suggestion: `Run "moody-blues retry <series>" to look for a complete release${first ? `, for example: moody-blues retry "${first.title}"` : ''}.`,
      };
    } catch (error) {
      return {
        status: 'warning',
        message: 'The Sonarr library could not be read',
        details: [ctx.redact(errorText(error))],
        suggestion: 'Check the Sonarr API check above and run "moody-blues logs sonarr".',
      };
    }
  },
};
