import type { HttpMethod } from './http.types';

export interface ValidationFailure {
  propertyName: string;
  errorMessage: string;
  detailedDescription?: string;
}

const TRANSIENT_STATUSES: readonly number[] = [408, 425, 429, 500, 502, 503, 504];

export abstract class ProvisionHttpError extends Error {
  constructor(
    message: string,
    readonly method: HttpMethod,
    readonly url: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class HttpStatusError extends ProvisionHttpError {
  constructor(
    method: HttpMethod,
    url: string,
    readonly status: number,
    readonly bodySnippet: string,
    readonly validation: ValidationFailure[] = [],
    readonly retryAfterMs?: number,
  ) {
    super(describeStatusFailure(method, url, status, bodySnippet, validation), method, url);
  }
}

export class HttpNetworkError extends ProvisionHttpError {
  constructor(method: HttpMethod, url: string, cause: unknown) {
    super(`${method} ${url} failed: ${describeCause(cause)}`, method, url, cause);
  }
}

export class HttpTimeoutError extends ProvisionHttpError {
  constructor(
    method: HttpMethod,
    url: string,
    readonly timeoutMs: number,
    cause?: unknown,
  ) {
    super(`${method} ${url} timed out after ${timeoutMs} ms`, method, url, cause);
  }
}

export class HttpAbortError extends ProvisionHttpError {
  constructor(method: HttpMethod, url: string, cause?: unknown) {
    super(`${method} ${url} was aborted`, method, url, cause);
  }
}

export class ServiceNotReadyError extends ProvisionHttpError {
  constructor(
    readonly service: string,
    readonly waitedMs: number,
    readonly lastError: ProvisionHttpError | undefined,
    method: HttpMethod,
    url: string,
  ) {
    super(
      `${service} was not ready after ${Math.round(waitedMs / 1000)} s` +
        (lastError ? `: ${lastError.message}` : ''),
      method,
      url,
      lastError,
    );
  }
}

export class PollTimeoutError extends Error {
  constructor(
    readonly waitedMs: number,
    readonly lastError: unknown,
  ) {
    super(`Condition not met after ${Math.round(waitedMs / 1000)} s`);
    this.name = 'PollTimeoutError';
  }
}

export function isRetryableStatus(status: number): boolean {
  return TRANSIENT_STATUSES.includes(status);
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof HttpNetworkError || error instanceof HttpTimeoutError) {
    return true;
  }
  return error instanceof HttpStatusError && isRetryableStatus(error.status);
}

export function errorCode(error: unknown): string | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return undefined;
}

function describeCause(cause: unknown): string {
  const code = errorCode(cause);
  const message = cause instanceof Error ? cause.message : String(cause);
  return code && !message.includes(code) ? `${message} (${code})` : message;
}

function describeStatusFailure(
  method: HttpMethod,
  url: string,
  status: number,
  bodySnippet: string,
  validation: ValidationFailure[],
): string {
  const head = `${method} ${url} responded ${status}`;
  if (validation.length > 0) {
    const details = validation
      .map(({ propertyName, errorMessage, detailedDescription }) => {
        const text = detailedDescription
          ? `${errorMessage} (${detailedDescription})`
          : errorMessage;
        return propertyName ? `${propertyName}: ${text}` : text;
      })
      .join('; ');
    return `${head}: ${details}`;
  }
  return bodySnippet ? `${head}: ${bodySnippet}` : head;
}
