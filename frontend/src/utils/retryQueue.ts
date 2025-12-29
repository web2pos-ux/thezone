// Simple retry queue for table-map PATCH requests (status/current-order)
// - Stores failed requests in localStorage
// - Retries on interval, window focus, and when back online

type QueuedReq = {
  id: string;
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string> | undefined;
  retryCount: number;
  nextAttemptAt: number; // epoch ms
  createdAt: number;
};

const STORAGE_KEY = 'tableMapRetryQueue_v1';
const MAX_RETRIES = 8;
const BASE_DELAY_MS = 5000; // 5s

function now(): number {
  return Date.now();
}

function loadQueue(): QueuedReq[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedReq[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(q)); } catch {}
}

export function enqueueTableMapPatch(url: string, init?: RequestInit): void {
  try {
    const headers: Record<string, string> | undefined = init && (init.headers as any) ? Object.fromEntries(Object.entries(init.headers as any)) : undefined;
    const body = (init && typeof init.body === 'string') ? init.body : (init && init.body ? JSON.stringify(init.body) : null);
    const item: QueuedReq = {
      id: `${now()}_${Math.random().toString(36).slice(2, 8)}`,
      url,
      method: (init && (init.method || 'PATCH')) || 'PATCH',
      body,
      headers,
      retryCount: 0,
      nextAttemptAt: now() + 1000,
      createdAt: now(),
    };
    const q = loadQueue();
    q.push(item);
    saveQueue(q);
  } catch {}
}

async function attempt(item: QueuedReq): Promise<boolean> {
  try {
    const res = await fetch(item.url, {
      method: item.method,
      headers: item.headers,
      body: item.body,
    });
    return res.ok;
  } catch {
    return false;
  }
}

function scheduleNext(retryCount: number): number {
  const jitter = Math.floor(Math.random() * 800); // up to 0.8s
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, Math.max(0, retryCount - 1)), 120000); // cap 2m
  return now() + delay + jitter;
}

let flushTimer: number | null = null;
let installed = false;

export async function flushRetryQueue(): Promise<void> {
  const q = loadQueue();
  if (q.length === 0) return;
  const nowMs = now();
  const nextQ: QueuedReq[] = [];
  for (const item of q) {
    if (item.retryCount >= MAX_RETRIES) {
      // Give up but keep last state for inspection; alternatively drop
      nextQ.push(item);
      continue;
    }
    if (item.nextAttemptAt > nowMs) {
      nextQ.push(item);
      continue;
    }
    const ok = await attempt(item);
    if (!ok) {
      nextQ.push({
        ...item,
        retryCount: item.retryCount + 1,
        nextAttemptAt: scheduleNext(item.retryCount + 1),
      });
    }
  }
  saveQueue(nextQ);
}

function startInterval(): void {
  stopInterval();
  // retry every 15s
  flushTimer = window.setInterval(() => { flushRetryQueue().catch(() => {}); }, 15000);
}

function stopInterval(): void {
  if (flushTimer != null) { window.clearInterval(flushTimer); flushTimer = null; }
}

function isTableMapPatch(url: string, method?: string): boolean {
  const m = (method || 'PATCH').toUpperCase();
  if (m !== 'PATCH') return false;
  // accept both absolute and relative URLs
  return (
    url.includes('/table-map/elements/') && (url.endsWith('/status') || url.endsWith('/current-order'))
  );
}

export function installTableMapRetryHook(): void {
  if (installed) return;
  installed = true;
  try {
    const origFetch = window.fetch.bind(window);
    const wrappedFetch: typeof window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
      const method = init?.method || (typeof input !== 'string' && !(input instanceof URL) ? ((input as Request).method || 'GET') : 'GET');

      const shouldWatch = isTableMapPatch(url, method);
      try {
        const res = await origFetch(input, init);
        if (shouldWatch && !res.ok) {
          // enqueue failed response
          enqueueTableMapPatch(url, init);
        }
        return res;
      } catch (e) {
        if (shouldWatch) {
          enqueueTableMapPatch(url, init);
          // return accepted to avoid breaking optimistic flows
          return new Response('{}', { status: 202, statusText: 'Queued' });
        }
        throw e;
      }
    };
    window.fetch = wrappedFetch;
  } catch {}

  // retry triggers
  window.addEventListener('online', () => { flushRetryQueue().catch(() => {}); });
  window.addEventListener('focus', () => { flushRetryQueue().catch(() => {}); });
  startInterval();
  // initial drain
  flushRetryQueue().catch(() => {});
}

export function uninstallTableMapRetryHook(): void {
  stopInterval();
  // Not restoring fetch here to keep it simple
}


