import { Command, InvalidArgumentError } from 'commander';
import { createElement } from 'react';

import type { TitleResource } from '@moody-blues/provisioner';

import { findTitleByExternalId, findTitles, type RemoveTarget } from '../remove';
import {
  buildRetryPlan,
  type CandidateSearch,
  createRetryContext,
  isWorthSending,
  readSeasons,
  type RetryCandidate,
  type RetryContext,
  type RetryPlan,
  type RetryResult,
  type RetrySeason,
  runRetry,
  searchCandidates,
} from '../retry';
import { ConfirmView } from '../ui/views/ConfirmView';
import { SelectTitleView } from '../ui/views/SelectTitleView';
import {
  abortOnInterrupt,
  errorMessage,
  failWith,
  type OutputMode,
  resolveOutputMode,
} from '../utils/command.utils';
import { describeTarget, formatRemoveCandidates } from './remove-output.utils';
import {
  describeCandidate,
  describeSeason,
  formatRetryCandidates,
  formatRetryPlan,
  formatRetryStep,
  formatRetrySummary,
  toRetryJson,
  toRetryNothingJson,
  toRetryRefusedJson,
} from './retry-output.utils';
import { printJson } from './stack-output.utils';
import { createViewMount, type ViewMount } from './view-mount.utils';

interface Screen {
  show: ViewMount['show'];
  release(): void;
}

const INTERRUPTED_EXIT_CODE = 130;
const FAILURE_EXIT_CODE = 2;
const SELECTORS_REQUIRED = 'Provide exactly one of <query> or --series <tvdbId>.';
const NOTHING_TO_IMPORT =
  'Every episode already has a file of equal or better quality than this release.';
const NO_RECYCLE_BIN =
  'Sonarr has no recycle bin, so replaced files would be deleted. Run "moody-blues setup" again to provision it.';
const SEARCH_NOTICE = 'This asks every indexer and can take a few minutes.';

export interface RetrySettings {
  query?: string;
  series?: number;
  season?: number;
  pick?: number;
  home?: string;
  yes: boolean;
  mode: OutputMode;
  version: string;
  context?: RetryContext;
}

class Refusal extends Error {}

export function parsePositiveInteger(value: string): number {
  const number = Number(value.trim());
  if (!/^\d+$/.test(value.trim()) || number < 1) {
    throw new InvalidArgumentError('It must be a positive whole number.');
  }
  return number;
}

function chooseSelector(settings: RetrySettings): string | number {
  const query = settings.query?.trim();
  const selectors = [
    ...(query ? [query] : []),
    ...(settings.series === undefined ? [] : [settings.series]),
  ];
  const [selector, ...extra] = selectors;
  if (selector === undefined || extra.length > 0) {
    throw new Refusal(SELECTORS_REQUIRED);
  }
  return selector;
}

function selectCandidates(
  settings: RetrySettings,
  series: readonly TitleResource[],
): { target: RemoveTarget } | { message: string; candidates: RemoveTarget[] } {
  const selector = chooseSelector(settings);
  const library = { movies: [], series: [...series] };
  if (typeof selector === 'string') {
    const candidates = findTitles(selector, library);
    if (candidates.length === 0) {
      return { message: `No series in Sonarr matches "${selector}".`, candidates };
    }
    return candidates.length === 1
      ? { target: candidates[0] as RemoveTarget }
      : { message: `Several series match "${selector}".`, candidates };
  }
  const target = findTitleByExternalId('series', selector, library);
  return target
    ? { target }
    : { message: `No series with tvdbId ${selector} in Sonarr.`, candidates: [] };
}

function chooseSeries(
  settings: RetrySettings,
  candidates: RemoveTarget[],
  view: Screen,
  signal: AbortSignal,
): Promise<RemoveTarget | undefined> {
  return new Promise((settle) => {
    signal.addEventListener('abort', () => settle(undefined), { once: true });
    view.show(
      createElement(SelectTitleView, {
        version: settings.version,
        heading: `Several series match "${settings.query?.trim()}"`,
        label: 'Which series do you want to retry?',
        options: candidates.map((candidate, index) => ({
          value: String(index),
          label: describeTarget(candidate),
          hint: candidate.path,
        })),
        onSelect: (value) => settle(candidates[Number(value)]),
      }),
    );
  });
}

function chooseRelease(
  settings: RetrySettings,
  heading: string,
  candidates: readonly RetryCandidate[],
  view: Screen,
  signal: AbortSignal,
): Promise<RetryCandidate | undefined> {
  return new Promise((settle) => {
    signal.addEventListener('abort', () => settle(undefined), { once: true });
    view.show(
      createElement(SelectTitleView, {
        version: settings.version,
        heading,
        label: 'Which release do you want to send to Decypharr?',
        options: candidates.map((candidate, index) => ({
          value: String(index),
          label: describeCandidate(candidate),
        })),
        onSelect: (value) => settle(candidates[Number(value)]),
      }),
    );
  });
}

function confirmSend(
  settings: RetrySettings,
  plan: RetryPlan,
  view: Screen,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((settle) => {
    signal.addEventListener('abort', () => settle(false), { once: true });
    view.show(
      createElement(ConfirmView, {
        version: settings.version,
        heading: 'Send the release',
        details: formatRetryPlan(plan),
        confirmLabel: 'Send it to Decypharr?',
        onConfirm: () => settle(true),
        onCancel: () => settle(false),
      }),
    );
  });
}

interface SeasonRun {
  settings: RetrySettings;
  context: RetryContext;
  target: RemoveTarget;
  series: TitleResource;
  season: RetrySeason;
  view?: Screen;
  signal: AbortSignal;
}

function refuse(settings: RetrySettings, message: string, seasons: readonly number[] = []): number {
  if (settings.mode === 'json') {
    printJson(toRetryRefusedJson(message, seasons));
  } else {
    console.error(`✖ ${message}`);
  }
  return 1;
}

function pickHeadless(
  settings: RetrySettings,
  candidates: readonly RetryCandidate[],
): RetryCandidate | string {
  const position = settings.pick ?? 1;
  return (
    candidates.find((candidate) => candidate.position === position) ??
    `--pick ${position} is not one of the releases (${candidates.map((candidate) => candidate.position).join(', ')}).`
  );
}

async function sendRelease(
  run: SeasonRun,
  plan: RetryPlan,
  search: CandidateSearch,
): Promise<RetryResult> {
  const json = run.settings.mode === 'json';
  if (run.view) {
    console.log(`Moody Blues CLI v${run.settings.version} — Retry`);
  }
  const result = await runRetry({
    clients: run.context.clients,
    runtime: run.context.runtime,
    plan,
    onStep: json ? undefined : (step) => formatRetryStep(step).forEach((line) => console.log(line)),
  });
  if (json) {
    printJson(
      toRetryJson({
        target: run.target,
        season: run.season,
        candidates: search.candidates,
        excluded: search.excluded,
        plan,
        result,
      }),
    );
  } else {
    formatRetrySummary(result).forEach((line) => console.error(line));
  }
  return result;
}

async function processSeason(run: SeasonRun): Promise<number> {
  const { settings, context, target, series, season, view, signal } = run;
  const json = settings.mode === 'json';
  const headline = describeSeason(target, season);

  if (settings.mode === 'headless') {
    console.log(`Moody Blues CLI v${settings.version} — Retry (Headless)`);
  }
  if (!json) {
    console.log(`Searching Sonarr for season ${season.seasonNumber}. ${SEARCH_NOTICE}`);
  }
  const search = await searchCandidates(context.clients.sonarr, series, season.seasonNumber);
  if (search.candidates.length === 0) {
    return refuse(
      settings,
      `No usable release for season ${season.seasonNumber} (${search.excluded} rejected by Sonarr).`,
    );
  }
  const [files, mediaManagement] = await Promise.all([
    context.clients.sonarr.listEpisodeFiles(target.id),
    context.clients.sonarr.getConfig('mediamanagement'),
  ]);
  const recycleBinReady = String(mediaManagement.recycleBin ?? '') !== '';

  let remaining = [...search.candidates];
  while (remaining.length > 0) {
    let candidate: RetryCandidate | undefined;
    if (view) {
      candidate = await chooseRelease(settings, headline, remaining, view, signal);
    } else {
      const picked = pickHeadless(settings, remaining);
      if (typeof picked === 'string') {
        return refuse(settings, picked);
      }
      candidate = picked;
    }
    if (!candidate) {
      view?.release();
      console.error('Cancelled.');
      return INTERRUPTED_EXIT_CODE;
    }
    const chosen = candidate;

    const plan = buildRetryPlan(target, season, files, chosen);
    if (!isWorthSending(plan)) {
      if (!view) {
        return refuse(settings, NOTHING_TO_IMPORT);
      }
      view.release();
      console.error(`✖ ${NOTHING_TO_IMPORT}`);
      return 1;
    }
    const recycleProblem =
      !recycleBinReady && plan.dispositions.some(({ action }) => action === 'replace')
        ? NO_RECYCLE_BIN
        : undefined;
    const incomplete = !settings.yes || settings.pick === undefined;

    if (view) {
      if (recycleProblem) {
        view.release();
        console.error(`✖ ${recycleProblem}`);
        return 1;
      }
      const approved = await confirmSend(settings, plan, view, signal);
      view.release();
      if (!approved) {
        console.error('Cancelled.');
        return INTERRUPTED_EXIT_CODE;
      }
    } else if (json) {
      if (incomplete) {
        const message = [
          settings.yes
            ? 'Pass --pick <n> to choose the release.'
            : 'Pass --pick <n> and --yes to send the release.',
          recycleProblem,
        ]
          .filter(Boolean)
          .join(' ');
        printJson(
          toRetryJson({
            target,
            season,
            candidates: search.candidates,
            excluded: search.excluded,
            plan,
            message,
          }),
        );
        return 1;
      }
      if (recycleProblem) {
        return refuse(settings, recycleProblem);
      }
    } else {
      console.log(`Series: ${headline}`);
      formatRetryCandidates(search.candidates).forEach((line) => console.log(line));
      formatRetryPlan(plan).forEach((line) => console.log(line));
      if (recycleProblem) {
        console.error(`✖ ${recycleProblem}`);
      }
      if (incomplete) {
        console.error(
          settings.yes
            ? '✖ Nothing was sent. Pass --pick <n> to choose the release.'
            : '✖ Nothing was sent. Pass --pick <n> and --yes to send the release non-interactively.',
        );
      }
      if (incomplete || recycleProblem) {
        return 1;
      }
    }

    const result = await sendRelease(run, plan, search);
    if (result.success) {
      return 0;
    }
    if (!view || result.outcome === 'failed') {
      return FAILURE_EXIT_CODE;
    }
    remaining = remaining.filter((item) => item.position !== chosen.position);
    if (remaining.length > 0) {
      console.log('Pick another release from the same search.');
    }
  }
  console.error('✖ No release was delivered and verified.');
  return FAILURE_EXIT_CODE;
}

async function run(settings: RetrySettings): Promise<void> {
  const controller = abortOnInterrupt();
  let mount: ViewMount | undefined;
  let interacting = false;
  const screen: Screen | undefined =
    settings.mode === 'interactive'
      ? {
          show: (element) => {
            if (!mount) {
              interacting = true;
              mount = createViewMount(() => {
                if (interacting) {
                  controller.abort();
                }
              });
            }
            mount.show(element);
          },
          release: () => {
            interacting = false;
            mount?.unmount();
            mount = undefined;
          },
        }
      : undefined;

  try {
    chooseSelector(settings);
    const context =
      settings.context ?? createRetryContext({ home: settings.home, signal: controller.signal });
    const library = await context.clients.sonarr.listTitles();
    const picked = selectCandidates(settings, library);

    let target: RemoveTarget | undefined;
    if ('target' in picked) {
      target = picked.target;
    } else if (screen && picked.candidates.length > 1) {
      target = await chooseSeries(settings, picked.candidates, screen, controller.signal);
      if (!target) {
        screen.release();
        console.error('Cancelled.');
        process.exitCode = INTERRUPTED_EXIT_CODE;
        return;
      }
      screen.release();
    } else if (settings.mode === 'json') {
      printJson(toRetryRefusedJson(picked.message));
      process.exitCode = 1;
      return;
    } else {
      console.error(`✖ ${picked.message}`);
      if (picked.candidates.length > 0) {
        formatRemoveCandidates(settings.query?.trim() ?? '', picked.candidates).forEach((line) =>
          console.error(line),
        );
      }
      process.exitCode = 1;
      return;
    }

    const resource = library.find((item) => item.id === target.id) as TitleResource;
    const seasons = await readSeasons(
      context.clients.sonarr,
      target,
      context.runtime.now(),
      settings.season,
    );

    if (seasons.length === 0) {
      screen?.release();
      if (settings.season !== undefined) {
        process.exitCode = refuse(
          settings,
          `${describeTarget(target)} has no monitored season ${settings.season}.`,
        );
        return;
      }
      if (settings.mode === 'json') {
        printJson(toRetryNothingJson(target));
      } else {
        console.log(`Nothing to retry: ${target.title} has every aired, monitored episode.`);
      }
      return;
    }
    if (!screen && seasons.length > 1) {
      process.exitCode = refuse(
        settings,
        `Several seasons are incomplete (${seasons.map((item) => item.seasonNumber).join(', ')}); repeat the command with --season <n>.`,
        seasons.map((item) => item.seasonNumber),
      );
      return;
    }

    let code = 0;
    for (const season of seasons) {
      const seasonCode = await processSeason({
        settings,
        context,
        target,
        series: resource,
        season,
        view: screen,
        signal: controller.signal,
      });
      if (seasonCode === INTERRUPTED_EXIT_CODE) {
        code = seasonCode;
        break;
      }
      code = Math.max(code, seasonCode);
    }
    process.exitCode = code;
  } catch (error) {
    if (controller.signal.aborted) {
      console.error(
        'Interrupted. If a release was already sent, run "moody-blues doctor" to check the queue.',
      );
      process.exitCode = INTERRUPTED_EXIT_CODE;
      return;
    }
    throw error;
  } finally {
    screen?.release();
  }
}

export async function executeRetry(settings: RetrySettings): Promise<void> {
  try {
    await run(settings);
  } catch (error) {
    if (settings.mode === 'json') {
      printJson(toRetryRefusedJson(errorMessage(error)));
      process.exitCode = 1;
      return;
    }
    failWith(error);
  }
}

interface RetryCommandOptions {
  series?: number;
  season?: number;
  pick?: number;
  home?: string;
}

export function createRetryCommand(version: string): Command {
  const retryCmd = new Command('retry');

  retryCmd
    .description('Find a complete pack for a series with missing episodes and import it')
    .argument('[query]', 'Text to search in the titles of Sonarr')
    .option('--series <tvdbId>', 'Select the series with this TVDB id', parsePositiveInteger)
    .option('--season <n>', 'Only retry this season', parsePositiveInteger)
    .option(
      '--pick <n>',
      'Send the release with this number (headless and --json)',
      parsePositiveInteger,
    )
    .option('--home <path>', 'Moody Blues home directory (defaults to MB_HOME)')
    .action(async (query: string | undefined, options: RetryCommandOptions) => {
      const globals = retryCmd.optsWithGlobals();
      await executeRetry({
        query,
        series: options.series,
        season: options.season,
        pick: options.pick,
        home: options.home,
        yes: Boolean(globals.yes),
        mode: resolveOutputMode(globals),
        version,
      });
    });

  return retryCmd;
}
