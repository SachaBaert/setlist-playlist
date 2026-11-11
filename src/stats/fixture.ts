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

/**
 * A three-year history for era detection (2020-01..2022-12), separate from the
 * main fixture so its numbers stay put. Every month has 20 filler artists with
 * 3 plays each (~3% share, never an era), plus:
 * - "Alpha Band": 40 plays/month in 2020 → one era, 2020-01..2020-12.
 * - "Flash": 60 plays in 2020-06 only → a binge, not an era.
 * - "Punk One" (30/month) and "Punk Two" (25/month), 2021-03..2022-02 → one shared era.
 * - "Late Find": 40/month from 2022-07 → an ongoing era.
 */
export function erasFixture(): RawStream[] {
  const out: RawStream[] = [];
  const month = (y: number, m: number, artist: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const t = new Date(Date.UTC(y, m - 1, (i % 28) + 1, 12, i % 60)).toISOString();
      out.push(s(t, artist, `${artist} Song ${(i % 5) + 1}`, 3 * MIN));
    }
  };
  for (let y = 2020; y <= 2022; y++) {
    for (let m = 1; m <= 12; m++) {
      for (let f = 1; f <= 20; f++) month(y, m, `Filler ${f}`, 3);
      const ym = y * 12 + m;
      if (y === 2020) month(y, m, 'Alpha Band', 40);
      if (y === 2020 && m === 6) month(y, m, 'Flash', 60);
      if (ym >= 2021 * 12 + 3 && ym <= 2022 * 12 + 2) {
        month(y, m, 'Punk One', 30);
        month(y, m, 'Punk Two', 25);
      }
      if (y === 2022 && m >= 7) month(y, m, 'Late Find', 40);
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

/** `count` plays of 3 minutes in one month, one a day from the 1st, cycling 5 songs (or one `song`). */
function monthPlays(out: RawStream[], y: number, m: number, artist: string, count: number, song?: string) {
  for (let i = 0; i < count; i++) {
    const t = new Date(Date.UTC(y, m - 1, (i % 28) + 1, 14, i % 60)).toISOString();
    out.push(s(t, artist, song ?? `${artist} Song ${(i % 5) + 1}`, 3 * MIN));
  }
}

/**
 * Comebacks, forgotten favorites and gems (2016-01..2024-12, separate from the
 * main fixture). "Steady" plays 5×/month throughout (days 1–5), so every month has data.
 * - "Old Flame": 10/month in 2016, one stray play in 2019-05, back 10/month 2022-03..08
 *   → comeback after 62 silent months.
 * - "Gone Band": 15/month 2017-01..06 (5 songs × 18), never again → forgotten favorite.
 * - "Brief": "Brief Hit" 12× in 2018-05 → a gem, but too little for a favorite.
 * - "Recent": "Recent Hit" 15× in 2024-06 → too recent to be forgotten.
 * Gems (last play ≤ 2022-12, 10+ plays, max 3 per artist): 3 Old Flame, 3 Gone Band, Brief Hit.
 */
export function rediscoverFixture(): RawStream[] {
  const out: RawStream[] = [];
  for (let y = 2016; y <= 2024; y++) {
    for (let m = 1; m <= 12; m++) {
      monthPlays(out, y, m, 'Steady', 5);
      const ym = y * 12 + m;
      if (y === 2016) monthPlays(out, y, m, 'Old Flame', 10);
      if (ym >= 2022 * 12 + 3 && ym <= 2022 * 12 + 8) monthPlays(out, y, m, 'Old Flame', 10);
      if (y === 2017 && m <= 6) monthPlays(out, y, m, 'Gone Band', 15);
    }
  }
  out.push(s('2019-05-20T10:00:00Z', 'Old Flame', 'Old Flame Song 1', 3 * MIN));
  monthPlays(out, 2018, 5, 'Brief', 12, 'Brief Hit');
  monthPlays(out, 2024, 6, 'Recent', 15, 'Recent Hit');
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

/**
 * Discover (2019-01..2025-12, separate from the main fixture), with fake Last.fm
 * data in `discoverSimilar`. Seeds by window:
 * - "Old Fave": 30/month in 2019 only → a seed for "all time", not for "recent".
 * - "Now Band": 20/month 2023-01..2025-12; "Also Now": 10/month in 2025 → recent and last-year seeds.
 * - "The Heard Once": one 10 s stream in 2024 → known (any stream counts), never suggested.
 * - "Now Band" song "Now Band Song 1" loops 40× on 2025-03-01 (weighted, so it doesn't swamp "Also Now").
 */
export function discoverFixture(): RawStream[] {
  const out: RawStream[] = [];
  for (let y = 2019; y <= 2025; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2019) monthPlays(out, y, m, 'Old Fave', 30);
      if (y >= 2023) monthPlays(out, y, m, 'Now Band', 20);
      if (y === 2025) monthPlays(out, y, m, 'Also Now', 10);
    }
  }
  for (let i = 0; i < 40; i++) out.push(s(new Date(Date.UTC(2025, 2, 1, 8, 0) + i * 3 * MIN).toISOString(), 'Now Band', 'Now Band Song 1', 3 * MIN));
  out.push(s('2024-04-02T10:00:00Z', 'The Heard Once', 'Once', 10_000));
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

/** Fake Last.fm artist.getSimilar answers for discoverFixture's artists. */
export const discoverSimilar: Record<string, { name: string; match: number }[]> = {
  'Now Band': [
    { name: 'Also Now', match: 1 }, // known
    { name: 'Heard Once', match: 0.9 }, // known, spelled without "The"
    { name: 'Fresh One', match: 0.8 },
    { name: 'Shared Find', match: 0.5 },
  ],
  'Also Now': [
    { name: 'Shared Find', match: 0.9 },
    { name: 'Fresh Two', match: 0.4 },
    { name: 'Now Band', match: 1 },
  ],
  'Old Fave': [{ name: 'Old School', match: 1 }],
  // Second hop
  'Fresh One': [
    { name: 'Far Away', match: 1 },
    { name: 'Shared Find', match: 1 }, // already hop 1
  ],
  'Shared Find': [{ name: 'Further Out', match: 0.5 }],
};

/**
 * Fake `GET /me/player/recently-played` answer for the tracker, continuing the
 * main fixture (whose export ends on 2019-07-01 at 10:30 UTC, "Long Track 13"):
 * - "Long Track 6" at 2019-07-01T05:30Z: already in the export → dropped when merged.
 * - 3 new plays after the export: 2019-07-02 (twice "Echo One") and 2019-08-01T00:10Z
 *   (a new UTC month, stored under listens:2019-08). "Tiny Intro" is 12 s long, still a play.
 * - A podcast episode and a null track: ignored.
 */
export function recentlyPlayedFixture() {
  const item = (played_at: string, artist: string, name: string, duration_ms: number) => ({
    played_at,
    track: { type: 'track', name, duration_ms, uri: `spotify:track:fake${(artist + name).replace(/\W/g, '')}`, artists: [{ name: artist }], album: { name: `${artist} album` } },
  });
  return {
    items: [
      item('2019-08-01T00:10:00.000Z', 'Mock Orchestra', 'Tiny Intro', 12_000),
      { played_at: '2019-07-20T10:00:00.000Z', track: { type: 'episode', name: 'Fake Pod 2', duration_ms: 1_800_000 } },
      { played_at: '2019-07-20T11:00:00.000Z', track: null },
      item('2019-07-02T12:05:00.000Z', 'Example Echo', 'Echo One', 200_000),
      item('2019-07-02T12:00:00.000Z', 'Example Echo', 'Echo One', 200_000),
      item('2019-07-01T05:30:00.000Z', 'Test Pattern', 'Long Track 6', 3_600_000),
    ],
    cursors: { after: '1564618200000', before: '1561959000000' },
  };
}
