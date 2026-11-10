// Synthetic streaming-history export for tests. Fake artists, no IPs, no
// country codes: safe to commit. Shaped like Spotify's Extended Streaming
// History so later rounds can test without the real export.
//
// What's in it (answers asserted in history.test.ts / wrapped.test.ts):
// - 2011-12-21: first ever stream (10 s, not a play), then a real play.
// - 2012: a couple of plays, one 20 s skip, one podcast entry (ignored).
// - 2013, 2015-2018: no data.
// - 2014-03-01..04: a 4-day streak with "Overture" 3x a day; on 03-04 "Repeat Me"
//   loops 25x in the background (counts as 10); "Overture" gets 14 plays and wins 2014.
// - 2019-07-01 (Brussels time; starts 2019-06-30 22:30 UTC): a 13-hour day of
//   13 distinct one-hour tracks, scaled down to 12 h and kept out of "biggest day".
// - So the biggest day is 2014-03-04 (Overture 3x + Repeat Me capped at 10).

import { strToU8, zipSync } from 'fflate';
import type { RawStream } from './history';

const MIN = 60_000;

function s(ts: string, artist: string | null, track: string | null, ms: number, extra: Partial<RawStream> = {}): RawStream {
  return {
    ts,
    platform: 'test',
    ms_played: ms,
    master_metadata_track_name: track,
    master_metadata_album_artist_name: artist,
    master_metadata_album_album_name: track ? `${artist} album` : null,
    spotify_track_uri: track ? `spotify:track:fake${(artist! + track).replace(/\W/g, '')}` : null,
    episode_name: null,
    episode_show_name: null,
    spotify_episode_uri: null,
    reason_start: 'clickrow',
    reason_end: ms >= 30_000 ? 'trackdone' : 'fwdbtn',
    shuffle: false,
    skipped: ms < 30_000,
    offline: false,
    incognito_mode: false,
    ...extra,
  };
}

function early(): RawStream[] {
  return [
    s('2011-12-21T12:00:00Z', 'The Placeholders', 'First Light', 10_000),
    s('2011-12-21T12:05:00Z', 'The Placeholders', 'First Light', 200_000),
    s('2012-05-01T12:00:00Z', 'The Placeholders', 'First Light', 200_000),
    s('2012-05-02T12:00:00Z', 'Example Echo', 'Echo One', 200_000),
    s('2012-05-02T12:10:00Z', 'Example Echo', 'Echo One', 20_000),
    s('2012-05-03T12:00:00Z', null, null, 1_800_000, { episode_name: 'Fake Pod 1', episode_show_name: 'Fake Pod', spotify_episode_uri: 'spotify:episode:fake1' }),
  ];
}

function y2014(): RawStream[] {
  const out: RawStream[] = [];
  for (const d of ['01', '02', '03', '04']) {
    for (const t of ['09:00', '09:05', '09:10']) out.push(s(`2014-03-${d}T${t}:00Z`, 'Mock Orchestra', 'Overture', 3 * MIN));
  }
  for (let i = 0; i < 25; i++) {
    const t = new Date(Date.UTC(2014, 2, 4, 10, 0) + i * 3 * MIN).toISOString();
    out.push(s(t, 'Test Pattern', 'Repeat Me', 3 * MIN, { reason_start: 'trackdone' }));
  }
  out.push(s('2014-03-10T12:00:00Z', 'Example Echo', 'Echo One', 3 * MIN));
  out.push(s('2014-03-10T12:05:00Z', 'Mock Orchestra', 'Overture', 3 * MIN));
  out.push(s('2014-03-11T12:00:00Z', 'Mock Orchestra', 'Overture', 3 * MIN));
  return out;
}

function y2019(): RawStream[] {
  const out: RawStream[] = [];
  for (let i = 0; i < 13; i++) {
    const t = new Date(Date.UTC(2019, 5, 30, 22, 30) + i * 60 * MIN).toISOString();
    out.push(s(t, 'Test Pattern', `Long Track ${i + 1}`, 60 * MIN));
  }
  return out;
}

/** The raw entries, as one flat list (what readZip returns). */
export function fixtureStreams(): RawStream[] {
  return [...early(), ...y2014(), ...y2019()];
}

/** A zip shaped like the real export, including files that must be ignored. */
export function fixtureZip(): Uint8Array {
  return zipSync({
    'Spotify Extended Streaming History/Streaming_History_Audio_2011-2012.json': strToU8(JSON.stringify(early())),
    'Spotify Extended Streaming History/Streaming_History_Audio_2014-2019.json': strToU8(JSON.stringify([...y2014(), ...y2019()])),
    'Spotify Extended Streaming History/Streaming_History_Video_2020.json': strToU8('not json, must be skipped'),
    'Spotify Extended Streaming History/ReadMeFirst_ExtendedStreamingHistory.pdf': strToU8('%PDF fake'),
  });
}
