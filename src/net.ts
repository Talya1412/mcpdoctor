// mcpdoctor — HTTP helpers on global fetch (Node 18+).
// getJson: GET + JSON parse, timeout, retries, in-memory cache.
// pool: bounded-concurrency parallel map preserving order.

const CACHE = new Map<string, unknown>();
const TIMEOUT_MS = 10_000;
const RETRIES = 2;
const BACKOFF_MS = 600;

export interface GetJsonOptions {
  /** HTTP method, defaults to GET */
  method?: string;
  /** request body (string). JSON stringified by caller when needed. */
  body?: string;
  /** request headers */
  headers?: Record<string, string>;
  /** override default timeout (ms) */
  timeoutMs?: number;
  /** bypass cache */
  noCache?: boolean;
}

/** Marker thrown when a request fails (network/timeout/non-2xx). */
export class HttpError extends Error {
  status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

async function doFetch(url: string, opts: GetJsonOptions): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined && headers["content-type"] === undefined) {
      headers["content-type"] = "application/json";
    }
    return await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(
  url: string,
  opts: GetJsonOptions = {}
): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await doFetch(url, opts);
      if (!res.ok) {
        throw new HttpError(`HTTP ${res.status} for ${url}`, res.status);
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) {
        await sleep(BACKOFF_MS * (attempt + 1));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new HttpError(`request failed: ${String(lastErr)}`, null);
}

/**
 * GET and parse JSON. Throws HttpError on non-2xx / network failure.
 * Caches identical URLs in-memory for the process lifetime.
 */
export async function getJson<T = unknown>(
  url: string,
  opts: GetJsonOptions = {}
): Promise<T> {
  if (!opts.noCache && CACHE.has(url)) {
    return CACHE.get(url) as T;
  }
  const text = await fetchText(url, opts);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(`invalid JSON from ${url}`, null);
  }
  CACHE.set(url, parsed);
  return parsed as T;
}

export function clearCache(): void {
  CACHE.clear();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map `items` through `worker` with bounded concurrency, preserving order.
 * Rejects if any worker rejects (results are order-preserving).
 */
export async function pool<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = 8
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= items.length) break;
      const item = items[idx]!;
      results[idx] = await worker(item, idx);
    }
  }

  const workers: Promise<void>[] = [];
  const n = Math.max(1, Math.min(concurrency, items.length));
  for (let i = 0; i < n; i++) {
    workers.push(runWorker());
  }
  await Promise.all(workers);
  return results;
}
