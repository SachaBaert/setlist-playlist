import { describe, expect, it } from 'vitest';
import { buildHistory } from './history';
import type { Era } from './eras';
import { discoverFixture, discoverSimilar } from './fixture';
import {
  artistKey,
  discoverDescription,
  heardUris,
  knownArtists,
  pickTracks,
  rankNewArtists,
  seedArtists,
  steppingStones,
  DESCRIPTION_MAX,
  type NewArtist,
} from './discover';

const hist = buildHistory(discoverFixture());
const similar = (a: string) => discoverSimilar[a];
const known = knownArtists(hist);

describe('seedArtists', () => {
  it('uses the recent years by default, weighted (the loop day counts as 10)', () => {
    const seeds = seedArtists(hist);
    expect(seeds.map((s) => [s.artist, Math.round(s.plays)])).toEqual([
      ['Now Band', 729],
      ['Also Now', 120],
    ]);
    expect(seeds.reduce((sum, s) => sum + s.weight, 0)).toBeCloseTo(1);
  });

  it('supports last year, all time and an era', () => {
    expect(seedArtists(hist, { kind: 'year' }).map((s) => [s.artist, Math.round(s.plays)])).toEqual([
      ['Now Band', 249],
      ['Also Now', 120],
    ]);
    expect(seedArtists(hist, { kind: 'all' }).map((s) => s.artist)).toEqual(['Now Band', 'Old Fave', 'Also Now']);
    const era = { artists: ['Old Fave'], from: '2019-01', to: '2019-12' } as Era;
    expect(seedArtists(hist, { kind: 'era', era })).toEqual([{ artist: 'Old Fave', plays: 360, weight: 1 }]);
  });

  it('handles an empty history', () => {
    expect(seedArtists(buildHistory([]))).toEqual([]);
  });
});

describe('never heard', () => {
  it('counts any stream, across spellings', () => {
    expect(known.has(artistKey('Heard Once'))).toBe(true); // 10 s stream of "The Heard Once"
    expect(artistKey('The Beatles & Co.')).toBe(artistKey('beatles and co'));
    expect(artistKey('Sigur Rós')).toBe(artistKey('Sigur Ros'));
    expect(known.has(artistKey('Fresh One'))).toBe(false);
  });
});

describe('rankNewArtists', () => {
  const seeds = seedArtists(hist);

  it('scores by summed similarity x seed share and skips known artists', () => {
    const ranked = rankNewArtists(seeds, similar, known);
    expect(ranked.map((a) => [a.artist, a.via, a.hops])).toEqual([
      ['Fresh One', 'Now Band', 1],
      ['Shared Find', 'Now Band', 1],
      ['Fresh Two', 'Also Now', 1],
    ]);
    const w = seeds[0].weight;
    expect(ranked[1].score).toBeCloseTo(0.5 * w + 0.9 * (1 - w));
  });

  it('adventure: second-hop artists first, hop 1 fills up', () => {
    expect(steppingStones(seeds, similar)).toEqual(['Heard Once', 'Fresh One', 'Shared Find', 'Fresh Two']);
    const ranked = rankNewArtists(seeds, similar, known, 2);
    expect(ranked.map((a) => [a.artist, a.hops])).toEqual([
      ['Far Away', 2],
      ['Further Out', 2],
      ['Fresh One', 1],
      ['Shared Find', 1],
      ['Fresh Two', 1],
    ]);
    expect(ranked[0].via).toBe('Now Band');
  });
});

describe('pickTracks', () => {
  const artist = (name: string, via = 'Seed'): NewArtist => ({ artist: name, score: 1, via, hops: 1 });
  const t = (uri: string, title: string) => ({ uri, title });

  it('max 2 per artist, no heard URIs or repeated titles, round-robin order', () => {
    const tracks: Record<string, ReturnType<typeof t>[]> = {
      A: [t('a1', 'Hit'), t('a2', 'Hit - Remastered 2011'), t('a3', 'Deep Cut'), t('a4', 'Third')],
      B: [t('heard', 'Old'), t('b2', 'New')],
      C: [],
    };
    const picks = pickTracks([artist('A'), artist('B'), artist('C')], (a) => tracks[a], heardUris(hist).add('heard'));
    expect(picks.map((p) => p.track.uri)).toEqual(['a1', 'b2', 'a3']);
  });

  it('stops at the total', () => {
    const many = Array.from({ length: 20 }, (_, i) => artist(`Artist ${i}`));
    const picks = pickTracks(many, (a) => [t(`${a}-1`, 'One'), t(`${a}-2`, 'Two')], new Set());
    expect(picks).toHaveLength(30);
    expect(new Set(picks.map((p) => p.artist)).size).toBe(15);
    expect(picks[0].artist).toBe('Artist 0');
    expect(picks[1].artist).toBe('Artist 1');
  });

  it('never picks a URI from the history', () => {
    const uri = hist.streams[0].uri!;
    expect(pickTracks([artist('A')], () => [t(uri, 'Song')], heardUris(hist))).toEqual([]);
  });
});

describe('discoverDescription', () => {
  it('says which seed each pick came from', () => {
    const picks = [
      { artist: 'Fresh One', via: 'Now Band', track: { uri: 'x', title: 'a' } },
      { artist: 'Fresh One', via: 'Now Band', track: { uri: 'y', title: 'b' } },
      { artist: 'Fresh Two', via: 'Also Now', track: { uri: 'z', title: 'c' } },
    ];
    expect(discoverDescription(picks, 'top artists of recent years')).toBe(
      "Artists I'd never played, similar to my top artists of recent years (Last.fm). Via Now Band: Fresh One. Via Also Now: Fresh Two.",
    );
  });

  it('fits Spotify’s 300 characters', () => {
    const picks = Array.from({ length: 30 }, (_, i) => ({ artist: `A rather long artist name ${i}`, via: `Seed ${i % 5}`, track: { uri: `${i}`, title: 't' } }));
    const d = discoverDescription(picks, 'all-time top artists');
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(d.endsWith('…')).toBe(true);
  });
});
