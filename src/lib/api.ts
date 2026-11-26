const TOKEN_KEY = 'railpulse_access_token';
const DEFAULT_TIMEOUT_MS = 15000;

export function getStoredToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

export class ApiError extends Error {
  status: number;
  requestId?: string;
  constructor(status: number, message: string, requestId?: string) {
    super(message);
    this.status = status;
    this.requestId = requestId;
  }
}

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

function isRetryableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

async function fetchWithTimeout(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal | null,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      window.clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries, signal, ...fetchInit } = options;
  const method = (fetchInit.method || 'GET').toUpperCase();
  const maxRetries = retries ?? (method === 'GET' ? 1 : 0);

  const token = getStoredToken();
  const headers = new Headers(fetchInit.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(fetchInit.body instanceof FormData) && fetchInit.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let attempt = 0;
  while (true) {
    try {
      const res = await fetchWithTimeout(
        path,
        { ...fetchInit, headers, credentials: 'include' },
        timeoutMs,
        signal,
      );

      if (!res.ok) {
        if (attempt < maxRetries && isRetryableStatus(res.status)) {
          attempt += 1;
          await new Promise((r) => window.setTimeout(r, 300 * attempt));
          continue;
        }
        const reqId = res.headers.get('X-Request-ID') || undefined;
        let detail = `Request failed (${res.status})`;
        try {
          const data = await res.json();
          if (data?.detail) {
            detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
          }
        } catch {
          // ignore non-json body
        }
        throw new ApiError(res.status, detail, reqId);
      }

      return res.json() as Promise<T>;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (signal?.aborted) throw err;
        if (attempt < maxRetries) {
          attempt += 1;
          await new Promise((r) => window.setTimeout(r, 300 * attempt));
          continue;
        }
        throw new ApiError(408, 'Request timed out. Please check your connection and try again.');
      }
      if (attempt < maxRetries) {
        attempt += 1;
        await new Promise((r) => window.setTimeout(r, 300 * attempt));
        continue;
      }
      throw new ApiError(0, 'Unable to connect to the server. Please check your network and try again.');
    }
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { method: 'GET', ...options }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, {
      method: 'POST',
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),
  downloadBlob: async (path: string, signal?: AbortSignal): Promise<Blob> => {
    const token = getStoredToken();
    const res = await fetchWithTimeout(
      path,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      },
      DEFAULT_TIMEOUT_MS,
      signal,
    );
    if (!res.ok) {
      throw new ApiError(res.status, `Download failed (${res.status})`);
    }
    return res.blob();
  },
};
