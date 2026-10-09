import {
  abortableSleep,
  computeDelay,
  DEFAULT_RETRY_POLICY,
  parseRetryAfter,
} from './backoff.http';
import {
  errorCode,
  HttpAbortError,
  HttpNetworkError,
  HttpStatusError,
  HttpTimeoutError,
  isRetryableStatus,
  ProvisionHttpError,
  type ValidationFailure,
} from './http.errors';
import type {
  HttpClient,
  HttpClientOptions,
  HttpMethod,
  RequestOptions,
  RetryPolicy,
} from './http.types';

const DEFAULT_TIMEOUT_MS = 30_000;
const BODY_SNIPPET_LENGTH = 200;
const RESET_BEFORE_RESPONSE_CODES: readonly string[] = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET'];
const IDEMPOTENT_METHODS: readonly HttpMethod[] = ['GET', 'HEAD', 'PUT', 'DELETE'];
const POST_RETRYABLE_STATUSES: readonly number[] = [429, 503];

function sanitizeUrl(baseUrl: string, path: string): URL {
  const url = new URL(path.replace(/^\//, ''), baseUrl.replace(/\/?$/, '/'));
  url.username = '';
  url.password = '';
  return url;
}

function displayUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function isRetryableFailure(method: HttpMethod, error: ProvisionHttpError): boolean {
  const idempotent = IDEMPOTENT_METHODS.includes(method);
  if (error instanceof HttpStatusError) {
    return idempotent
      ? isRetryableStatus(error.status)
      : POST_RETRYABLE_STATUSES.includes(error.status);
  }
  if (error instanceof HttpTimeoutError) {
    return idempotent;
  }
  if (error instanceof HttpNetworkError) {
    const code = errorCode(error.cause);
    return idempotent || (code !== undefined && RESET_BEFORE_RESPONSE_CODES.includes(code));
  }
  return false;
}

function serializeBody(body: unknown): string | undefined {
  if (body === undefined) {
    return undefined;
  }
  return body instanceof URLSearchParams ? body.toString() : JSON.stringify(body);
}

function parseValidation(text: string): ValidationFailure[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry): ValidationFailure[] => {
      if (typeof entry !== 'object' || entry === null || typeof entry.errorMessage !== 'string') {
        return [];
      }
      const failure: ValidationFailure = {
        propertyName: typeof entry.propertyName === 'string' ? entry.propertyName : '',
        errorMessage: entry.errorMessage,
      };
      if (typeof entry.detailedDescription === 'string' && entry.detailedDescription) {
        failure.detailedDescription = entry.detailedDescription;
      }
      return [failure];
    });
  } catch {
    return [];
  }
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? abortableSleep;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultRetry: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retry };

  async function attemptOnce<T>(
    method: HttpMethod,
    url: URL,
    request: RequestOptions,
    callerSignals: AbortSignal[],
  ): Promise<T> {
    const shown = displayUrl(url);
    const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
    const timeout = AbortSignal.timeout(timeoutMs);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
      ...request.headers,
    };
    if (request.body !== undefined) {
      headers['Content-Type'] =
        request.body instanceof URLSearchParams
          ? 'application/x-www-form-urlencoded'
          : 'application/json';
    }

    const fail = (error: unknown): ProvisionHttpError => {
      if (callerSignals.some((signal) => signal.aborted)) {
        return new HttpAbortError(method, shown, error);
      }
      if (timeout.aborted) {
        return new HttpTimeoutError(method, shown, timeoutMs, error);
      }
      return new HttpNetworkError(method, shown, error);
    };

    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers,
        body: serializeBody(request.body),
        signal: AbortSignal.any([...callerSignals, timeout]),
      });
      text = await response.text();
    } catch (error) {
      throw fail(error);
    }

    if (!response.ok) {
      throw new HttpStatusError(
        method,
        shown,
        response.status,
        text.slice(0, BODY_SNIPPET_LENGTH),
        response.status === 400 ? parseValidation(text) : [],
        parseRetryAfter(response.headers.get('retry-after')),
      );
    }
    if (text.trim() === '') {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpStatusError(
        method,
        shown,
        response.status,
        `non-JSON response body: ${text.slice(0, BODY_SNIPPET_LENGTH)}`,
      );
    }
  }

  async function request<T>(
    method: HttpMethod,
    path: string,
    requestOptions: RequestOptions = {},
  ): Promise<T> {
    const url = sanitizeUrl(options.baseUrl, path);
    for (const [key, value] of Object.entries(requestOptions.query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const policy: RetryPolicy = { ...defaultRetry, ...requestOptions.retry };
    const callerSignals = [options.signal, requestOptions.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    );
    const shown = displayUrl(url);

    for (let attempt = 1; ; attempt += 1) {
      if (callerSignals.some((signal) => signal.aborted)) {
        throw new HttpAbortError(method, shown);
      }
      try {
        return await attemptOnce<T>(method, url, requestOptions, callerSignals);
      } catch (error) {
        if (
          !(error instanceof ProvisionHttpError) ||
          !isRetryableFailure(method, error) ||
          attempt >= policy.attempts
        ) {
          throw error;
        }
        const retryAfter = error instanceof HttpStatusError ? error.retryAfterMs : undefined;
        const delay = Math.max(computeDelay(attempt, policy, options.random), retryAfter ?? 0);
        try {
          await sleep(delay, AbortSignal.any(callerSignals));
        } catch (sleepError) {
          throw new HttpAbortError(method, shown, sleepError);
        }
        if (callerSignals.some((signal) => signal.aborted)) {
          throw new HttpAbortError(method, shown);
        }
      }
    }
  }

  return {
    request,
    get: (path, requestOptions) => request('GET', path, requestOptions),
    post: (path, body, requestOptions) => request('POST', path, { ...requestOptions, body }),
    put: (path, body, requestOptions) => request('PUT', path, { ...requestOptions, body }),
    delete: async (path, requestOptions) => {
      await request('DELETE', path, requestOptions);
    },
  };
}
