// setlist.fm import via the Cloudflare Worker proxy.

/** Worker URL; empty string hides the import option. */
export const WORKER_URL = 'https://setlist-proxy.sacha-baert-88.workers.dev/';

export interface SetlistSong {
  name: string;
  tape: boolean;
  cover: string | null;
  encore: boolean;
}

export interface Setlist {
  id?: string; // missing in responses cached before round 2
  artist: string;
  artistUrl?: string; // setlist.fm artist page
  tour?: string;
  date: string; // dd-MM-yyyy
  venue: string;
  city: string;
  url: string; // setlist.fm page, for attribution
  songs: SetlistSong[];
}

/** Accepts a setlist.fm URL or a bare id; returns the id or null. */
export function extractSetlistId(input: string): string | null {
  const s = input.trim();
  if (/^[0-9a-f]{4,12}$/i.test(s)) return s.toLowerCase();
  const m = s.match(/setlist\.fm\/setlist\/.*-([0-9a-f]{4,12})\.html/i);
  return m ? m[1].toLowerCase() : null;
}

export async function fetchSetlist(id: string): Promise<Setlist> {
  const res = await fetch(`${WORKER_URL}?id=${encodeURIComponent(id)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Import failed (${res.status})`);
  return data as Setlist;
}

export interface SearchPage {
  total: number;
  page: number;
  perPage: number;
  setlists: Setlist[];
}

export async function searchSetlists(artist: string, page = 1): Promise<SearchPage> {
  const res = await fetch(`${WORKER_URL}?artist=${encodeURIComponent(artist)}&p=${page}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Search failed (${res.status})`);
  return data as SearchPage;
}

/** Text for the setlist box. Covers get "| Original artist" so they're searched under that artist. */
export function toSetlistText(setlist: Setlist, includeTapes: boolean): string {
  return setlist.songs
    .filter((s) => includeTapes || !s.tape)
    .map((s, i) => `${i + 1}. ${s.name}${s.cover ? ` | ${s.cover}` : ''}`)
    .join('\n');
}

/** Playlist description; setlist.fm's API terms ask for attribution with a link. */
export function playlistDescription(artistName: string, sourceUrl: string | null): string {
  return sourceUrl
    ? `${artistName} setlist from setlist.fm: ${sourceUrl}`
    : `Setlist by ${artistName}, made with Setlist to Playlist.`;
}

/** "Kneecap – Venue, City (2025-06-27)" */
export function playlistName(setlist: Setlist): string {
  const [d, m, y] = setlist.date.split('-');
  const date = y ? ` (${y}-${m}-${d})` : '';
  const place = [setlist.venue, setlist.city].filter(Boolean).join(', ');
  return `${setlist.artist}${place ? ` – ${place}` : ''}${date}`;
}
