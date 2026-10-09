import type { FetchLike } from '../http/http.types';

export interface FakeRequest {
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
  hang?: boolean;
}

export type FakeOutcome = FakeReply | Error;

export type FakeHandler = (request: FakeRequest) => FakeOutcome | Promise<FakeOutcome>;

export type FakeRoute = FakeOutcome | FakeHandler;

export interface FakeFetch {
  fetch: FetchLike;
  requests: FakeRequest[];
  on(method: string, path: string, ...routes: FakeRoute[]): void;
  count(method: string, path?: string): number;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
}

function toResponse(reply: FakeReply, signal: AbortSignal | null | undefined): Promise<Response> {
  if (reply.hang) {
    return new Promise((_resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(signal));
        return;
      }
      signal?.addEventListener('abort', () => reject(abortError(signal)), { once: true });
    });
  }
  const status = reply.status ?? 200;
  const headers = new Headers(reply.headers);
  let payload: string | undefined = reply.text;
  if (payload === undefined && reply.body !== undefined) {
    payload = JSON.stringify(reply.body);
    headers.set('Content-Type', 'application/json');
  }
  const emptyStatus = status === 204 || status === 304;
  return Promise.resolve(new Response(emptyStatus ? null : payload, { status, headers }));
}

function parseBody(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw === '') {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function toFakeRequest(input: string, init?: RequestInit): FakeRequest {
  const url = new URL(input);
  return {
    method: (init?.method ?? 'GET').toUpperCase(),
    url: url.toString(),
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(new Headers(init?.headers)),
    body: parseBody(init?.body),
  };
}

export function createFakeFetch(): FakeFetch {
  const routes = new Map<string, FakeRoute[]>();
  const served = new Map<string, number>();
  const requests: FakeRequest[] = [];

  const fetchImpl: FetchLike = async (input, init) => {
    const request = toFakeRequest(input, init);
    const { method } = request;
    requests.push(request);

    if (init?.signal?.aborted) {
      throw abortError(init.signal);
    }

    const key = `${method} ${request.path}`;
    const sequence = routes.get(key);
    if (!sequence) {
      return new Response(JSON.stringify({ message: `No fake route for ${key}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const position = served.get(key) ?? 0;
    served.set(key, position + 1);
    const route = sequence[Math.min(position, sequence.length - 1)] as FakeRoute;
    const outcome = typeof route === 'function' ? await route(request) : route;
    if (outcome instanceof Error) {
      throw outcome;
    }
    return toResponse(outcome, init?.signal);
  };

  return {
    fetch: fetchImpl,
    requests,
    on: (method, path, ...sequence) => {
      routes.set(`${method.toUpperCase()} ${path}`, sequence);
      served.delete(`${method.toUpperCase()} ${path}`);
    },
    count: (method, path) =>
      requests.filter(
        (request) =>
          request.method === method.toUpperCase() && (path === undefined || request.path === path),
      ).length,
  };
}
