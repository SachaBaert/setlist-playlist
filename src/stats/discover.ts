// Discover: music Sacha has never heard that fits his taste. Pure logic.
//
// 1. Seeds: his top artists in a window of the history (weighted plays, so
//    background loops don't steer it). Default: the last RECENT_YEARS years.
// 2. Candidates: Last.fm similar artists of the seeds, scored by
//    Σ similarity × seed share. "Never heard" = zero streams of any length in the export.
//    Adventure (2 hops): artists similar to the top hop-1 artists that are NOT
//    directly similar to any seed; hop-1 artists fill up if there are too few.
// 3. Picks: Last.fm top tracks per new artist, matched on Spotify elsewhere;
//    at most PER_ARTIST per artist, TOTAL in all, no track URI from the history.

import type { History } from './history';
import type { Era } from './eras';
import { normalize } from '../match';

export const SEED_COUNT = 15;
export const RECENT_YEARS = 3;
export const HOP_VIA = 10; // hop-1 artists used as stepping stones for a second hop
export const PER_ARTIST = 2;
export const TOTAL = 30;
export const DESCRIPTION_MAX = 300; // Spotify's limit

export type SeedRange = { kind: 'recent' } | { kind: 'year' } | { kind: 'all' } | { kind: 'era'; era: Era };

export interface Seed {
  artist: string;
  plays: number; // weighted, in the window
  weight: number; // share among the seeds, sums to 1
}

export interface Similar {
  name: string;
  match: number; // 0..1, Last.fm
}

export interface NewArtist {
  artist: string;
  score: number;
  via: string; // the seed that contributed most
  hops: 1 | 2;
}

/** Artist identity across Spotify and Last.fm spellings ("The", accents, "&", punctuation). */
export function artistKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^\s*the\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Every artist with at least one stream of any length. */
export function knownArtists(history: History): Set<string> {
  return new Set(history.streams.map((s) => artistKey(s.artist)));
}

/** Every Spotify track URI in the history. */
export function heardUris(history: History): Set<string> {
  return new Set(history.streams.map((s) => s.uri).filter((u): u is string => !!u));
}

const shiftDay = (day: string, years: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

export function seedArtists(history: History, range: SeedRange = { kind: 'recent' }, count = SEED_COUNT): Seed[] {
  const plays = history.plays;
  if (!plays.length) return [];
  const end = plays[plays.length - 1].day;
  let keep: (day: string, artist: string) => boolean;
  if (range.kind === 'recent') {
    const from = shiftDay(end, RECENT_YEARS);
    keep = (day) => day > from;
  } else if (range.kind === 'year') {
    const from = shiftDay(end, 1);
    keep = (day) => day > from;
  } else if (range.kind === 'era') {
    const names = new Set(range.era.artists);
    const { from, to } = range.era;
    keep = (day, artist) => names.has(artist) && day.slice(0, 7) >= from && day.slice(0, 7) <= to;
  } else keep = () => true;

  const per = new Map<string, number>();
  for (const p of plays) if (keep(p.day, p.artist)) per.set(p.artist, (per.get(p.artist) ?? 0) + p.weight);
  const top = [...per].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, count);
  const sum = top.reduce((s, [, v]) => s + v, 0);
  return top.map(([artist, v]) => ({ artist, plays: v, weight: v / sum }));
}

type SimilarLookup = (artist: string) => Similar[] | undefined;

interface Scored {
  name: string;
  score: number;
  bySeed: Map<string, number>;
}

function hop1(seeds: Seed[], similar: SimilarLookup): Map<string, Scored> {
  const out = new Map<string, Scored>();
  for (const seed of seeds) {
    for (const s of similar(seed.artist) ?? []) {
      const k = artistKey(s.name);
      let c = out.get(k);
      if (!c) out.set(k, (c = { name: s.name, score: 0, bySeed: new Map() }));
      const add = s.match * seed.weight;
      c.score += add;
      c.bySeed.set(seed.artist, (c.bySeed.get(seed.artist) ?? 0) + add);
    }
  }
  return out;
}

const byScore = (a: Scored, b: Scored) => b.score - a.score || a.name.localeCompare(b.name);
const topSeed = (c: Scored) => [...c.bySeed].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

/** The hop-1 artists (known or not, seeds excluded) whose similar lists a second hop needs. */
export function steppingStones(seeds: Seed[], similar: SimilarLookup, n = HOP_VIA): string[] {
  const seedKeys = new Set(seeds.map((s) => artistKey(s.artist)));
  return [...hop1(seeds, similar).entries()]
    .filter(([k]) => !seedKeys.has(k))
    .map(([, c]) => c)
    .sort(byScore)
    .slice(0, n)
    .map((c) => c.name);
}

/** New artists, best first. `similar` must cover the seeds, and for hops = 2 also the stepping stones. */
export function rankNewArtists(seeds: Seed[], similar: SimilarLookup, known: Set<string>, hops: 1 | 2 = 1): NewArtist[] {
  const isNew = (name: string) => !known.has(artistKey(name));
  const first = hop1(seeds, similar);
  const direct = [...first.values()].filter((c) => isNew(c.name)).sort(byScore);
  const result = (list: Scored[], h: 1 | 2): NewArtist[] => list.map((c) => ({ artist: c.name, score: c.score, via: topSeed(c), hops: h }));
  if (hops === 1) return result(direct, 1);

  const second = new Map<string, Scored>();
  for (const stone of steppingStones(seeds, similar)) {
    const base = first.get(artistKey(stone))!;
    const via = topSeed(base);
    for (const s of similar(stone) ?? []) {
      const k = artistKey(s.name);
      if (first.has(k) || !isNew(s.name)) continue; // directly similar to a seed: that's hop 1
      let c = second.get(k);
      if (!c) second.set(k, (c = { name: s.name, score: 0, bySeed: new Map() }));
      const add = base.score * s.match;
      c.score += add;
      c.bySeed.set(via, (c.bySeed.get(via) ?? 0) + add);
    }
  }
  return [...result([...second.values()].sort(byScore), 2), ...result(direct, 1)];
}

export interface TrackOption {
  uri: string;
  title: string;
}

export interface Pick<T extends TrackOption> {
  artist: string;
  via: string;
  track: T;
}

/**
 * Choose the playlist: artists in rank order, up to `perArtist` tracks each
 * (`tracks` is in Last.fm popularity order), skipping heard URIs and repeated
 * titles. Ordered round-robin (every artist's first track, then the seconds) so
 * the same artist never plays twice in a row.
 */
export function pickTracks<T extends TrackOption>(
  artists: NewArtist[],
  tracks: (artist: string) => T[] | undefined,
  heard: Set<string>,
  perArtist = PER_ARTIST,
  total = TOTAL,
): Pick<T>[] {
  const chosen: Pick<T>[][] = [];
  const usedUris = new Set<string>();
  let count = 0;
  for (const a of artists) {
    if (count >= total) break;
    const titles = new Set<string>();
    const mine: Pick<T>[] = [];
    for (const t of tracks(a.artist) ?? []) {
      if (mine.length >= perArtist || count + mine.length >= total) break;
      const title = normalize(t.title.replace(/[([].*?[)\]]/g, '').split(' - ')[0]);
      if (heard.has(t.uri) || usedUris.has(t.uri) || titles.has(title)) continue;
      titles.add(title);
      usedUris.add(t.uri);
      mine.push({ artist: a.artist, via: a.via, track: t });
    }
    if (mine.length) chosen.push(mine);
    count += mine.length;
  }
  const out: Pick<T>[] = [];
  for (let round = 0; round < perArtist; round++) for (const list of chosen) if (list[round]) out.push(list[round]);
  return out;
}

/** "New to me, via Last.fm. Via Seed: A, B. Via Seed 2: C." Cut at Spotify's 300 characters. */
export function discoverDescription(picks: Pick<TrackOption>[], seedLabel: string): string {
  const groups = new Map<string, string[]>();
  for (const p of picks) {
    const list = groups.get(p.via) ?? [];
    if (!list.includes(p.artist)) list.push(p.artist);
    groups.set(p.via, list);
  }
  let text = `Artists I'd never played, similar to my ${seedLabel} (Last.fm).`;
  for (const [via, list] of groups) text += ` Via ${via}: ${list.join(', ')}.`;
  return text.length <= DESCRIPTION_MAX ? text : `${text.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…`;
}
