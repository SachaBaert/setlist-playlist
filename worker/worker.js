// Cloudflare Worker: proxies one setlist.fm setlist to the app.
// - Keeps the setlist.fm API key secret (set as the secret SETLISTFM_API_KEY).
// - Adds CORS headers for the app's own origins only.
// - Caches each setlist for a day, so repeat imports don't use API quota.

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

    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!/^[0-9a-f]{4,12}$/i.test(id)) return json({ error: 'Missing or invalid setlist id' }, 400, cors);

    const cacheKey = new Request(`https://setlist-cache.internal/${id}`);
    const cached = await caches.default.match(cacheKey);
    if (cached) return withCors(cached, cors);

    const upstream = await fetch(`https://api.setlist.fm/rest/1.0/setlist/${id}`, {
      headers: { 'x-api-key': env.SETLISTFM_API_KEY, Accept: 'application/json', 'Accept-Language': 'en' },
    });
    if (upstream.status === 404) return json({ error: 'Setlist not found on setlist.fm' }, 404, cors);
    if (!upstream.ok) return json({ error: `setlist.fm returned ${upstream.status}` }, 502, cors);

    const response = json(simplify(await upstream.json()), 200, { 'Cache-Control': 'public, max-age=86400' });
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return withCors(response, cors);
  },
};

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
    artist: data.artist?.name ?? '',
    date: data.eventDate ?? '', // dd-MM-yyyy
    venue: data.venue?.name ?? '',
    city: data.venue?.city?.name ?? '',
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
