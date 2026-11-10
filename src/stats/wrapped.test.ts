import { describe, expect, it } from 'vitest';
import { buildHistory } from './history';
import { buildWrapped, longestStreak } from './wrapped';
import { fixtureStreams } from './fixture';

describe('buildWrapped', () => {
  const w = buildWrapped(buildHistory(fixtureStreams(), 'Europe/Brussels'));

  it('totals', () => {
    expect(w.totals).toMatchObject({ streams: 58, plays: 56, first: '2011-12-21', last: '2019-07-01', missingYears: [2013, 2015, 2016, 2017, 2018] });
    expect(w.totals.hours).toBeLessThan(w.totals.rawHours);
  });

  it('first ever stream and first play', () => {
    expect(w.firstStream).toMatchObject({ track: 'First Light', ms: 10_000 });
    expect(w.firstPlay).toMatchObject({ track: 'First Light', ms: 200_000 });
  });

  it('most-played songs use weighted plays', () => {
    expect(w.topSongs.slice(0, 2).map((s) => [s.track, Math.round(s.plays), s.rawPlays])).toEqual([
      ['Overture', 14, 14],
      ['Repeat Me', 10, 25],
    ]);
  });

  it('top artists by hours', () => {
    expect(w.topArtists[0].artist).toBe('Test Pattern');
    expect(w.topArtists[0].hours).toBeCloseTo(12.5);
    expect(w.topArtists[0].rawHours).toBeCloseTo(14.25);
  });

  it('biggest day, streak and most exploratory year', () => {
    expect(w.biggestDay).toMatchObject({ day: '2014-03-04', plays: 28 });
    expect(w.biggestDay!.hours).toBeCloseTo(13 * 3 / 60); // 3 Overture + 25 loops counted as 10
    expect(w.biggestDay!.topSong!.track).toBe('Repeat Me');
    expect(w.rawBiggestDay).toMatchObject({ day: '2019-07-01', plays: 13 });
    expect(w.rawBiggestDay!.hours).toBeCloseTo(13);
    expect(w.longestStreak).toEqual({ days: 4, from: '2014-03-01', to: '2014-03-04' });
    expect(w.mostExploratoryYear).toEqual({ year: 2014, artists: 3 });
  });

  it('year chapters', () => {
    expect(w.years.map((y) => y.year)).toEqual([2011, 2012, 2014, 2019]);
    const y2014 = w.years.find((y) => y.year === 2014)!;
    expect(y2014.topSong!.track).toBe('Overture'); // the loop doesn't win
    expect(y2014.topArtist!.artist).toBe('Mock Orchestra');
    expect(y2014.discovery!.artist).toBe('Mock Orchestra'); // Example Echo was found in 2012
    expect(y2014.plays).toBe(40);
    const y2012 = w.years.find((y) => y.year === 2012)!;
    expect(y2012.discovery!.artist).toBe('Example Echo');
    expect(y2012.songs).toBe(2);
  });
});

describe('longestStreak', () => {
  it('handles month ends and duplicates', () => {
    expect(longestStreak(['2020-02-28', '2020-02-29', '2020-03-01', '2020-03-01', '2020-03-03'])).toEqual({ days: 3, from: '2020-02-28', to: '2020-03-01' });
    expect(longestStreak([])).toBeNull();
  });
});
