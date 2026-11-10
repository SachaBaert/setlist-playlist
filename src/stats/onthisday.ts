// "On this day": what was playing on this date 5 and 10 years ago. Pure logic.

import type { History, Stream } from './history';
import { rankSongs, type ListSong } from './yearlists';

export const ON_THIS_DAY_YEARS = [5, 10];
/** If the exact date is silent, look this many days either side for the nearest day with plays. */
export const NEAREST_DAYS = 3;

export interface DayLook {
  yearsAgo: number;
  target: string; // the same date N years ago
  day: string; // the day shown (target, or the nearest day with plays)
  exact: boolean;
  hours: number; // raw
  plays: number; // raw 30 s+
  topSongs: ListSong[];
  artists: string[]; // most-played first, at most 3
}

/** Same calendar date N years earlier; 29 February becomes the 28th. */
export function shiftYears(day: string, years: number): string {
  const y = Number(day.slice(0, 4)) - years;
  let md = day.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (md === '02-29' && !leap) md = '02-28';
  return `${y}-${md}`;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function onThisDay(history: History, today: string, offsets = ON_THIS_DAY_YEARS): DayLook[] {
  const byDay = new Map<string, Stream[]>();
  for (const s of history.streams) {
    let list = byDay.get(s.day);
    if (!list) byDay.set(s.day, (list = []));
    list.push(s);
  }
  const hasPlays = (day: string) => byDay.get(day)?.some((s) => s.isPlay) ?? false;

  const out: DayLook[] = [];
  for (const yearsAgo of offsets) {
    const target = shiftYears(today, yearsAgo);
    let day: string | null = hasPlays(target) ? target : null;
    for (let d = 1; !day && d <= NEAREST_DAYS; d++) {
      // Earlier day first on ties: "the day before" reads more naturally.
      if (hasPlays(addDays(target, -d))) day = addDays(target, -d);
      else if (hasPlays(addDays(target, d))) day = addDays(target, d);
    }
    if (!day) continue;
    const list = byDay.get(day)!;
    const plays = list.filter((s) => s.isPlay);
    const perArtist = new Map<string, number>();
    for (const p of plays) perArtist.set(p.artist, (perArtist.get(p.artist) ?? 0) + p.weight);
    out.push({
      yearsAgo,
      target,
      day,
      exact: day === target,
      hours: list.reduce((sum, s) => sum + s.ms, 0) / 3_600_000,
      plays: plays.length,
      topSongs: rankSongs(plays, 5),
      artists: [...perArtist].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a),
    });
  }
  return out;
}

/** Today's date in the stats time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
