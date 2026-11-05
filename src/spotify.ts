// Thin Spotify Web API client (endpoints as of the February 2026 revision).
import { getAccessToken } from './auth';

const API = 'https://api.spotify.com/v1';

export interface Artist {
  id: string;
  name: string;
}

export interface Track {
  id: string;
  uri: string;
  name: string;
  artists: Artist[];
  album: { name: string; album_type: string; images: { url: string; width: number }[] };
  duration_ms: number;
}

async function api<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  // Rate limited: wait as long as Spotify asks, then retry (max 3 times).
  if (res.status === 429 && attempt < 3) {
    const wait = Number(res.headers.get('Retry-After') ?? '2');
    await new Promise((r) => setTimeout(r, wait * 1000));
    return api<T>(path, init, attempt + 1);
  }
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      message = (await res.json()).error?.message ?? message;
    } catch {
      /* no body */
    }
    throw new Error(`Spotify API error: ${message}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function searchArtists(name: string): Promise<Artist[]> {
  const q = new URLSearchParams({ q: name, type: 'artist', limit: '5' });
  const data = await api<{ artists: { items: Artist[] } }>(`/search?${q}`);
  return data.artists.items;
}

/** Search tracks by title, restricted to one artist name. Dev mode caps limit at 10. */
export async function searchTracks(title: string, artistName: string): Promise<Track[]> {
  const run = async (query: string) => {
    const q = new URLSearchParams({ q: query, type: 'track', limit: '10' });
    return (await api<{ tracks: { items: Track[] } }>(`/search?${q}`)).tracks.items;
  };
  const strict = await run(`track:${title} artist:${artistName}`);
  // Field filters can miss titles with odd punctuation; fall back to a loose query.
  return strict.length > 0 ? strict : run(`${title} ${artistName}`);
}

/** Free-text track search for manual lookups (no artist filter). */
export async function searchAny(query: string): Promise<Track[]> {
  const q = new URLSearchParams({ q: query, type: 'track', limit: '10' });
  return (await api<{ tracks: { items: Track[] } }>(`/search?${q}`)).tracks.items;
}

export async function createPlaylist(name: string, description: string): Promise<{ id: string; external_urls: { spotify: string } }> {
  return api('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name, description, public: false }),
  });
}

/** Adds tracks in order, in batches of 100 (the API maximum). */
export async function addItems(playlistId: string, uris: string[]): Promise<void> {
  for (let i = 0; i < uris.length; i += 100) {
    await api(`/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
    });
  }
}
