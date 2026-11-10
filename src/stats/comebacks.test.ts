import { describe, expect, it } from 'vitest';
import { buildHistory } from './history';
import { rediscover } from './comebacks';
import { fixtureStreams, rediscoverFixture } from './fixture';

describe('rediscover', () => {
  const r = rediscover(buildHistory(rediscoverFixture()));

  it('finds the comeback despite a stray play in the silence', () => {
    expect(r.comebacks.map((c) => c.artist)).toEqual(['Old Flame']);
    const c = r.comebacks[0];
    expect(c).toMatchObject({ before: { from: '2016-01', to: '2016-12' }, silentMonths: 62, back: '2022-03' });
    expect(Math.round(c.before.plays)).toBe(120);
    expect(Math.round(c.after)).toBe(60);
    expect(c.playlist.name).toBe('Old Flame: the 2016 years');
    expect(c.playlist.songs).toHaveLength(5);
  });

  it('finds forgotten favorites, not small or steady artists', () => {
    expect(r.forgotten.map((f) => [f.artist, f.from, f.last, Math.round(f.plays)])).toEqual([['Gone Band', '2017-01', '2017-06', 90]]);
    expect(r.forgotten[0].playlist.songs.map((s) => s.uri)).toEqual(expect.arrayContaining([expect.stringMatching(/^spotify:track:/)]));
  });

  it('builds the forgotten gems playlist, max 3 per artist', () => {
    const gems = r.gems!;
    expect(gems.name).toBe('Forgotten gems');
    const byArtist = gems.songs.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.artist]: (acc[s.artist] ?? 0) + 1 }), {});
    expect(byArtist).toEqual({ 'Old Flame': 3, 'Gone Band': 3, Brief: 1 });
    expect(gems.songs.map((s) => s.track)).not.toContain('Recent Hit');
    expect(gems.songs.at(-1)!.track).toBe('Brief Hit');
  });

  it('handles small and empty histories', () => {
    expect(rediscover(buildHistory([]))).toEqual({ comebacks: [], forgotten: [], gems: null });
    expect(rediscover(buildHistory(fixtureStreams())).comebacks).toEqual([]);
  });
});
