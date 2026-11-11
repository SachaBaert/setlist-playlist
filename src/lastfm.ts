// Last.fm via the Cloudflare Worker (the API key is a Worker secret).
import { WORKER_URL } from './setlistfm';
import type { Similar } from './stats/discover';

async function get<T>(param: string, artist: string): Promise<T> {
  const res = await fetch(`${WORKER_URL}?${param}=${encodeURIComponent(artist)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Last.fm lookup failed (${res.status})`);
  return data as T;
}

export const fetchSimilar = (artist: string) => get<{ artist: string; similar: Similar[] }>('similar', artist);
export const fetchTopTracks = (artist: string) => get<{ artist: string; tracks: { name: string; playcount: number }[] }>('toptracks', artist);
