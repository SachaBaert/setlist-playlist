import { describe, expect, it } from 'vitest';
import { buildHistory, readZip, songKey, DAY_CAP } from './history';
import { fixtureStreams, fixtureZip } from './fixture';

describe('readZip', () => {
  it('reads only the audio history files', () => {
    const raw = readZip(fixtureZip());
    expect(raw).toHaveLength(fixtureStreams().length);
    expect(raw[0].ts).toBe('2011-12-21T12:00:00Z');
  });

  it('explains a zip without history files', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    expect(() => readZip(zipSync({ 'other.json': strToU8('[]') }))).toThrow(/Streaming_History_Audio/);
  });
});

describe('buildHistory', () => {
  const h = buildHistory(fixtureStreams(), 'Europe/Brussels');

  it('keeps music streams only and counts plays from 30 s', () => {
    expect(h.streams).toHaveLength(58);
    expect(h.plays).toHaveLength(56);
    expect(h.skippedEntries).toBe(1); // the podcast
  });

  it('drops fields it does not need', () => {
    expect(Object.keys(h.streams[0])).not.toContain('platform');
  });

  it('uses the local day', () => {
    const first = h.streams.find((s) => s.track === 'Long Track 1')!;
    expect(first.day).toBe('2019-07-01'); // 22:30 UTC = 00:30 in Brussels
    expect(first.year).toBe(2019);
  });

  it('caps a song per day and flags background loops', () => {
    expect(h.loops).toEqual([{ day: '2014-03-04', key: songKey('Test Pattern', 'Repeat Me'), track: 'Repeat Me', artist: 'Test Pattern', plays: 25 }]);
    const loop = h.plays.filter((p) => p.track === 'Repeat Me');
    expect(loop.reduce((sum, p) => sum + p.weight, 0)).toBeCloseTo(DAY_CAP);
    expect(h.plays.find((p) => p.track === 'Overture' && p.day === '2014-03-04')!.weight).toBe(1);
  });

  it('caps without a cliff', () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({ ts: `2020-01-01T10:${String(i * 4).padStart(2, '0')}:00Z`, ms_played: 180_000, master_metadata_track_name: 'Song', master_metadata_album_artist_name: 'Band' }));
    const day = buildHistory(raw, 'UTC');
    expect(day.plays.reduce((sum, p) => sum + p.weight, 0)).toBeCloseTo(DAY_CAP);
    expect(day.loops).toEqual([]); // 12 plays: capped, but not a background loop
  });

  it('scales very long days down', () => {
    expect(h.longDays).toEqual([{ day: '2019-07-01', hours: 13 }]);
    const day = h.plays.filter((p) => p.day === '2019-07-01');
    expect(day.reduce((sum, p) => sum + p.ms * p.weight, 0) / 3_600_000).toBeCloseTo(12);
  });

  it('merges the same song across releases', () => {
    expect(songKey('KNEECAP', 'H.O.O.D.')).toBe(songKey('Kneecap ', 'h.o.o.d.'));
  });
});
