// Foundation for the statistics page: turn a Spotify Extended Streaming
// History export into normalized plays. Pure logic, no DOM, no network.
// Everything runs in the browser; nothing from the export is ever sent anywhere.

import { unzipSync, strFromU8 } from 'fflate';

/** One entry of Streaming_History_Audio_*.json (only the fields we read). */
export interface RawStream {
  ts: string;
  ms_played: number;
  master_metadata_track_name: string | null;
  master_metadata_album_artist_name: string | null;
  master_metadata_album_album_name?: string | null;
  spotify_track_uri?: string | null;
  skipped?: boolean | null;
  shuffle?: boolean | null;
  [other: string]: unknown;
}

/** A music stream, with only the fields we keep (no IP, country or device). */
export interface Stream {
  ts: number; // epoch ms (UTC)
  day: string; // YYYY-MM-DD in the chosen time zone
  year: number;
  ms: number;
  track: string;
  artist: string;
  album: string;
  uri: string | null;
  key: string; // song identity: normalized artist + title (merges re-releases)
  skipped: boolean;
  isPlay: boolean; // played 30 s or more
  /** 0..1: how much this play counts in rankings. < 1 on background-loop days. */
  weight: number;
}

export interface LoopFlag {
  day: string;
  key: string;
  track: string;
  artist: string;
  plays: number;
}

export interface LongDayFlag {
  day: string;
  hours: number;
}

export interface History {
  streams: Stream[]; // music streams, sorted by time
  plays: Stream[]; // the subset with isPlay
  skippedEntries: number; // podcast/audiobook/unknown entries in the audio files
  loops: LoopFlag[]; // a song on repeat in the background
  longDays: LongDayFlag[]; // days with more listening than LONG_DAY_HOURS
}

export const PLAY_MS = 30_000;
/** In rankings a song counts at most this many times per day (no cliff: 11 plays count as 10). */
export const DAY_CAP = 10;
/** Same song this often (30 s+) on one day = flagged as left on repeat in the background. */
export const LOOP_PLAYS = 20;
/** Days with more listening than this are scaled down to it in rankings. */
export const LONG_DAY_HOURS = 12;
export const DEFAULT_TZ = 'Europe/Brussels';

const AUDIO_FILE = /Streaming_History_Audio_.*\.json$/i;

/** Read the audio history files from the export zip (as bytes). */
export function readZip(bytes: Uint8Array): RawStream[] {
  const files = unzipSync(bytes, { filter: (f) => AUDIO_FILE.test(f.name) });
  const names = Object.keys(files).sort();
  if (!names.length) throw new Error('No Streaming_History_Audio_*.json files in this zip.');
  return names.flatMap((n) => parseJsonFile(strFromU8(files[n]), n));
}

export function parseJsonFile(text: string, name = 'file'): RawStream[] {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error(`${name} is not a streaming history array.`);
  return data;
}

export function songKey(artist: string, track: string): string {
  const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${norm(artist)}\u0000${norm(track)}`;
}

function dayFormatter(timeZone: string) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** Normalize raw entries and flag background-loop days. */
export function buildHistory(raw: RawStream[], timeZone = DEFAULT_TZ): History {
  const fmt = dayFormatter(timeZone);
  // Intl is slow for ~84k calls; cache per 15 minutes (zone offsets are multiples of that).
  const dayCache = new Map<number, string>();
  const dayOf = (t: number) => {
    const bucket = Math.floor(t / 900_000);
    let d = dayCache.get(bucket);
    if (!d) dayCache.set(bucket, (d = fmt.format(new Date(bucket * 900_000))));
    return d;
  };

  const streams: Stream[] = [];
  let skippedEntries = 0;
  for (const r of raw) {
    const track = r.master_metadata_track_name;
    const artist = r.master_metadata_album_artist_name;
    const ts = Date.parse(r.ts);
    if (!track || !artist || Number.isNaN(ts)) {
      skippedEntries++;
      continue;
    }
    const ms = Math.max(0, Number(r.ms_played) || 0);
    const day = dayOf(ts);
    streams.push({
      ts,
      day,
      year: Number(day.slice(0, 4)),
      ms,
      track,
      artist,
      album: r.master_metadata_album_album_name ?? '',
      uri: r.spotify_track_uri ?? null,
      key: songKey(artist, track),
      skipped: !!r.skipped,
      isPlay: ms >= PLAY_MS,
      weight: 1,
    });
  }
  streams.sort((a, b) => a.ts - b.ts);
  const plays = streams.filter((s) => s.isPlay);

  // Cap each song at DAY_CAP plays per day; flag LOOP_PLAYS+ as a background loop.
  const perDaySong = new Map<string, Stream[]>();
  for (const p of plays) {
    const k = `${p.day}\u0001${p.key}`;
    let list = perDaySong.get(k);
    if (!list) perDaySong.set(k, (list = []));
    list.push(p);
  }
  const loops: LoopFlag[] = [];
  for (const list of perDaySong.values()) {
    if (list.length <= DAY_CAP) continue;
    const w = DAY_CAP / list.length;
    for (const p of list) p.weight = w;
    if (list.length >= LOOP_PLAYS) loops.push({ day: list[0].day, key: list[0].key, track: list[0].track, artist: list[0].artist, plays: list.length });
  }

  // Long days: scale the whole day so it counts as at most LONG_DAY_HOURS.
  const perDay = new Map<string, Stream[]>();
  for (const p of streams) {
    let list = perDay.get(p.day);
    if (!list) perDay.set(p.day, (list = []));
    list.push(p);
  }
  const longDays: LongDayFlag[] = [];
  const limit = LONG_DAY_HOURS * 3_600_000;
  for (const [day, list] of perDay) {
    const raw = list.reduce((sum, p) => sum + p.ms, 0);
    if (raw <= limit) continue; // flag on raw time: nobody actively listens 12 h+
    longDays.push({ day, hours: Math.round(raw / 360_000) / 10 });
    const weighted = list.reduce((sum, p) => sum + p.ms * p.weight, 0);
    if (weighted <= limit) continue;
    const f = limit / weighted;
    for (const p of list) p.weight *= f;
  }

  loops.sort((a, b) => b.plays - a.plays);
  longDays.sort((a, b) => b.hours - a.hours);
  return { streams, plays, skippedEntries, loops, longDays };
}
