import { describe, expect, it } from 'vitest';
import { extractSetlistId, playlistDescription, playlistName, toSetlistText, type Setlist } from './setlistfm';

const SETLIST: Setlist = {
  artist: 'Kneecap',
  date: '27-06-2025',
  venue: 'Worthy Farm',
  city: 'Pilton',
  url: 'https://www.setlist.fm/setlist/kneecap/2025/x-3bd6a8c8.html',
  songs: [
    { name: 'Favourite', tape: true, cover: 'Fontaines D.C.', encore: false },
    { name: 'Éire go Deo', tape: false, cover: null, encore: false },
    { name: 'Get Your Brits Out', tape: false, cover: null, encore: true },
    { name: 'Bella Ciao', tape: true, cover: 'traditional', encore: true },
  ],
};

describe('extractSetlistId', () => {
  it('reads the id from a setlist.fm URL', () => {
    expect(extractSetlistId('https://www.setlist.fm/setlist/kneecap/2025/worthy-farm-pilton-england-3bd6a8c8.html')).toBe('3bd6a8c8');
  });
  it('accepts a bare id and rejects other input', () => {
    expect(extractSetlistId(' 3BD6A8C8 ')).toBe('3bd6a8c8');
    expect(extractSetlistId('https://example.com/whatever')).toBeNull();
  });
});

describe('toSetlistText', () => {
  it('skips tapes by default and renumbers', () => {
    expect(toSetlistText(SETLIST, false)).toBe('1. Éire go Deo\n2. Get Your Brits Out');
  });
  it('includes tapes with their original artist when asked', () => {
    expect(toSetlistText(SETLIST, true).split('\n')[0]).toBe('1. Favourite | Fontaines D.C.');
  });
});

describe('playlistName', () => {
  it('builds artist, place and ISO date', () => {
    expect(playlistName(SETLIST)).toBe('Kneecap – Worthy Farm, Pilton (2025-06-27)');
  });
});

describe('playlistDescription', () => {
  it('credits setlist.fm with a link when imported', () => {
    expect(playlistDescription('Kneecap', SETLIST.url)).toBe(`Kneecap setlist from setlist.fm: ${SETLIST.url}`);
  });
  it('falls back to a plain description for pasted lists', () => {
    expect(playlistDescription('Kneecap', null)).toContain('Setlist by Kneecap');
  });
});
