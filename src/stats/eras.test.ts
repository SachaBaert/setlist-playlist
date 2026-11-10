import { describe, expect, it } from 'vitest';
import { buildHistory } from './history';
import { detectEras } from './eras';
import { erasFixture, fixtureStreams } from './fixture';

describe('detectEras', () => {
  const eras = detectEras(buildHistory(erasFixture()));
  const brief = eras.map((e) => ({ artists: e.artists, from: e.from, to: e.to, ongoing: e.ongoing }));

  it('finds the three eras, merges the shared one, ignores the binge', () => {
    expect(brief).toEqual([
      { artists: ['Alpha Band'], from: '2020-01', to: '2020-12', ongoing: false },
      { artists: ['Punk One', 'Punk Two'], from: '2021-03', to: '2022-02', ongoing: false },
      { artists: ['Late Find'], from: '2022-07', to: '2022-12', ongoing: true },
    ]);
  });

  it('adds totals and top songs', () => {
    const punk = eras[1];
    expect(punk.months).toBe(12);
    expect(Math.round(punk.plays)).toBe(12 * 55);
    expect(punk.topSongs[0].artist).toBe('Punk One');
  });

  it('handles tiny and empty histories', () => {
    expect(detectEras(buildHistory([]))).toEqual([]);
    expect(detectEras(buildHistory(fixtureStreams()))).toEqual(expect.any(Array));
  });
});
