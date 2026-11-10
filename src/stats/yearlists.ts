// Year playlists: the top songs of each year, ready for createPlaylist/addItems.
// Pure logic. Ranked by weighted plays (background loops count less).

import type { History, Stream } from './history';

export const YEAR_TOP = 30;
export const FIRST_PLAYLIST_YEAR = 2014;

export interface ListSong {
  key: string;
  track: string;
  artist: string;
  uri: string; // spotify:track:… (local files can't go in a playlist)
  plays: number; // weighted
  rawPlays: number;
}

/** Anything that can become a Spotify playlist with one click. */
export interface PlaylistDraft {
  id: string; // stable, for the UI
  name: string;
  description: string;
  songs: ListSong[];
}

const TRACK_URI = /^spotify:track:[A-Za-z0-9]+$/;

/**
 * Rank songs by weighted plays. One entry per song key (merges re-releases);
 * the URI is the one played most for that song. Songs without a Spotify track
 * URI are skipped so the list still fills up to `limit`.
 */
export function rankSongs(plays: Stream[], limit = Infinity): ListSong[] {
  const map = new Map<string, ListSong & { hours: number; uris: Map<string, number> }>();
  for (const p of plays) {
    if (!p.isPlay) continue;
    let st = map.get(p.key);
    if (!st) map.set(p.key, (st = { key: p.key, track: p.track, artist: p.artist, uri: '', plays: 0, rawPlays: 0, hours: 0, uris: new Map() }));
    st.plays += p.weight;
    st.rawPlays++;
    st.hours += p.ms * p.weight;
    if (p.uri && TRACK_URI.test(p.uri)) st.uris.set(p.uri, (st.uris.get(p.uri) ?? 0) + 1);
  }
  const out: ListSong[] = [];
  const ranked = [...map.values()].sort((a, b) => b.plays - a.plays || b.hours - a.hours || a.key.localeCompare(b.key));
  for (const st of ranked) {
    if (out.length >= limit) break;
    const uri = [...st.uris].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!uri) continue;
    out.push({ key: st.key, track: st.track, artist: st.artist, uri, plays: st.plays, rawPlays: st.rawPlays });
  }
  return out;
}

export function yearPlaylists(history: History, size = YEAR_TOP, from = FIRST_PLAYLIST_YEAR): PlaylistDraft[] {
  const byYear = new Map<number, Stream[]>();
  for (const p of history.plays) {
    if (p.year < from) continue;
    let list = byYear.get(p.year);
    if (!list) byYear.set(p.year, (list = []));
    list.push(p);
  }
  return [...byYear.keys()]
    .sort((a, b) => a - b)
    .map((year) => {
      const songs = rankSongs(byYear.get(year)!, size);
      return {
        id: `year-${year}`,
        name: `Top ${songs.length} of ${year}`,
        description: `My ${songs.length} most-played songs of ${year}, from my Spotify streaming history. Made with Setlist to Playlist.`,
        songs,
      };
    })
    .filter((d) => d.songs.length > 0);
}
