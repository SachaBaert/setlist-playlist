import { describe, expect, it } from 'vitest';
import { buildHistory, type RawStream } from './history';
import { rankSongs, yearPlaylists } from './yearlists';
import { fixtureStreams } from './fixture';

describe('yearPlaylists', () => {
  const lists = yearPlaylists(buildHistory(fixtureStreams()));

  it('starts in 2014 and skips years without plays', () => {
    expect(lists.map((l) => l.id)).toEqual(['year-2014', 'year-2019']);
  });

  it('ranks by weighted plays, so the background loop (25 raw) stays below Overture (14)', () => {
    const y2014 = lists[0];
    expect(y2014.name).toBe('Top 3 of 2014');
    expect(y2014.songs.map((s) => [s.track, Math.round(s.plays), s.rawPlays])).toEqual([
      ['Overture', 14, 14],
      ['Repeat Me', 10, 25],
      ['Echo One', 1, 1],
    ]);
    expect(y2014.songs[0].uri).toMatch(/^spotify:track:/);
  });

  it('caps at the requested size', () => {
    expect(yearPlaylists(buildHistory(fixtureStreams()), 5)[1].songs).toHaveLength(5);
  });
});

describe('rankSongs', () => {
  const at = (ts: string, track: string, uri: string | null): RawStream => ({
    ts, ms_played: 200_000, master_metadata_track_name: track, master_metadata_album_artist_name: 'A', spotify_track_uri: uri,
  });

  it('uses the most-played URI and skips songs without a track URI', () => {
    const h = buildHistory([
      at('2020-01-01T10:00:00Z', 'Song', 'spotify:track:old'),
      at('2020-01-02T10:00:00Z', 'Song', 'spotify:track:new'),
      at('2020-01-03T10:00:00Z', 'Song', 'spotify:track:new'),
      at('2020-01-04T10:00:00Z', 'Local', 'spotify:local:A::Local:200'),
      at('2020-01-04T11:00:00Z', 'Local', 'spotify:local:A::Local:200'),
      at('2020-01-05T10:00:00Z', 'Other', 'spotify:track:other'),
    ]);
    expect(rankSongs(h.plays).map((s) => [s.track, s.uri])).toEqual([
      ['Song', 'spotify:track:new'],
      ['Other', 'spotify:track:other'],
    ]);
  });
});
