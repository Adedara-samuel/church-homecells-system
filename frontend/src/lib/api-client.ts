'use client';

const DEFAULT_API_PREFIX = '/api/v1';

/**
 * Normalises `NEXT_PUBLIC_API_URL` so a stray trailing slash cannot produce a
 * double-slash request path. `https://api.example.com//auth/login` is not the same
 * URL as `/auth/login`: Vercel answers it with a 308 to the collapsed path, and a
 * redirect on a CORS preflight is rejected outright by the browser.
 *
 * A value with no path (just an origin) also gets the default API prefix appended,
 * since every route lives behind it.
 */
function resolveApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!configured) return `http://localhost:4000${DEFAULT_API_PREFIX}`;

  const withoutTrailingSlash = configured.replace(/\/+$/, '');
  try {
    const url = new URL(withoutTrailingSlash);
    if (url.pathname === '/' || url.pathname === '') {
      return `${url.origin}${DEFAULT_API_PREFIX}`;
    }
  } catch {
    // Not an absolute URL (e.g. a relative "/api/v1" proxied by the frontend) —
    // the trailing-slash trim above is all that is needed.
  }
  return withoutTrailingSlash;
}

const API_BASE = resolveApiBase();

const ACCESS_TOKEN_KEY = 'chms.accessToken';
const REFRESH_TOKEN_KEY = 'chms.refreshToken';

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

/** Every non-2xx response becomes one of these, so callers handle a single shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
    this.requestId = payload.requestId;
  }

  /** Field-level messages, ready to hand to React Hook Form. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const issue of this.details as { field?: string; message?: string }[]) {
      if (issue.field && issue.message) out[issue.field] = issue.message;
    }
    return out;
  }
}

export const tokenStore = {
  get access(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACCESS_TOKEN_KEY);
  },
  get refresh(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  set(access: string, refresh?: string) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ACCESS_TOKEN_KEY, access);
    if (refresh) window.localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  },
  clear() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ApiResponse<T> {
  data: T;
  meta?: { pagination?: PaginationMeta } & Record<string, unknown>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Skip the Authorization header (login, password reset, webhook status). */
  anonymous?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const href = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  // A relative base ("/api/v1") is only resolvable against the current document.
  const url = new URL(
    href,
    typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  );
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Single-flight refresh.
 *
 * When several queries hit a 401 at once, only the first triggers a refresh; the rest
 * await the same promise and then retry, so one expired token cannot produce a burst
 * of refresh calls (each of which would rotate the token and invalidate the others).
 */
let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refreshToken: tokenStore.refresh ?? undefined }),
      });
      if (!response.ok) return false;

      const json = (await response.json()) as {
        data: { accessToken: string; refreshToken?: string };
      };
      tokenStore.set(json.data.accessToken, json.data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so concurrent callers all observe this result.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();

  return refreshPromise;
}

function onUnauthenticated(): void {
  tokenStore.clear();
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
  }
}

async function execute<T>(path: string, options: RequestOptions, retrying = false): Promise<ApiResponse<T>> {
  const { method = 'GET', body, query, signal, anonymous } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (!anonymous && tokenStore.access) {
    headers.Authorization = `Bearer ${tokenStore.access}`;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: 'include',
      signal,
      body:
        body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  if (response.status === 204) {
    return { data: undefined as T };
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    // One transparent refresh-and-retry, then give up and send the user to login.
    if (response.status === 401 && !anonymous && !retrying) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return execute<T>(path, options, true);
      onUnauthenticated();
    }

    throw new ApiError(
      response.status,
      (payload as { error?: ApiErrorPayload })?.error ?? {
        code: 'UNKNOWN_ERROR',
        message: response.statusText || 'The request failed.',
      },
    );
  }

  return payload as ApiResponse<T>;
}

export const api = {
  get: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    execute<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method'> = {}) =>
    execute<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method'> = {}) =>
    execute<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method'> = {}) =>
    execute<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method'> = {}) =>
    execute<T>(path, { ...options, method: 'DELETE', body }),

  /** Multipart upload — the browser sets the boundary, so no Content-Type here. */
  async upload(file: File, folder: 'members' | 'receipts' | 'documents') {
    const form = new FormData();
    form.append('file', file);
    form.append('folder', folder);
    const result = await execute<{
      url: string;
      publicId: string;
      format: string;
      bytes: number;
      provider: string;
    }>('/uploads', { method: 'POST', body: form });
    return result.data;
  },

  /** Streams an export to the browser as a file download. */
  async download(path: string, query: Record<string, string | number | undefined>, filename: string) {
    const response = await fetch(buildUrl(path, query), {
      headers: tokenStore.access ? { Authorization: `Bearer ${tokenStore.access}` } : {},
      credentials: 'include',
    });
    if (!response.ok) {
      throw new ApiError(response.status, {
        code: 'EXPORT_FAILED',
        message: 'The export could not be generated.',
      });
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
};

export { API_BASE };
