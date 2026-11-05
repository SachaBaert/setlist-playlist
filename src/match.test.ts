import { describe, expect, it } from 'vitest';
import { normalize, parseSetlist, rankCandidates, type Candidate } from './match';

const KNEECAP = { id: 'kc', name: 'Kneecap' };
const OTHER = { id: 'xx', name: 'Someone Else' };

function track(name: string, album_type = 'album', albumName = 'Fine Art', artists = [KNEECAP]): Candidate {
  return { id: name + album_type + albumName, name, artists, album: { name: albumName, album_type } };
}

describe('parseSetlist', () => {
  it('strips numbering, bullets and empty lines', () => {
    const text = '1. Éire go Deo\n2) Smugglers & Scholars\n\n- Carnival\n• H.O.O.D\n22. THE RECAP  ';
    expect(parseSetlist(text)).toEqual(['Éire go Deo', 'Smugglers & Scholars', 'Carnival', 'H.O.O.D', 'THE RECAP']);
  });
});

describe('normalize', () => {
  it('ignores accents, case and punctuation', () => {
    expect(normalize('Éire go Deo')).toBe(normalize('eire GO deo'));
    expect(normalize('H.O.O.D')).toBe(normalize('H O O D'));
    expect(normalize('Smugglers & Scholars')).toBe(normalize('Smugglers and Scholars'));
  });
  it('drops featuring parts and version suffixes', () => {
    expect(normalize('Better Way to Live (feat. Grian Chatten)')).toBe('better way to live');
    expect(normalize('Rhino Ket - Live at Glastonbury')).toBe('rhino ket');
  });
});

describe('rankCandidates', () => {
  it('prefers the studio album version over live and remix', () => {
    const ranked = rankCandidates(
      'Rhino Ket',
      [track('Rhino Ket - Live', 'album', 'Live in Belfast'), track('Rhino Ket (Remix)', 'single'), track('Rhino Ket')],
      'kc',
    );
    expect(ranked[0].track.name).toBe('Rhino Ket');
    expect(ranked[0].confidence).toBe('exact');
  });

  it('keeps a live version if the setlist asks for one', () => {
    const ranked = rankCandidates('Rhino Ket (Live)', [track('Rhino Ket'), track('Rhino Ket (Live)', 'album', 'Live')], 'kc');
    expect(ranked[0].track.name).toBe('Rhino Ket (Live)');
  });

  it('rejects tracks by other artists', () => {
    expect(rankCandidates('Carnival', [track('Carnival', 'album', 'X', [OTHER])], 'kc')).toEqual([]);
  });

  it('matches across accents and featured artists', () => {
    const ranked = rankCandidates('Better Way to Live', [track('Better Way To Live (feat. Grian Chatten)')], 'kc');
    expect(ranked[0].confidence).toBe('exact');
  });

  it('returns nothing for unrelated titles', () => {
    expect(rankCandidates('No Comment', [track('Fine Art'), track('Sayonara')], 'kc')).toEqual([]);
  });
});
