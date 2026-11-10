// Comebacks, forgotten favorites and forgotten gems. Pure logic, weighted plays.
//
// Artists (monthly): a month is "quiet" for an artist below QUIET_MONTH weighted
// plays, so one stray shuffle play doesn't end a silence. Months with no listening
// at all (gaps in the export, e.g. 2013) are skipped: no data is not silence.
// - Comeback: SILENCE_MONTHS+ quiet months, with BEFORE_PLAYS+ before and RETURN_PLAYS+ after.
// - Forgotten favorite: BEFORE_PLAYS+, then quiet for SILENCE_MONTHS+ up to the end of the history.
// Songs: a forgotten gem has GEM_PLAYS+ weighted plays and no 30 s+ play in the last
// SILENCE_MONTHS of the history; at most GEM_PER_ARTIST per artist.
// "The end" is the last day in the export, not today.

import type { History, Stream } from './history';
import { monthIndex, monthLabel } from './eras';
import { rankSongs, type ListSong, type PlaylistDraft } from './yearlists';

export const QUIET_MONTH = 2;
export const SILENCE_MONTHS = 24;
export const BEFORE_PLAYS = 50;
export const RETURN_PLAYS = 20;
export const ARTIST_PLAYLIST_SIZE = 20;
export const GEM_PLAYS = 10;
export const GEM_PER_ARTIST = 3;
export const GEMS_SIZE = 50;

export interface Comeback {
  artist: string;
  before: { from: string; to: string; plays: number }; // YYYY-MM, weighted
  silentMonths: number; // months with listening data but (almost) none of this artist
  back: string; // YYYY-MM of the return
  after: number; // weighted plays after the return
  playlist: PlaylistDraft; // their top songs from before the silence
}

export interface ForgottenFavorite {
  artist: string;
  from: string;
  last: string; // last active month
  plays: number;
  playlist: PlaylistDraft;
}

export interface Rediscover {
  comebacks: Comeback[];
  forgotten: ForgottenFavorite[];
  gems: PlaylistDraft | null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function artistDraft(id: string, name: string, description: string, plays: Stream[]): PlaylistDraft {
  return { id, name, description, songs: rankSongs(plays, ARTIST_PLAYLIST_SIZE) };
}

export function rediscover(history: History): Rediscover {
  const plays = history.plays;
  if (!plays.length) return { comebacks: [], forgotten: [], gems: null };
  const first = monthIndex(plays[0].day);
  const last = monthIndex(plays[plays.length - 1].day);
  const n = last - first + 1;

  const hasData = new Array<boolean>(n).fill(false);
  const byArtist = new Map<string, { monthly: Float64Array; plays: Stream[] }>();
  for (const p of plays) {
    const m = monthIndex(p.day) - first;
    hasData[m] = true;
    let a = byArtist.get(p.artist);
    if (!a) byArtist.set(p.artist, (a = { monthly: new Float64Array(n), plays: [] }));
    a.monthly[m] += p.weight;
    a.plays.push(p);
  }

  const comebacks: Comeback[] = [];
  const forgotten: ForgottenFavorite[] = [];
  for (const [artist, { monthly, plays: aPlays }] of byArtist) {
    const total = monthly.reduce((s, v) => s + v, 0);
    if (total < BEFORE_PLAYS) continue;
    const active = (m: number) => monthly[m] >= QUIET_MONTH;
    const sumRange = (a: number, b: number) => monthly.slice(a, b + 1).reduce((s, v) => s + v, 0);
    const firstActive = monthly.findIndex((_, m) => active(m));
    if (firstActive < 0) continue;

    // Longest silence (counted in months with data) after an active month.
    let best: { lastActive: number; next: number; silent: number } | null = null;
    let lastActive = -1;
    let silent = 0;
    for (let m = 0; m < n; m++) {
      if (active(m)) {
        if (lastActive >= 0 && silent >= SILENCE_MONTHS && (!best || silent > best.silent)) best = { lastActive, next: m, silent };
        lastActive = m;
        silent = 0;
      } else if (lastActive >= 0 && hasData[m]) silent++;
    }
    const openSilence = lastActive >= 0 ? silent : 0; // quiet months up to the end

    if (best && sumRange(0, best.lastActive) >= BEFORE_PLAYS && sumRange(best.next, n - 1) >= RETURN_PLAYS) {
      const from = monthLabel(first + firstActive);
      const to = monthLabel(first + best.lastActive);
      const before = aPlays.filter((p) => monthIndex(p.day) - first <= best!.lastActive);
      comebacks.push({
        artist,
        before: { from, to, plays: sumRange(0, best.lastActive) },
        silentMonths: best.silent,
        back: monthLabel(first + best.next),
        after: sumRange(best.next, n - 1),
        playlist: artistDraft(
          `comeback-${slug(artist)}`,
          `${artist}: the ${from.slice(0, 4)}${to.slice(0, 4) !== from.slice(0, 4) ? `–${to.slice(0, 4)}` : ''} years`,
          `My most-played ${artist} songs from before the break. Made with Setlist to Playlist.`,
          before,
        ),
      });
    } else if (openSilence >= SILENCE_MONTHS && sumRange(0, lastActive) >= BEFORE_PLAYS) {
      const from = monthLabel(first + firstActive);
      const lastLabel = monthLabel(first + lastActive);
      forgotten.push({
        artist,
        from,
        last: lastLabel,
        plays: sumRange(0, lastActive),
        playlist: artistDraft(
          `forgotten-${slug(artist)}`,
          `Forgotten favorite: ${artist}`,
          `My most-played ${artist} songs, last played a lot in ${lastLabel.slice(0, 4)}. Made with Setlist to Playlist.`,
          aPlays,
        ),
      });
    }
  }
  comebacks.sort((a, b) => b.silentMonths - a.silentMonths || b.before.plays - a.before.plays);
  forgotten.sort((a, b) => b.plays - a.plays);
  return { comebacks, forgotten, gems: forgottenGems(history, last) };
}

/** Songs played a lot once, with no play in the last SILENCE_MONTHS of the history. */
export function forgottenGems(history: History, lastMonth = monthIndex(history.plays.at(-1)?.day ?? '0000-01-01')): PlaylistDraft | null {
  const cutoff = lastMonth - SILENCE_MONTHS; // a play in a later month means not forgotten
  const lastPlay = new Map<string, number>();
  for (const p of history.plays) lastPlay.set(p.key, monthIndex(p.day));
  const candidates = history.plays.filter((p) => lastPlay.get(p.key)! <= cutoff);
  const perArtist = new Map<string, number>();
  const songs: ListSong[] = [];
  for (const s of rankSongs(candidates)) {
    if (s.plays < GEM_PLAYS || songs.length >= GEMS_SIZE) break;
    const count = perArtist.get(s.artist) ?? 0;
    if (count >= GEM_PER_ARTIST) continue;
    perArtist.set(s.artist, count + 1);
    songs.push(s);
  }
  if (!songs.length) return null;
  return {
    id: 'forgotten-gems',
    name: 'Forgotten gems',
    description: `Songs I played a lot once and not since ${monthLabel(cutoff).slice(0, 4)}. From my Spotify streaming history. Made with Setlist to Playlist.`,
    songs,
  };
}
