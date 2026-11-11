// Local cache of the history (pure part): what is kept, and how an export and
// tracked plays merge. Only the fields the stats use are stored: never
// ip_addr, conn_country, platform or other device details.

import { PLAY_MS, type RawStream } from './history';

/** A play logged by the Worker's tracker (GET /tracker/listens). */
export interface Listen {
  ts: string; // played_at, ISO
  track: string;
  artist: string;
  album: string;
  uri: string | null;
  ms: number; // track length: Spotify doesn't say how long it played
}

/** A raw stream as cached. `source: 'tracker'` marks plays that didn't come from an export. */
export type CachedStream = RawStream & { source?: 'tracker' };

/** Keep only what the stats read. */
export function slim(raw: RawStream[]): CachedStream[] {
  return raw.map((r) => ({
    ts: r.ts,
    ms_played: r.ms_played,
    master_metadata_track_name: r.master_metadata_track_name ?? null,
    master_metadata_album_artist_name: r.master_metadata_album_artist_name ?? null,
    master_metadata_album_album_name: r.master_metadata_album_album_name ?? null,
    spotify_track_uri: r.spotify_track_uri ?? null,
    skipped: r.skipped ?? null,
    ...((r as CachedStream).source === 'tracker' ? { source: 'tracker' as const } : {}),
  }));
}

/** Tracked plays as streams. Each counts as a play (Spotify only lists 30 s+), so ms is at least PLAY_MS. */
export function fromListens(listens: Listen[]): CachedStream[] {
  return listens.map((l) => ({
    ts: l.ts,
    ms_played: Math.max(l.ms, PLAY_MS),
    master_metadata_track_name: l.track,
    master_metadata_album_artist_name: l.artist,
    master_metadata_album_album_name: l.album,
    spotify_track_uri: l.uri,
    skipped: false,
    source: 'tracker',
  }));
}

const time = (s: CachedStream) => Date.parse(s.ts);
const id = (s: CachedStream) => `${s.spotify_track_uri ?? `${s.master_metadata_album_artist_name}\u0000${s.master_metadata_track_name}`}\u0001${time(s)}`;

/** End of the export data (ms), or null if there is none. */
export function exportEnd(raw: CachedStream[]): number | null {
  let end: number | null = null;
  for (const s of raw) if (s.source !== 'tracker' && (end === null || time(s) > end)) end = time(s);
  return end;
}

/**
 * Merge new entries in. Dedupes on track URI + timestamp. Where an export covers
 * a period, it wins: tracked plays up to the export's last stream are dropped
 * (the export has them too, with real play times and skips).
 */
export function mergeStreams(existing: CachedStream[], incoming: CachedStream[]): CachedStream[] {
  const all = [...existing, ...incoming];
  const end = exportEnd(all) ?? -Infinity;
  const seen = new Map<string, CachedStream>();
  for (const s of all) {
    if (Number.isNaN(time(s)) || (s.source === 'tracker' && time(s) <= end)) continue;
    const k = id(s);
    if (!seen.has(k)) seen.set(k, s);
  }
  return [...seen.values()].sort((a, b) => time(a) - time(b));
}

/** The latest timestamp in the cache (ms), to ask the tracker only for newer plays. */
export function latest(raw: CachedStream[]): number {
  return raw.reduce((max, s) => Math.max(max, time(s) || 0), 0);
}

export interface Coverage {
  exportEnd: string | null; // ISO
  tracked: number;
  trackedFrom: string | null;
  trackedTo: string | null;
}

export function coverage(raw: CachedStream[]): Coverage {
  const tracked = raw.filter((s) => s.source === 'tracker');
  const end = exportEnd(raw);
  return {
    exportEnd: end === null ? null : new Date(end).toISOString(),
    tracked: tracked.length,
    trackedFrom: tracked[0]?.ts ?? null,
    trackedTo: tracked.at(-1)?.ts ?? null,
  };
}

/** What goes to the Worker's copy: export plays only (tracked ones are there already), no podcast stubs. */
export function forUpload(raw: CachedStream[]): CachedStream[] {
  return raw.filter((s) => s.source !== 'tracker' && s.master_metadata_track_name && s.master_metadata_album_artist_name);
}
