import { describe, expect, it } from 'vitest';
import { cleanSearchResults, isoDate, mixDescription, mixName, mixToText, prepareMix } from './concerts';
import type { Setlist } from './setlistfm';

const show = (date: string, songs: string[], extra: Partial<Setlist> = {}): Setlist => ({
  artist: 'Kneecap',
  artistUrl: 'https://www.setlist.fm/setlists/kneecap-63d6e2a3.html',
  tour: 'Fine Art Tour',
  date,
  venue: 'Venue',
  city: 'City',
  url: `https://www.setlist.fm/setlist/kneecap/x-${date}.html`,
  songs: songs.map((name) => ({ name, tape: name.startsWith('tape:'), cover: name === 'Favourite' ? 'Fontaines D.C.' : null, encore: false })),
  ...extra,
});

const TODAY = '2025-11-10';

describe('isoDate', () => {
  it('turns dd-MM-yyyy into a sortable date', () => {
    expect(isoDate('27-06-2025')).toBe('2025-06-27');
    expect(isoDate('')).toBe('');
  });
});

describe('cleanSearchResults', () => {
  it('keeps exact artist matches, newest first', () => {
    const results = cleanSearchResults('kneecap', [
      show('01-03-2025', ['A']),
      show('05-04-2025', ['A'], { artist: 'Kneecap Tribute' }),
      show('01-05-2025', ['A']),
    ]);
    expect(results.map((s) => s.date)).toEqual(['01-05-2025', '01-03-2025']);
  });
  it('falls back to everything when nothing matches exactly', () => {
    expect(cleanSearchResults('knee', [show('01-03-2025', ['A'])])).toHaveLength(1);
  });
});

describe('prepareMix', () => {
  it('skips empty and future setlists and keeps to the latest tour', () => {
    const mix = prepareMix(
      [
        show('20-12-2025', []), // upcoming
        show('01-11-2025', []), // past but no songs entered
        show('20-10-2025', ['A', 'B']),
        show('10-10-2025', ['A', 'B']),
        show('01-01-2024', ['Old'], { tour: 'Old Tour' }),
      ],
      TODAY,
    )!;
    expect(mix.shows.map((s) => s.date)).toEqual(['20-10-2025', '10-10-2025']);
    expect(mix.tour).toBe('Fine Art Tour');
    expect(mix.songs.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('drops rarities, ignores tapes and orders by usual position', () => {
    const mix = prepareMix(
      [
        show('03-10-2025', ['tape:Intro', 'Opener', 'Mid', 'Rare', 'Closer']),
        show('02-10-2025', ['Opener', 'Mid', 'Favourite', 'Closer']),
        show('01-10-2025', ['Opener', 'Favourite', 'Mid', 'Closer']),
      ],
      TODAY,
    )!;
    // 3 shows, threshold 1 -> Rare stays; with a 1/2 share it goes
    expect(mix.songs.map((s) => s.name)).toContain('Rare');
    const strict = prepareMix(mix.shows, TODAY, 10, 1 / 2)!;
    expect(strict.songs.map((s) => s.name)).toEqual(['Opener', 'Mid', 'Favourite', 'Closer']);
    expect(strict.songs.find((s) => s.name === 'Opener')!.played).toBe(3);
    expect(mixToText(strict)).toBe('1. Opener\n2. Mid\n3. Favourite | Fontaines D.C.\n4. Closer');
  });

  it('limits to the most recent shows and counts a reprise once', () => {
    const many = Array.from({ length: 12 }, (_, i) => show(`${String(i + 1).padStart(2, '0')}-09-2025`, ['A', 'A']));
    const mix = prepareMix(many, TODAY)!;
    expect(mix.shows).toHaveLength(10);
    expect(mix.shows[0].date).toBe('12-09-2025');
    expect(mix.songs[0].played).toBe(10);
  });

  it('uses all shows when there is no tour name', () => {
    const mix = prepareMix([show('02-10-2025', ['A'], { tour: '' }), show('01-10-2025', ['A'], { tour: 'Other' })], TODAY)!;
    expect(mix.shows).toHaveLength(2);
    expect(mixName(mix)).toBe('Kneecap (prep mix)');
  });

  it('returns null when no past show has songs', () => {
    expect(prepareMix([show('20-12-2025', ['A']), show('01-10-2025', [])], TODAY)).toBeNull();
  });

  it('names and credits the mix', () => {
    const mix = prepareMix([show('01-10-2025', ['A'])], TODAY)!;
    expect(mixName(mix)).toBe('Kneecap – Fine Art Tour (prep mix)');
    expect(mixDescription(mix)).toContain('their latest setlist on setlist.fm');
    expect(mixDescription(mix)).toContain('kneecap-63d6e2a3.html');
  });
});
