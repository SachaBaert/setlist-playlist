// Concert search results and the "prepare for a concert" mix. Pure logic, unit-tested.
import type { Setlist, SetlistSong } from './setlistfm';

/** "27-06-2025" -> "2025-06-27" (sortable); "" if malformed. */
export function isoDate(date: string): string {
  const [d, m, y] = date.split('-');
  return y && m && d ? `${y}-${m}-${d}` : '';
}

/** Songs actually played (tapes don't count). */
export function playedSongs(setlist: Setlist): SetlistSong[] {
  return setlist.songs.filter((s) => !s.tape);
}

/**
 * setlist.fm's artist search is fuzzy ("Kneecap" also finds tribute acts).
 * Keep exact name matches when there are any, newest first.
 */
export function cleanSearchResults(query: string, setlists: Setlist[]): Setlist[] {
  const wanted = query.trim().toLowerCase();
  const exact = setlists.filter((s) => s.artist.toLowerCase() === wanted);
  return [...(exact.length ? exact : setlists)].sort((a, b) => isoDate(b.date).localeCompare(isoDate(a.date)));
}

export interface MixSong {
  name: string;
  cover: string | null;
  played: number; // number of shows it was played at
  position: number; // average relative position, 0 = opener, 1 = closer
}

export interface Mix {
  artist: string;
  tour: string; // "" when the shows have no tour name
  shows: Setlist[]; // the setlists used, newest first
  songs: MixSong[]; // in their usual order
}

/**
 * The last `maxShows` past setlists with songs, limited to the tour of the most recent one.
 * Songs played at fewer than `minShare` of those shows are left out (one-off rarities),
 * the rest are ordered by their average position in the set.
 */
export function prepareMix(setlists: Setlist[], today: string, maxShows = 10, minShare = 1 / 3): Mix | null {
  const past = setlists
    .filter((s) => playedSongs(s).length > 0 && isoDate(s.date) && isoDate(s.date) <= today)
    .sort((a, b) => isoDate(b.date).localeCompare(isoDate(a.date)));
  if (past.length === 0) return null;

  const tour = past[0].tour ?? '';
  const shows = (tour ? past.filter((s) => s.tour === tour) : past).slice(0, maxShows);

  const stats = new Map<string, { song: SetlistSong; played: number; positions: number[] }>();
  for (const show of shows) {
    const songs = playedSongs(show);
    const seen = new Set<string>();
    songs.forEach((song, i) => {
      const key = song.name.trim().toLowerCase();
      if (seen.has(key)) return; // played twice in one show (reprise): count once
      seen.add(key);
      const entry = stats.get(key) ?? { song, played: 0, positions: [] };
      entry.played++;
      entry.positions.push(songs.length > 1 ? i / (songs.length - 1) : 0);
      stats.set(key, entry);
    });
  }

  const threshold = Math.max(1, Math.ceil(shows.length * minShare));
  const songs = [...stats.values()]
    .filter((e) => e.played >= threshold)
    .map((e) => ({
      name: e.song.name,
      cover: e.song.cover,
      played: e.played,
      position: e.positions.reduce((a, b) => a + b, 0) / e.positions.length,
    }))
    .sort((a, b) => a.position - b.position || b.played - a.played);

  return { artist: shows[0].artist, tour, shows, songs };
}

/** Text for the setlist box, same format as an imported setlist. */
export function mixToText(mix: Mix): string {
  return mix.songs.map((s, i) => `${i + 1}. ${s.name}${s.cover ? ` | ${s.cover}` : ''}`).join('\n');
}

/** "Kneecap – Fine Art Tour (prep mix)" */
export function mixName(mix: Mix): string {
  return `${mix.artist}${mix.tour ? ` – ${mix.tour}` : ''} (prep mix)`;
}

/** Description with setlist.fm attribution (their API terms ask for a link). */
export function mixDescription(mix: Mix): string {
  const link = mix.shows[0].artistUrl || mix.shows[0].url;
  const n = mix.shows.length;
  return `Songs ${mix.artist} played most in their ${n === 1 ? 'latest setlist' : `last ${n} setlists`} on setlist.fm, in their usual order: ${link}`;
}
