// Music timeline: detect eras automatically. Pure logic.
//
// Method (all on weighted plays, so background loops don't create eras):
// 1. Per calendar month (Europe/Brussels day boundaries, from history.ts), each
//    artist's share of that month's plays, smoothed over a centered 3-month window.
// 2. An artist "leads" a month when it is in the month's top ERA_TOP_N and has at
//    least ERA_MIN_SHARE of the (smoothed) plays.
// 3. Leading months become a run; gaps up to ERA_MAX_GAP months are bridged.
//    Runs shorter than ERA_MIN_MONTHS leading months are dropped (one-month binges).
// 4. Runs of different artists that cover nearly the same months (Jaccard ≥
//    ERA_MERGE) are merged into one era ("the PUP & IDLES years").
// Eras may overlap: a long-running favorite can be an era while shorter ones come and go.

import type { History, Stream } from './history';
import { rankSongs, type ListSong } from './yearlists';

export const ERA_TOP_N = 3;
export const ERA_MIN_SHARE = 0.07;
export const ERA_MIN_MONTHS = 3;
export const ERA_MAX_GAP = 2;
export const ERA_MERGE = 0.5;
/** Months with fewer (smoothed) plays than this are too quiet to lead or break an era. */
export const ERA_MIN_MONTH_PLAYS = 15;

export interface Era {
  artists: string[]; // most-played first, at most 3
  from: string; // YYYY-MM
  to: string; // YYYY-MM
  months: number; // calendar months from..to
  ongoing: boolean; // runs into the last month of the history
  plays: number; // weighted plays of the era's artists within the era
  hours: number;
  topSongs: ListSong[]; // the era's artists, within the era
}

export const monthIndex = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
export const monthLabel = (m: number) => `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;

interface Run {
  artist: string;
  from: number;
  to: number;
  lead: Set<number>;
}

export function detectEras(history: History): Era[] {
  const plays = history.plays;
  if (!plays.length) return [];
  const first = monthIndex(plays[0].day);
  const last = monthIndex(plays[plays.length - 1].day);
  const n = last - first + 1;

  // Weighted plays per artist per month.
  const perArtist = new Map<string, Float64Array>();
  const total = new Float64Array(n);
  for (const p of plays) {
    const m = monthIndex(p.day) - first;
    let arr = perArtist.get(p.artist);
    if (!arr) perArtist.set(p.artist, (arr = new Float64Array(n)));
    arr[m] += p.weight;
    total[m] += p.weight;
  }
  const smooth = (a: Float64Array) => a.map((_, i) => (a[i - 1] ?? 0) + a[i] + (a[i + 1] ?? 0));
  const totalS = smooth(total);
  const sharesS = new Map<string, Float64Array>();
  for (const [artist, arr] of perArtist) sharesS.set(artist, smooth(arr));

  // Who leads each month.
  const leaders: Set<string>[] = [];
  for (let m = 0; m < n; m++) {
    const set = new Set<string>();
    leaders.push(set);
    if (totalS[m] < ERA_MIN_MONTH_PLAYS) continue;
    const top: [string, number][] = [];
    for (const [artist, s] of sharesS) if (s[m] >= ERA_MIN_SHARE * totalS[m]) top.push([artist, s[m]]);
    top.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [artist] of top.slice(0, ERA_TOP_N)) set.add(artist);
  }

  // Runs per artist, bridging short gaps (quiet months don't count as a gap).
  const runs: Run[] = [];
  for (const [artist, raw] of perArtist) {
    let run: Run | null = null;
    let gap = 0;
    // Smoothing lets a run start a month early or end a month late: trim edges
    // where the artist's own (unsmoothed) share is below the threshold.
    const strong = (m: number) => raw[m] >= ERA_MIN_SHARE * total[m] && raw[m] > 0;
    const close = () => {
      const r = run as Run | null;
      run = null;
      if (!r) return;
      while (r.from < r.to && !strong(r.from)) r.lead.delete(r.from++);
      while (r.to > r.from && !strong(r.to)) r.lead.delete(r.to--);
      if (r.lead.size >= ERA_MIN_MONTHS) runs.push(r);
    };
    for (let m = 0; m < n; m++) {
      if (leaders[m].has(artist)) {
        if (!run) run = { artist, from: m, to: m, lead: new Set() };
        run.to = m;
        run.lead.add(m);
        gap = 0;
      } else if (run && totalS[m] >= ERA_MIN_MONTH_PLAYS && ++gap > ERA_MAX_GAP) {
        close();
        gap = 0;
      }
    }
    close();
  }

  // Merge runs that cover nearly the same months.
  const parent = runs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i];
      const b = runs[j];
      const overlap = Math.min(a.to, b.to) - Math.max(a.from, b.from) + 1;
      if (overlap <= 0) continue;
      const union = Math.max(a.to, b.to) - Math.min(a.from, b.from) + 1;
      if (overlap / union >= ERA_MERGE) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Run[]>();
  runs.forEach((r, i) => {
    const g = find(i);
    groups.set(g, [...(groups.get(g) ?? []), r]);
  });

  const eras: Era[] = [];
  for (const group of groups.values()) {
    const from = Math.min(...group.map((r) => r.from));
    const to = Math.max(...group.map((r) => r.to));
    const names = new Set(group.map((r) => r.artist));
    const inEra: Stream[] = [];
    for (const p of plays) {
      if (!names.has(p.artist)) continue;
      const m = monthIndex(p.day) - first;
      if (m >= from && m <= to) inEra.push(p);
    }
    const byArtist = new Map<string, number>();
    let ms = 0;
    for (const p of inEra) {
      byArtist.set(p.artist, (byArtist.get(p.artist) ?? 0) + p.weight);
      ms += p.ms * p.weight;
    }
    const artists = [...byArtist].sort((a, b) => b[1] - a[1]).map(([a]) => a);
    eras.push({
      artists: artists.slice(0, 3),
      from: monthLabel(first + from),
      to: monthLabel(first + to),
      months: to - from + 1,
      ongoing: to >= n - 1 - ERA_MAX_GAP, // still within the gap tolerance of the last month
      plays: [...byArtist.values()].reduce((s, v) => s + v, 0),
      hours: ms / 3_600_000,
      topSongs: rankSongs(inEra, 5),
    });
  }
  return eras.sort((a, b) => a.from.localeCompare(b.from) || b.months - a.months);
}
