// Live history tracker: keeps Sacha's listening history growing between exports.
//   POST /tracker/start   {refresh_token}  token from a login with user-read-recently-played;
//                                          only accepted for OWNER_SPOTIFY_ID
//   POST /tracker/stop                     deletes the stored token (Bearer: owner's access token)
//   GET  /tracker/status                   tracking on/off, last run (Bearer)
//   GET  /tracker/listens?since=<ms>       tracked plays after `since` (Bearer)
//   cron (hourly)                          refresh token, GET /me/player/recently-played, append to KV
// KV (binding TRACKER): `tracker:token` = {refresh_token, cursor, startedAt, lastRun, lastCount, lastError},
// `listens:YYYY-MM` (UTC month) = [{ts, track, artist, album, uri, ms}] sorted by ts, deduped on ts.
// No ms_played or skips from Spotify here: every listen is a play of 30 s+, `ms` is the track length.

export const TOKEN_KEY = 'tracker:token';
const API = 'https://api.spotify.com/v1';
const SCOPE = 'user-read-recently-played';
const OWNER_CHECK_MS = 5 * 60_000;

/** Recently-played items → listens (music only). */
export function fromRecentlyPlayed(items) {
  const out = [];
  for (const it of items ?? []) {
    const t = it?.track;
    if (!t || t.type === 'episode' || !t.name || !it.played_at || Number.isNaN(Date.parse(it.played_at))) continue;
    out.push({
      ts: new Date(Date.parse(it.played_at)).toISOString(),
      track: t.name,
      artist: t.artists?.[0]?.name ?? '',
      album: t.album?.name ?? '',
      uri: t.uri ?? null,
      ms: Number(t.duration_ms) || 0,
    });
  }
  return out;
}

export const monthOf = (ts) => new Date(typeof ts === 'number' ? ts : Date.parse(ts)).toISOString().slice(0, 7);

/** Merge, dedupe on played_at, sort by time. */
export function mergeListens(existing, incoming) {
  const byTs = new Map();
  for (const l of [...(existing ?? []), ...incoming]) byTs.set(l.ts, l);
  return [...byTs.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

async function refresh(refreshToken, env, fetchFn) {
  const res = await fetchFn('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: env.SPOTIFY_CLIENT_ID }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error(`Spotify token refresh failed (${data.error ?? res.status})`);
    err.revoked = data.error === 'invalid_grant';
    throw err;
  }
  return data; // access_token, refresh_token (rotated, sometimes absent), scope
}

async function spotifyGet(path, accessToken, fetchFn) {
  const res = await fetchFn(`${API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Spotify ${path.split('?')[0]} returned ${res.status}`);
  return res.json();
}

/** Fetch plays after the cursor and append them to the month keys. Returns the number of new listens. */
async function collect(env, accessToken, record, fetchFn, now) {
  const q = new URLSearchParams({ limit: '50' });
  if (record.cursor) q.set('after', String(record.cursor));
  const data = await spotifyGet(`/me/player/recently-played?${q}`, accessToken, fetchFn);
  const listens = fromRecentlyPlayed(data.items);
  const byMonth = new Map();
  for (const l of listens) {
    const m = monthOf(l.ts);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(l);
  }
  let added = 0;
  for (const [m, list] of byMonth) {
    const key = `listens:${m}`;
    const existing = (await env.TRACKER.get(key, 'json')) ?? [];
    const merged = mergeListens(existing, list);
    added += merged.length - existing.length;
    if (merged.length !== existing.length) await env.TRACKER.put(key, JSON.stringify(merged));
  }
  const newest = Math.max(record.cursor ?? 0, ...listens.map((l) => Date.parse(l.ts)));
  return { ...record, cursor: newest || record.cursor || null, lastRun: new Date(now).toISOString(), lastCount: added, lastError: null };
}

/** Cron: one tracker round. Never throws; errors land in the record for /tracker/status. */
export async function runTracker(env, fetchFn = fetch, now = Date.now()) {
  if (!env.TRACKER) return;
  const record = await env.TRACKER.get(TOKEN_KEY, 'json');
  if (!record?.refresh_token) return;
  let current = record;
  try {
    const tok = await refresh(record.refresh_token, env, fetchFn);
    // Store the rotated refresh token right away: the old one may already be invalid.
    current = { ...record, refresh_token: tok.refresh_token ?? record.refresh_token };
    if (current.refresh_token !== record.refresh_token) await env.TRACKER.put(TOKEN_KEY, JSON.stringify(current));
    current = await collect(env, tok.access_token, current, fetchFn, now);
  } catch (err) {
    current = { ...current, lastRun: new Date(now).toISOString(), lastError: err.message };
    if (err.revoked) current.refresh_token = ''; // revoked at spotify.com/account/apps: tracking stops
  }
  await env.TRACKER.put(TOKEN_KEY, JSON.stringify(current));
}

// Briefly remember which access tokens belong to the owner (per isolate).
const ownerChecks = new Map();

async function isOwner(request, env, fetchFn, now) {
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || token.length > 1000) return false;
  const hit = ownerChecks.get(token);
  if (hit && hit > now) return true;
  const res = await fetchFn(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return false;
  const me = await res.json().catch(() => ({}));
  if (me.id !== env.OWNER_SPOTIFY_ID) return false;
  if (ownerChecks.size > 50) ownerChecks.clear();
  ownerChecks.set(token, now + OWNER_CHECK_MS);
  return true;
}

function status(record) {
  return {
    tracking: Boolean(record?.refresh_token),
    startedAt: record?.startedAt ?? null,
    lastRun: record?.lastRun ?? null,
    lastCount: record?.lastCount ?? null,
    lastError: record?.lastError ?? null,
  };
}

const json = (body, code, headers) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json', ...headers } });

/** Handles /tracker/* requests. */
export async function handleTracker(request, env, cors, fetchFn = fetch, now = Date.now()) {
  if (!env.TRACKER) return json({ error: 'The tracker is not set up on the Worker yet' }, 503, cors);
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;

  if (route === 'POST /tracker/start') {
    const body = await request.json().catch(() => ({}));
    const given = typeof body.refresh_token === 'string' ? body.refresh_token : '';
    if (!given || given.length > 1000) return json({ error: 'Missing refresh token' }, 400, cors);
    let tok;
    try {
      tok = await refresh(given, env, fetchFn);
    } catch (err) {
      return json({ error: err.message }, 400, cors);
    }
    const me = await spotifyGet('/me', tok.access_token, fetchFn).catch(() => ({}));
    if (me.id !== env.OWNER_SPOTIFY_ID) return json({ error: 'This tracker only works for its owner' }, 403, cors);
    if (!(tok.scope ?? '').split(' ').includes(SCOPE)) return json({ error: `Login is missing the ${SCOPE} scope` }, 400, cors);
    const old = (await env.TRACKER.get(TOKEN_KEY, 'json')) ?? {};
    let record = { ...old, refresh_token: tok.refresh_token ?? given, startedAt: old.startedAt ?? new Date(now).toISOString(), lastError: null };
    await env.TRACKER.put(TOKEN_KEY, JSON.stringify(record));
    try {
      record = await collect(env, tok.access_token, record, fetchFn, now); // first round now, not in an hour
    } catch (err) {
      record = { ...record, lastError: err.message };
    }
    await env.TRACKER.put(TOKEN_KEY, JSON.stringify(record));
    return json(status(record), 200, cors);
  }

  if (!(await isOwner(request, env, fetchFn, now))) return json({ error: 'Log in with the owner’s Spotify account' }, 401, cors);

  if (route === 'POST /tracker/stop') {
    const record = (await env.TRACKER.get(TOKEN_KEY, 'json')) ?? {};
    // Keep the cursor and history; only the token goes.
    await env.TRACKER.put(TOKEN_KEY, JSON.stringify({ ...record, refresh_token: '' }));
    return json(status({}), 200, cors);
  }
  if (route === 'GET /tracker/status') return json(status(await env.TRACKER.get(TOKEN_KEY, 'json')), 200, cors);
  if (route === 'GET /tracker/listens') {
    const since = Number(url.searchParams.get('since') ?? '0');
    if (!Number.isFinite(since) || since < 0) return json({ error: 'Invalid since' }, 400, cors);
    const from = monthOf(since);
    const { keys } = await env.TRACKER.list({ prefix: 'listens:' });
    const months = keys.map((k) => k.name).filter((k) => k.slice(8) >= from).sort();
    const listens = [];
    for (const k of months) {
      for (const l of (await env.TRACKER.get(k, 'json')) ?? []) if (Date.parse(l.ts) > since) listens.push(l);
    }
    return json({ listens, ...status(await env.TRACKER.get(TOKEN_KEY, 'json')) }, 200, cors);
  }
  return json({ error: 'Not found' }, 404, cors);
}
