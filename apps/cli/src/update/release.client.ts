import { normalizeVersion } from './semver.utils';
import type { ReleaseInfo } from './update.types';

export const LATEST_RELEASE_URL =
  'https://api.github.com/repos/MrAguinaga/moody-blues/releases/latest';
export const RELEASE_REQUEST_TIMEOUT_MS = 15_000;

export class UpdateCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateCheckError';
  }
}

export interface FetchLatestReleaseOptions {
  cliVersion: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? error.cause.message : undefined;
    return cause ?? error.message;
  }
  return String(error);
}

function describeRateLimit(response: Response): string {
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  const when = reset > 0 ? ` The limit resets at ${new Date(reset * 1000).toISOString()}.` : '';
  return `GitHub rejected the request because the unauthenticated rate limit was reached.${when}`;
}

function parseRelease(payload: unknown): ReleaseInfo {
  const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const tag = record.tag_name;
  if (typeof tag !== 'string' || tag.length === 0) {
    throw new UpdateCheckError('GitHub returned a release without a tag name.');
  }
  const version = normalizeVersion(tag);
  if (!version) {
    throw new UpdateCheckError(`The latest release tag "${tag}" is not a valid version.`);
  }
  return {
    tag,
    version,
    url: typeof record.html_url === 'string' ? record.html_url : '',
    body: typeof record.body === 'string' ? record.body.trim() : '',
  };
}

export async function fetchLatestRelease(
  options: FetchLatestReleaseOptions,
): Promise<ReleaseInfo | undefined> {
  const request = options.fetch ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? RELEASE_REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await request(LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `moody-blues-cli/${options.cliVersion}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? error;
    }
    const reason = timeout.aborted ? 'the request timed out' : describeNetworkError(error);
    throw new UpdateCheckError(`Could not reach GitHub to look for releases: ${reason}.`);
  }

  if (response.status === 404) {
    return undefined;
  }
  if (response.status === 403 || response.status === 429) {
    throw new UpdateCheckError(describeRateLimit(response));
  }
  if (!response.ok) {
    throw new UpdateCheckError(`GitHub answered the release request with HTTP ${response.status}.`);
  }

  try {
    return parseRelease(await response.json());
  } catch (error) {
    if (error instanceof UpdateCheckError) {
      throw error;
    }
    throw new UpdateCheckError('GitHub returned a release response that is not valid JSON.');
  }
}
