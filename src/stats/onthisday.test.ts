import { describe, expect, it } from 'vitest';
import { buildHistory } from './history';
import { onThisDay, shiftYears, todayIn } from './onthisday';
import { rediscoverFixture } from './fixture';

describe('onThisDay', () => {
  const h = buildHistory(rediscoverFixture());

  it('shows the exact date when there was music, and skips years without data', () => {
    const [five, ...rest] = onThisDay(h, '2024-12-03');
    expect(rest).toEqual([]); // 2014: no data
    expect(five).toMatchObject({ yearsAgo: 5, target: '2019-12-03', day: '2019-12-03', exact: true, plays: 1, artists: ['Steady'] });
    expect(five.topSongs[0].track).toBe('Steady Song 3');
  });

  it('falls back to the nearest day within 3 days', () => {
    expect(onThisDay(h, '2024-12-08')[0]).toMatchObject({ target: '2019-12-08', day: '2019-12-05', exact: false });
    expect(onThisDay(h, '2024-12-20')).toEqual([]);
  });

  it('shiftYears handles leap days', () => {
    expect(shiftYears('2028-02-29', 5)).toBe('2023-02-28');
    expect(shiftYears('2028-02-29', 4)).toBe('2024-02-29');
  });

  it('todayIn uses the time zone', () => {
    expect(todayIn('Europe/Brussels', new Date('2026-11-10T23:30:00Z'))).toBe('2026-11-11');
  });
});
