// Client for the Worker's live history tracker (see worker/tracker.js).
import { WORKER_URL } from './setlistfm';
import type { CachedStream, Listen } from './stats/cache';

export interface TrackerStatus {
  tracking: boolean;
  startedAt: string | null;
  lastRun: string | null;
  lastCount: number | null;
  lastError: string | null;
}

export class TrackerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const url = (path: string) => `${WORKER_URL.replace(/\/$/, '')}/tracker/${path}`;

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(url(path), init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new TrackerError(data.error ?? `Tracker request failed (${res.status})`, res.status);
  return data as T;
}

/** Called after the tracker login: the Worker checks the account and keeps the token. */
export const startTracker = (refreshToken: string) =>
  call<TrackerStatus>('start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) });

const auth = (accessToken: string) => ({ headers: { Authorization: `Bearer ${accessToken}` } });

export const stopTracker = (accessToken: string) => call<TrackerStatus>('stop', { method: 'POST', ...auth(accessToken) });
export const trackerStatus = (accessToken: string) => call<TrackerStatus>('status', auth(accessToken));
export const trackedListens = (accessToken: string, since: number) =>
  call<TrackerStatus & { listens: Listen[] }>(`listens?since=${Math.floor(since)}`, auth(accessToken));

// --- Copy of the history on the Worker, so every browser can load it ---
export interface HistoryMeta {
  savedAt: string;
  streams: number;
  exportEnd: string;
  bytes: number;
}

const pipe = (data: BodyInit, stream: CompressionStream | DecompressionStream) => new Response(new Response(data).body!.pipeThrough(stream));

/** Upload the (already slimmed) export plays, gzipped in the browser. */
export async function uploadHistory(accessToken: string, streams: CachedStream[], exportEnd: string): Promise<HistoryMeta> {
  const body = await pipe(JSON.stringify(streams), new CompressionStream('gzip')).arrayBuffer();
  return call<HistoryMeta>(`history?streams=${streams.length}&exportEnd=${encodeURIComponent(exportEnd)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/gzip' },
    body,
  });
}

/** null if nothing is stored. */
export async function historyMeta(accessToken: string): Promise<HistoryMeta | null> {
  try {
    return await call<HistoryMeta>('history?meta=1', auth(accessToken));
  } catch (err) {
    if (err instanceof TrackerError && err.status === 404) return null;
    throw err;
  }
}

export async function downloadHistory(accessToken: string): Promise<CachedStream[]> {
  const res = await fetch(url('history'), auth(accessToken));
  if (!res.ok) throw new TrackerError(`Could not load your saved history (${res.status})`, res.status);
  return pipe(await res.arrayBuffer(), new DecompressionStream('gzip')).json();
}

export const deleteHistory = (accessToken: string) => call<{ deleted: boolean }>('history', { method: 'DELETE', ...auth(accessToken) });
