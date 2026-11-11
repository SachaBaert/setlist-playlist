// Client for the Worker's live history tracker (see worker/tracker.js).
import { WORKER_URL } from './setlistfm';
import type { Listen } from './stats/cache';

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
