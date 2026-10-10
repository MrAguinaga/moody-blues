import { Command, InvalidArgumentError } from 'commander';
import { createElement } from 'react';

import {
  buildRemovePlan,
  createRemoveClients,
  findTitleByExternalId,
  findTitles,
  readLibrary,
  type RemoveClients,
  type RemoveKind,
  type RemoveLibrary,
  type RemovePlan,
  type RemoveResult,
  type RemoveTarget,
  runRemove,
} from '../remove';
import { ConfirmView } from '../ui/views/ConfirmView';
import { SelectTitleView } from '../ui/views/SelectTitleView';
import {
  abortOnInterrupt,
  errorMessage,
  failWith,
  type OutputMode,
  resolveOutputMode,
} from '../utils/command.utils';
import {
  describeTarget,
  formatRemoveCandidates,
  formatRemovePlan,
  formatRemoveStep,
  formatRemoveSummary,
  toRemoveJson,
  toRemoveRefusedJson,
} from './remove-output.utils';
import { printJson } from './stack-output.utils';
import { createViewMount } from './view-mount.utils';

const INTERRUPTED_EXIT_CODE = 130;
const PARTIAL_FAILURE_EXIT_CODE = 2;
const SELECTORS_REQUIRED = 'Provide exactly one of <query>, --movie <tmdbId> or --series <tvdbId>.';

export interface RemoveSettings {
  query?: string;
  movie?: number;
  series?: number;
  keepDebrid: boolean;
  home?: string;
  yes: boolean;
  mode: OutputMode;
  version: string;
  clients?: RemoveClients;
}

type Selection =
  | { kind: 'selected'; target: RemoveTarget }
  | { kind: 'refused'; message: string; candidates: RemoveTarget[] }
  | { kind: 'cancelled' };

export function parseExternalId(value: string): number {
  const id = Number(value.trim());
  if (!/^\d+$/.test(value.trim()) || id < 1) {
    throw new InvalidArgumentError('It must be a positive whole number.');
  }
  return id;
}

function exitCodeFor(result: RemoveResult): number {
  if (result.success) {
    return 0;
  }
  return result.libraryDeleted ? PARTIAL_FAILURE_EXIT_CODE : 1;
}

function chooseSelector(settings: RemoveSettings): { kind: RemoveKind; id: number } | string {
  const query = settings.query?.trim();
  const selectors = [
    ...(query ? [query] : []),
    ...(settings.movie === undefined ? [] : [{ kind: 'movie' as const, id: settings.movie }]),
    ...(settings.series === undefined ? [] : [{ kind: 'series' as const, id: settings.series }]),
  ];
  const [selector, ...extra] = selectors;
  if (selector === undefined || extra.length > 0) {
    throw new Error(SELECTORS_REQUIRED);
  }
  return selector;
}

function pickTarget(
  settings: RemoveSettings,
  library: RemoveLibrary,
): { target: RemoveTarget } | { message: string; candidates: RemoveTarget[] } {
  const selector = chooseSelector(settings);
  if (typeof selector === 'string') {
    const candidates = findTitles(selector, library);
    if (candidates.length === 0) {
      return { message: `No title in Radarr or Sonarr matches "${selector}".`, candidates };
    }
    return candidates.length === 1
      ? { target: candidates[0] as RemoveTarget }
      : { message: `Several titles match "${selector}".`, candidates };
  }
  const target = findTitleByExternalId(selector.kind, selector.id, library);
  if (target) {
    return { target };
  }
  const idName = selector.kind === 'movie' ? 'tmdbId' : 'tvdbId';
  const app = selector.kind === 'movie' ? 'Radarr' : 'Sonarr';
  return {
    message: `No ${selector.kind} with ${idName} ${selector.id} in ${app}.`,
    candidates: [],
  };
}

function printRefusal(settings: RemoveSettings, message: string, candidates: RemoveTarget[]): void {
  if (settings.mode === 'json') {
    printJson(toRemoveRefusedJson(message, candidates));
    return;
  }
  console.error(`✖ ${message}`);
  if (candidates.length > 0) {
    const query = settings.query?.trim() ?? '';
    formatRemoveCandidates(query, candidates).forEach((line) => console.error(line));
  }
}

function chooseInteractively(
  settings: RemoveSettings,
  candidates: RemoveTarget[],
  view: ReturnType<typeof createViewMount>,
  signal: AbortSignal,
): Promise<RemoveTarget | undefined> {
  return new Promise((settle) => {
    signal.addEventListener('abort', () => settle(undefined), { once: true });
    view.show(
      createElement(SelectTitleView, {
        version: settings.version,
        heading: `Several titles match "${settings.query?.trim()}"`,
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

function confirmInteractively(
  settings: RemoveSettings,
  plan: RemovePlan,
  view: ReturnType<typeof createViewMount>,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((settle) => {
    signal.addEventListener('abort', () => settle(false), { once: true });
    view.show(
      createElement(ConfirmView, {
        version: settings.version,
        heading: 'Remove the title',
        details: formatRemovePlan(plan),
        confirmLabel: 'Delete this title everywhere?',
        onConfirm: () => settle(true),
        onCancel: () => settle(false),
      }),
    );
  });
}

async function execute(
  settings: RemoveSettings,
  clients: RemoveClients,
  plan: RemovePlan,
  signal: AbortSignal,
): Promise<void> {
  const json = settings.mode === 'json';
  const result = await runRemove({
    clients,
    plan,
    onStep: json
      ? undefined
      : (step) => formatRemoveStep(step, plan).forEach((line) => console.log(line)),
  });

  if (json) {
    printJson(toRemoveJson(plan, result));
  } else {
    formatRemoveSummary(result).forEach((line) => console.error(line));
  }
  process.exitCode = signal.aborted ? INTERRUPTED_EXIT_CODE : exitCodeFor(result);
}

async function resolveSelection(
  settings: RemoveSettings,
  clients: RemoveClients,
  view: ReturnType<typeof createViewMount> | undefined,
  signal: AbortSignal,
): Promise<{ selection: Selection; library: RemoveLibrary }> {
  const library = await readLibrary(clients);
  const picked = pickTarget(settings, library);
  if ('target' in picked) {
    return { selection: { kind: 'selected', target: picked.target }, library };
  }
  if (view && picked.candidates.length > 1) {
    const target = await chooseInteractively(settings, picked.candidates, view, signal);
    return {
      selection: target ? { kind: 'selected', target } : { kind: 'cancelled' },
      library,
    };
  }
  return { selection: { kind: 'refused', ...picked }, library };
}

async function run(settings: RemoveSettings): Promise<void> {
  const controller = abortOnInterrupt();
  const interactive = settings.mode === 'interactive';
  let interacting = interactive;
  const view = interactive
    ? createViewMount(() => {
        if (interacting) {
          controller.abort();
        }
      })
    : undefined;

  try {
    chooseSelector(settings);
    const clients =
      settings.clients ?? createRemoveClients({ home: settings.home, signal: controller.signal });
    const { selection, library } = await resolveSelection(
      settings,
      clients,
      view,
      controller.signal,
    );

    if (selection.kind === 'refused') {
      printRefusal(settings, selection.message, selection.candidates);
      process.exitCode = 1;
      return;
    }
    if (selection.kind === 'cancelled') {
      interacting = false;
      view?.unmount();
      console.error('Cancelled.');
      process.exitCode = INTERRUPTED_EXIT_CODE;
      return;
    }

    const plan = await buildRemovePlan(clients, library, selection.target, {
      keepDebrid: settings.keepDebrid,
    });

    if (view) {
      const approved = await confirmInteractively(settings, plan, view, controller.signal);
      interacting = false;
      view.unmount();
      if (!approved) {
        console.error('Cancelled.');
        process.exitCode = INTERRUPTED_EXIT_CODE;
        return;
      }
    } else if (settings.mode === 'json') {
      if (!settings.yes) {
        printJson(toRemoveJson(plan, undefined, 'Pass --yes to delete the title.'));
        process.exitCode = 1;
        return;
      }
    } else {
      console.log(`Moody Blues CLI v${settings.version} — Remove (Headless)`);
      formatRemovePlan(plan).forEach((line) => console.log(line));
      if (!settings.yes) {
        console.error('✖ Nothing was deleted. Pass --yes to delete the title non-interactively.');
        process.exitCode = 1;
        return;
      }
    }

    if (interactive) {
      console.log(`Moody Blues CLI v${settings.version} — Remove`);
    }
    await execute(settings, clients, plan, controller.signal);
  } finally {
    interacting = false;
    view?.unmount();
  }
}

export async function executeRemove(settings: RemoveSettings): Promise<void> {
  try {
    await run(settings);
  } catch (error) {
    if (settings.mode === 'json') {
      printJson(toRemoveRefusedJson(errorMessage(error)));
      process.exitCode = 1;
      return;
    }
    failWith(error);
  }
}

interface RemoveCommandOptions {
  movie?: number;
  series?: number;
  keepDebrid?: boolean;
  home?: string;
}

export function createRemoveCommand(version: string): Command {
  const removeCmd = new Command('remove');

  removeCmd
    .description('Delete a title from the library, Real-Debrid and Seerr')
    .argument('[query]', 'Text to search in the titles of Radarr and Sonarr')
    .option('--movie <tmdbId>', 'Select the movie with this TMDB id', parseExternalId)
    .option('--series <tvdbId>', 'Select the series with this TVDB id', parseExternalId)
    .option('--keep-debrid', 'Keep the torrents of the title in Real-Debrid')
    .option('--home <path>', 'Moody Blues home directory (defaults to MB_HOME)')
    .action(async (query: string | undefined, options: RemoveCommandOptions) => {
      const globals = removeCmd.optsWithGlobals();
      await executeRemove({
        query,
        movie: options.movie,
        series: options.series,
        keepDebrid: Boolean(options.keepDebrid),
        home: options.home,
        yes: Boolean(globals.yes),
        mode: resolveOutputMode(globals),
        version,
      });
    });

  return removeCmd;
}
