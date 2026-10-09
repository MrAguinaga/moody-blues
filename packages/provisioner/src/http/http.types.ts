export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export type RandomSource = () => number;

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE';

export type QueryValue = string | number | boolean;

export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
  factor: number;
  maxDelayMs: number;
  jitter: number;
}

export interface HttpClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  fetch?: FetchLike;
  retry?: Partial<RetryPolicy>;
  timeoutMs?: number;
  sleep?: Sleep;
  random?: RandomSource;
  signal?: AbortSignal;
}

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
}

export type BodylessRequestOptions = Omit<RequestOptions, 'body'>;

export interface HttpClient {
  request<T = unknown>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>;
  get<T = unknown>(path: string, options?: BodylessRequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, options?: BodylessRequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, options?: BodylessRequestOptions): Promise<T>;
  delete(path: string, options?: BodylessRequestOptions): Promise<void>;
}
