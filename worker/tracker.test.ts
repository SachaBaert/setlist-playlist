import { beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS Worker module
import { handleTracker, mergeListens, monthOf, runTracker, TOKEN_KEY } from './tracker.js';
import { recentlyPlayedFixture } from '../src/stats/fixture';

const OWNER = '118489613';
const NOW = Date.parse('2019-08-01T01:17:00Z');

function fakeKV() {
  const data = new Map<string, string>();
  return {
    data,
    async get(k: string, type?: string) {
      const v = data.get(k);
      return v === undefined ? null : type === 'json' ? JSON.parse(v) : v;
    },
    async put(k: string, v: string) {
      data.set(k, v);
    },
    async delete(k: string) {
      data.delete(k);
    },
    async list({ prefix }: { prefix: string }) {
      return { keys: [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

/** Fake Spotify: refresh rotates the token, /me answers per access token, recently-played from the fixture. */
function fakeSpotify(opts: { user?: string; scope?: string; revoked?: boolean } = {}) {
  const calls: string[] = [];
  let n = 0;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.startsWith('https://accounts.spotify.com/api/token')) {
      const form = new URLSearchParams(String(init!.body));
      if (opts.revoked) return reply({ error: 'invalid_grant' }, 400);
      n++;
      return reply({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, scope: opts.scope ?? 'playlist-modify-private user-read-recently-played', from: form.get('refresh_token') });
    }
    const auth = new Headers(init?.headers).get('Authorization') ?? '';
    if (url.endsWith('/me')) return auth.startsWith('Bearer access-') || auth === 'Bearer browser' ? reply({ id: opts.user ?? OWNER }) : reply({}, 401);
    if (url.includes('/me/player/recently-played')) {
      const after = Number(new URL(url).searchParams.get('after') ?? 0);
      const f = recentlyPlayedFixture();
      return reply({ ...f, items: f.items.filter((i) => Date.parse(i.played_at) > after) });
    }
    return reply({}, 404);
  };
  return { fetchFn, calls };
}

const env = (kv = fakeKV()) => ({ TRACKER: kv, OWNER_SPOTIFY_ID: OWNER, SPOTIFY_CLIENT_ID: 'client' });
const req = (method: string, path: string, body?: unknown, token = 'browser') =>
  new Request(`https://worker.test${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

describe('tracker helpers', () => {
  it('buckets by UTC month and dedupes on played_at', () => {
    expect(monthOf('2019-08-01T00:10:00.000Z')).toBe('2019-08');
    const a = { ts: '2019-07-02T12:00:00.000Z', track: 'A' };
    const b = { ts: '2019-07-02T12:05:00.000Z', track: 'B' };
    expect(mergeListens([b], [a, b])).toEqual([a, b]);
  });
});

describe('POST /tracker/start', () => {
  let e: ReturnType<typeof env>;
  beforeEach(() => (e = env()));

  it('stores the rotated token and collects the first plays right away', async () => {
    const { fetchFn } = fakeSpotify();
    const res = await handleTracker(req('POST', '/tracker/start', { refresh_token: 'given' }), e, {}, fetchFn, NOW);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tracking: true, lastCount: 4, lastError: null });
    const record = JSON.parse(e.TRACKER.data.get(TOKEN_KEY)!);
    expect(record.refresh_token).toBe('refresh-1');
    expect(record.cursor).toBe(Date.parse('2019-08-01T00:10:00Z'));
    expect(JSON.parse(e.TRACKER.data.get('listens:2019-07')!).map((l: { track: string }) => l.track)).toEqual(['Long Track 6', 'Echo One', 'Echo One']);
    expect(JSON.parse(e.TRACKER.data.get('listens:2019-08')!)).toEqual([
      { ts: '2019-08-01T00:10:00.000Z', track: 'Tiny Intro', artist: 'Mock Orchestra', album: 'Mock Orchestra album', uri: 'spotify:track:fakeMockOrchestraTinyIntro', ms: 12_000 },
    ]);
  });

  it('refuses other accounts and logins without the scope', async () => {
    const other = await handleTracker(req('POST', '/tracker/start', { refresh_token: 'x' }), e, {}, fakeSpotify({ user: 'someone' }).fetchFn, NOW);
    expect(other.status).toBe(403);
    const noScope = await handleTracker(req('POST', '/tracker/start', { refresh_token: 'x' }), e, {}, fakeSpotify({ scope: 'playlist-modify-private' }).fetchFn, NOW);
    expect(noScope.status).toBe(400);
    expect(e.TRACKER.data.has(TOKEN_KEY)).toBe(false);
  });

  it('says so when KV is not bound yet', async () => {
    const res = await handleTracker(req('GET', '/tracker/status'), { OWNER_SPOTIFY_ID: OWNER }, {}, fakeSpotify().fetchFn, NOW);
    expect(res.status).toBe(503);
  });
});

describe('runTracker (cron)', () => {
  it('rotates the token, asks only for plays after the cursor and dedupes', async () => {
    const e = env();
    const s = fakeSpotify();
    await handleTracker(req('POST', '/tracker/start', { refresh_token: 'given' }), e, {}, s.fetchFn, NOW);
    // Pretend the cursor is older, so the fixture's newest plays come back again.
    const rec = JSON.parse(e.TRACKER.data.get(TOKEN_KEY)!);
    e.TRACKER.data.set(TOKEN_KEY, JSON.stringify({ ...rec, cursor: Date.parse('2019-07-02T12:00:00Z') }));
    await runTracker(e, s.fetchFn, NOW + 3_600_000);
    const after = JSON.parse(e.TRACKER.data.get(TOKEN_KEY)!);
    expect(after.refresh_token).toBe('refresh-2');
    expect(after.lastCount).toBe(0); // "Echo One" 12:05 and "Tiny Intro" were already stored
    expect(s.calls.at(-1)).toContain(`after=${Date.parse('2019-07-02T12:00:00Z')}`);
    expect(JSON.parse(e.TRACKER.data.get('listens:2019-07')!)).toHaveLength(3);
  });

  it('stops when the token was revoked', async () => {
    const e = env();
    e.TRACKER.data.set(TOKEN_KEY, JSON.stringify({ refresh_token: 'old', cursor: null }));
    await runTracker(e, fakeSpotify({ revoked: true }).fetchFn, NOW);
    expect(JSON.parse(e.TRACKER.data.get(TOKEN_KEY)!)).toMatchObject({ refresh_token: '', lastError: expect.stringContaining('invalid_grant') });
  });
});

describe('reading and stopping', () => {
  it('returns listens after `since` to the owner only, and stop removes the token', async () => {
    const e = env();
    const s = fakeSpotify();
    await handleTracker(req('POST', '/tracker/start', { refresh_token: 'given' }), e, {}, s.fetchFn, NOW);

    const res = await handleTracker(req('GET', `/tracker/listens?since=${Date.parse('2019-07-02T12:00:00Z')}`), e, {}, s.fetchFn, NOW);
    const body = await res.json();
    expect(body.listens.map((l: { track: string }) => l.track)).toEqual(['Echo One', 'Tiny Intro']);
    expect(body.tracking).toBe(true);

    const stranger = await handleTracker(req('GET', '/tracker/listens?since=0', undefined, 'nope'), e, {}, s.fetchFn, NOW);
    expect(stranger.status).toBe(401);

    const stop = await handleTracker(req('POST', '/tracker/stop'), e, {}, s.fetchFn, NOW);
    expect(await stop.json()).toMatchObject({ tracking: false });
    expect(JSON.parse(e.TRACKER.data.get(TOKEN_KEY)!).refresh_token).toBe('');
    await runTracker(e, s.fetchFn, NOW); // no token: nothing happens
    expect(e.TRACKER.data.get('listens:2019-08')).toBeDefined();
  });
});
