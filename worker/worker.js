// Cloudflare Worker: proxies setlist.fm and Last.fm to the app.
//   ?id=<setlistId>        one setlist (cached for a day)
//   ?artist=<name>&p=<n>   concert search by artist, songs included (cached for 6 hours)
//   ?similar=<artist>      Last.fm artist.getSimilar, top 30 (cached for a week)
//   ?toptracks=<artist>    Last.fm artist.getTopTracks, top 10 (cached for a week)
// - Keeps the API keys secret (dashboard secrets SETLISTFM_API_KEY and LASTFM_API_KEY).
// - Adds CORS headers for the app's own origins only.

const ALLOWED_ORIGINS = ['https://sachabaert.github.io', 'http://127.0.0.1:5173'];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') ?? '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors);

    const params = new URL(request.url).searchParams;
    if (params.has('artist')) return searchByArtist(params, env, ctx, cors);
    if (params.has('similar')) return lastfm('similar', params.get('similar'), env, ctx, cors);
    if (params.has('toptracks')) return lastfm('toptracks', params.get('toptracks'), env, ctx, cors);

    const id = params.get('id') ?? '';
    if (!/^[0-9a-f]{4,12}$/i.test(id)) return json({ error: 'Missing or invalid setlist id' }, 400, cors);

    const cacheKey = new Request(`https://setlist-cache.internal/${id}`);
    const cached = await caches.default.match(cacheKey);
    if (cached) return withCors(cached, cors);

    const upstream = await setlistfm(`/setlist/${id}`, env);
    if (upstream.status === 404) return json({ error: 'Setlist not found on setlist.fm' }, 404, cors);
    if (!upstream.ok) return json({ error: `setlist.fm returned ${upstream.status}` }, 502, cors);

    const response = json(simplify(await upstream.json()), 200, { 'Cache-Control': 'public, max-age=86400' });
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return withCors(response, cors);
  },
};

async function searchByArtist(params, env, ctx, cors) {
  const artist = (params.get('artist') ?? '').trim();
  const page = Number(params.get('p') ?? '1');
  if (!artist || artist.length > 100) return json({ error: 'Missing or invalid artist' }, 400, cors);
  if (!Number.isInteger(page) || page < 1 || page > 5) return json({ error: 'Invalid page' }, 400, cors);

  const cacheKey = new Request(`https://setlist-cache.internal/search/${encodeURIComponent(artist.toLowerCase())}/${page}`);
  const cached = await caches.default.match(cacheKey);
  if (cached) return withCors(cached, cors);

  const upstream = await setlistfm(`/search/setlists?artistName=${encodeURIComponent(artist)}&p=${page}`, env);
  let body;
  if (upstream.status === 404) body = { total: 0, page, perPage: 20, setlists: [] }; // setlist.fm: 404 = no results
  else if (!upstream.ok) return json({ error: `setlist.fm returned ${upstream.status}` }, 502, cors);
  else {
    const data = await upstream.json();
    body = {
      total: data.total ?? 0,
      page: data.page ?? page,
      perPage: data.itemsPerPage ?? 20,
      setlists: (data.setlist ?? []).map(simplify),
    };
  }
  const response = json(body, 200, { 'Cache-Control': 'public, max-age=21600' });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return withCors(response, cors);
}

// Last.fm, reduced to what Discover needs. Unknown artist (error 6) = empty list.
const LASTFM = {
  similar: {
    method: 'artist.getsimilar',
    limit: 30,
    pick: (d) => ({
      artist: d.similarartists?.['@attr']?.artist ?? '',
      similar: (d.similarartists?.artist ?? []).map((a) => ({ name: a.name, match: Number(a.match) || 0 })),
    }),
  },
  toptracks: {
    method: 'artist.gettoptracks',
    limit: 10,
    pick: (d) => ({
      artist: d.toptracks?.['@attr']?.artist ?? '',
      tracks: (d.toptracks?.track ?? []).map((t) => ({ name: t.name, playcount: Number(t.playcount) || 0 })),
    }),
  },
};

async function lastfm(kind, rawArtist, env, ctx, cors) {
  const artist = (rawArtist ?? '').trim();
  if (!artist || artist.length > 100) return json({ error: 'Missing or invalid artist' }, 400, cors);
  if (!env.LASTFM_API_KEY) return json({ error: 'Last.fm is not configured on the Worker' }, 503, cors);
  const spec = LASTFM[kind];

  const cacheKey = new Request(`https://setlist-cache.internal/lastfm/${kind}/${encodeURIComponent(artist.toLowerCase())}`);
  const cached = await caches.default.match(cacheKey);
  if (cached) return withCors(cached, cors);

  const q = new URLSearchParams({ method: spec.method, artist, autocorrect: '1', limit: String(spec.limit), format: 'json', api_key: env.LASTFM_API_KEY });
  const upstream = await fetch(`https://ws.audioscrobbler.com/2.0/?${q}`, { headers: { 'User-Agent': 'setlist-playlist (sachabaert.github.io)' } });
  const data = await upstream.json().catch(() => null);
  let body;
  if (data?.error === 6) body = spec.pick({}); // artist not found
  else if (!upstream.ok || !data || data.error) return json({ error: `Last.fm returned ${data?.error ?? upstream.status}` }, 502, cors);
  else body = spec.pick(data);
  if (!body.artist) body.artist = artist;

  const response = json(body, 200, { 'Cache-Control': 'public, max-age=604800' });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return withCors(response, cors);
}

function setlistfm(path, env) {
  return fetch(`https://api.setlist.fm/rest/1.0${path}`, {
    headers: { 'x-api-key': env.SETLISTFM_API_KEY, Accept: 'application/json', 'Accept-Language': 'en' },
  });
}

// Only what the app needs: artist, event info and songs in played order.
function simplify(data) {
  const songs = [];
  for (const set of data.sets?.set ?? []) {
    for (const song of set.song ?? []) {
      if (!song.name) continue; // unnamed entries ("unknown song")
      songs.push({
        name: song.name,
        tape: Boolean(song.tape),
        cover: song.cover?.name ?? null,
        encore: Boolean(set.encore),
      });
    }
  }
  return {
    id: data.id ?? '',
    artist: data.artist?.name ?? '',
    artistUrl: data.artist?.url ?? '',
    tour: data.tour?.name ?? '',
    date: data.eventDate ?? '', // dd-MM-yyyy
    venue: data.venue?.name ?? '',
    city: data.venue?.city?.name ?? '',
    url: data.url ?? '',
    songs,
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function withCors(response, cors) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
  return r;
}
