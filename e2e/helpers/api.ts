import type { APIRequestContext } from '@playwright/test';

export interface ApiCallOptions {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function apiJson<T>(
  request: APIRequestContext,
  opts: ApiCallOptions,
): Promise<{ status: number; json: T }> {
  const response = await request.fetch(opts.path, {
    method: opts.method,
    data: opts.body,
    headers: { 'content-type': 'application/json', ...opts.headers },
  });
  return { status: response.status(), json: (await response.json()) as T };
}

export function successEnvelope<T>(data: T, meta?: Record<string, unknown>): { data: T; meta?: Record<string, unknown> } {
  return meta === undefined ? { data } : { data, meta };
}
