// All-time Wrapped: per-year chapters and all-time highlights. Pure logic.
// Rankings use the weighted counts from history.ts (background loops count
// less); the raw numbers are kept next to them for sanity checks.

import type { History, Stream } from './history';

export interface SongStat {
  key: string;
  track: string;
  artist: string;
  plays: number; // weighted plays (30 s+)
  rawPlays: number;
  hours: number; // weighted
}

export interface ArtistStat {
  artist: string;
  plays: number;
  rawPlays: number;
  hours: number; // weighted, all streams
  rawHours: number;
}

export interface YearChapter {
  year: number;
  hours: number; // weighted
  rawHours: number;
  plays: number; // raw count of 30 s+ plays
  artists: number; // distinct artists with a 30 s+ play
  songs: number;
  topSong: SongStat | null;
  topArtist: ArtistStat | null;
  /** Most-played artist whose first ever play was this year. */
  discovery: ArtistStat | null;
}

export interface DayStat {
  day: string;
  hours: number;
  plays: number;
  topSong: SongStat | null;
}

export interface Wrapped {
  totals: {
    streams: number;
    plays: number;
    rawHours: number;
    hours: number;
    first: string;
    last: string;
    missingYears: number[];
  };
  firstStream: Stream | null;
  firstPlay: Stream | null;
  topSongs: SongStat[];
  topArtists: ArtistStat[];
  biggestDay: DayStat | null; // weighted, flagged long days excluded
  rawBiggestDay: DayStat | null; // unweighted, for checking the loop detection
  longestStreak: { days: number; from: string; to: string } | null;
  mostExploratoryYear: { year: number; artists: number } | null;
  years: YearChapter[];
}

const H = 3_600_000;

function songStats(streams: Stream[]): SongStat[] {
  const map = new Map<string, SongStat>();
  for (const s of streams) {
    if (!s.isPlay) continue;
    let st = map.get(s.key);
    if (!st) map.set(s.key, (st = { key: s.key, track: s.track, artist: s.artist, plays: 0, rawPlays: 0, hours: 0 }));
    st.plays += s.weight;
    st.rawPlays++;
    st.hours += (s.ms * s.weight) / H;
  }
  return [...map.values()].sort((a, b) => b.plays - a.plays || b.hours - a.hours);
}

function artistStats(streams: Stream[]): ArtistStat[] {
  const map = new Map<string, ArtistStat>();
  for (const s of streams) {
    let st = map.get(s.artist);
    if (!st) map.set(s.artist, (st = { artist: s.artist, plays: 0, rawPlays: 0, hours: 0, rawHours: 0 }));
    st.hours += (s.ms * s.weight) / H;
    st.rawHours += s.ms / H;
    if (s.isPlay) {
      st.plays += s.weight;
      st.rawPlays++;
    }
  }
  return [...map.values()].sort((a, b) => b.hours - a.hours || b.plays - a.plays);
}

const dayNumber = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 86_400_000;

export function longestStreak(days: string[]): Wrapped['longestStreak'] {
  const sorted = [...new Set(days)].sort();
  if (!sorted.length) return null;
  let best = { days: 1, from: sorted[0], to: sorted[0] };
  let start = 0;
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && dayNumber(sorted[i]) - dayNumber(sorted[i - 1]) === 1) continue;
    const len = i - start;
    if (len > best.days) best = { days: len, from: sorted[start], to: sorted[i - 1] };
    start = i;
  }
  return best;
}

function biggestDay(history: History, weighted: boolean): DayStat | null {
  const byDay = new Map<string, Stream[]>();
  for (const s of history.streams) {
    let list = byDay.get(s.day);
    if (!list) byDay.set(s.day, (list = []));
    list.push(s);
  }
  // Days over LONG_DAY_HOURS were background listening; they don't compete.
  const skip = new Set(weighted ? history.longDays.map((d) => d.day) : []);
  let best: { day: string; ms: number; list: Stream[] } | null = null;
  for (const [day, list] of byDay) {
    if (skip.has(day)) continue;
    const ms = list.reduce((sum, s) => sum + s.ms * (weighted ? s.weight : 1), 0);
    if (!best || ms > best.ms) best = { day, ms, list };
  }
  if (!best) return null;
  return {
    day: best.day,
    hours: best.ms / H,
    plays: best.list.filter((s) => s.isPlay).length,
    topSong: songStats(best.list)[0] ?? null,
  };
}

export function buildWrapped(history: History, top = 10): Wrapped {
  const { streams, plays } = history;

  // First 30 s+ play per artist, to find each year's discovery.
  const firstYear = new Map<string, number>();
  for (const p of plays) if (!firstYear.has(p.artist)) firstYear.set(p.artist, p.year);

  const byYear = new Map<number, Stream[]>();
  for (const s of streams) {
    let list = byYear.get(s.year);
    if (!list) byYear.set(s.year, (list = []));
    list.push(s);
  }

  const years: YearChapter[] = [...byYear.keys()].sort().map((year) => {
    const list = byYear.get(year)!;
    const yearPlays = list.filter((s) => s.isPlay);
    const artists = artistStats(list);
    const ranked = [...artists].filter((a) => a.rawPlays > 0).sort((a, b) => b.plays - a.plays || b.hours - a.hours);
    return {
      year,
      hours: list.reduce((sum, s) => sum + s.ms * s.weight, 0) / H,
      rawHours: list.reduce((sum, s) => sum + s.ms, 0) / H,
      plays: yearPlays.length,
      artists: new Set(yearPlays.map((s) => s.artist)).size,
      songs: new Set(yearPlays.map((s) => s.key)).size,
      topSong: songStats(list)[0] ?? null,
      topArtist: artists[0] ?? null,
      discovery: ranked.find((a) => firstYear.get(a.artist) === year) ?? null,
    };
  });

  const yearNums = years.map((y) => y.year);
  const missingYears: number[] = [];
  if (yearNums.length) {
    for (let y = yearNums[0]; y <= yearNums[yearNums.length - 1]; y++) if (!byYear.has(y)) missingYears.push(y);
  }

  const explorer = years.reduce<YearChapter | null>((best, y) => (!best || y.artists > best.artists ? y : best), null);

  return {
    totals: {
      streams: streams.length,
      plays: plays.length,
      rawHours: streams.reduce((sum, s) => sum + s.ms, 0) / H,
      hours: streams.reduce((sum, s) => sum + s.ms * s.weight, 0) / H,
      first: streams[0]?.day ?? '',
      last: streams[streams.length - 1]?.day ?? '',
      missingYears,
    },
    firstStream: streams[0] ?? null,
    firstPlay: plays[0] ?? null,
    topSongs: songStats(streams).slice(0, top),
    topArtists: artistStats(streams).slice(0, top),
    biggestDay: biggestDay(history, true),
    rawBiggestDay: biggestDay(history, false),
    longestStreak: longestStreak(plays.map((p) => p.day)),
    mostExploratoryYear: explorer ? { year: explorer.year, artists: explorer.artists } : null,
    years,
  };
}
