import { describe, expect, it } from 'vitest';
import { buildHistory } from './history';
import { coverage, fromListens, latest, mergeStreams, slim } from './cache';
import { fixtureStreams, recentlyPlayedFixture } from './fixture';
// @ts-expect-error plain JS Worker module
import { fromRecentlyPlayed } from '../../worker/tracker.js';

const exported = () => slim(fixtureStreams());
const tracked = () => fromListens(fromRecentlyPlayed(recentlyPlayedFixture().items));

describe('slim', () => {
  it('keeps only the fields the stats read', () => {
    const raw = fixtureStreams().map((r) => ({ ...r, ip_addr: '192.0.2.1', conn_country: 'BE' }));
    const keys = new Set(slim(raw).flatMap((r) => Object.keys(r)));
    expect(keys).not.toContain('ip_addr');
    expect(keys).not.toContain('conn_country');
    expect(keys).not.toContain('platform');
    expect(keys).not.toContain('source');
  });

  it('gives the same history as the full export', () => {
    const full = buildHistory(fixtureStreams());
    const cached = buildHistory(exported());
    expect(cached.plays).toHaveLength(full.plays.length);
    expect(cached.skippedEntries).toBe(full.skippedEntries);
    expect(cached.loops).toEqual(full.loops);
  });
});

describe('mergeStreams', () => {
  it('dedupes on track URI + timestamp when the same export is loaded twice', () => {
    const once = mergeStreams([], exported());
    expect(mergeStreams(once, exported())).toEqual(once);
  });

  it('adds tracked plays after the export and drops the ones it covers', () => {
    const merged = mergeStreams(exported(), tracked());
    expect(merged).toHaveLength(fixtureStreams().length + 3);
    expect(merged.filter((s) => s.source === 'tracker').map((s) => s.master_metadata_track_name)).toEqual(['Echo One', 'Echo One', 'Tiny Intro']);
    const h = buildHistory(merged);
    expect(h.plays).toHaveLength(56 + 3); // every tracked listen is a play, even a 12 s one
  });

  it('lets a newer export replace tracked plays in the period it covers', () => {
    const withTracked = mergeStreams(exported(), tracked());
    const newExport = slim([{ ts: '2019-08-02T09:00:00Z', ms_played: 200_000, master_metadata_track_name: 'Echo One', master_metadata_album_artist_name: 'Example Echo', spotify_track_uri: 'spotify:track:fakeExampleEchoEchoOne' }]);
    const merged = mergeStreams(withTracked, newExport);
    expect(merged.filter((s) => s.source === 'tracker')).toEqual([]);
    expect(merged.at(-1)!.ts).toBe('2019-08-02T09:00:00Z');
  });

  it('keeps tracked plays when there is no export yet', () => {
    expect(mergeStreams([], tracked())).toHaveLength(4); // incl. the one an export would cover
  });
});

describe('coverage and latest', () => {
  it('says where the export ends and what was tracked', () => {
    const merged = mergeStreams(exported(), tracked());
    expect(coverage(merged)).toEqual({ exportEnd: '2019-07-01T10:30:00.000Z', tracked: 3, trackedFrom: '2019-07-02T12:00:00.000Z', trackedTo: '2019-08-01T00:10:00.000Z' });
    expect(latest(merged)).toBe(Date.parse('2019-08-01T00:10:00Z'));
  });
});
