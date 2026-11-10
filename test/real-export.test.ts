// Opt-in sanity check against a real export. Never commit the zip.
//   STATS_ZIP=/path/to/my_spotify_data.zip npx vitest run test/real-export.test.ts
// Prints only aggregates (no IPs, no raw rows).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildHistory, readZip } from '../src/stats/history';
import { buildWrapped } from '../src/stats/wrapped';
import { detectEras } from '../src/stats/eras';
import { yearPlaylists } from '../src/stats/yearlists';
import { rediscover } from '../src/stats/comebacks';

const zip = process.env.STATS_ZIP;

describe.skipIf(!zip)('real export', () => {
  it('matches the reference numbers in CLAUDE.md', () => {
    const raw = readZip(new Uint8Array(readFileSync(zip!)));
    const t0 = Date.now();
    const h = buildHistory(raw);
    const w = buildWrapped(h);
    const ms = Date.now() - t0;
    const r = (n: number) => Math.round(n * 10) / 10;
    const report = {
      entries: raw.length,
      skippedEntries: h.skippedEntries,
      totals: { ...w.totals, rawHours: r(w.totals.rawHours), hours: r(w.totals.hours) },
      topArtists: w.topArtists.slice(0, 5).map((a) => `${a.artist}: ${r(a.hours)} h (raw ${r(a.rawHours)} h)`),
      topSongs: w.topSongs.slice(0, 5).map((s) => `${s.track} – ${s.artist}: ${r(s.plays)} (raw ${s.rawPlays})`),
      explorer: w.mostExploratoryYear,
      biggestDay: w.biggestDay && { ...w.biggestDay, hours: r(w.biggestDay.hours), topSong: w.biggestDay.topSong?.track },
      rawBiggestDay: w.rawBiggestDay && { ...w.rawBiggestDay, hours: r(w.rawBiggestDay.hours), topSong: w.rawBiggestDay.topSong?.track },
      streak: w.longestStreak,
      loops: h.loops.length,
      topLoops: h.loops.slice(0, 5).map((l) => `${l.day} ${l.track}: ${l.plays}`),
      longDays: h.longDays.slice(0, 5).map((d) => `${d.day}: ${r(d.hours)} h`),
      years: w.years.map((y) => `${y.year}: ${r(y.hours)} h, ${y.artists} artists, song ${y.topSong?.track}, artist ${y.topArtist?.artist}, discovery ${y.discovery?.artist}`),
      eras: detectEras(h).map((e) => `${e.from}..${e.ongoing ? 'now' : e.to}: ${e.artists.join(' & ')} (${r(e.hours)} h)`),
      yearLists: yearPlaylists(h).map((l) => `${l.name}: ${l.songs.slice(0, 3).map((s) => s.track).join(' / ')}`),
      ...(() => {
        const rd = rediscover(h);
        return {
          comebacks: rd.comebacks.slice(0, 10).map((c) => `${c.artist}: ${c.before.from}..${c.before.to}, ${c.silentMonths} months quiet, back ${c.back}`),
          forgotten: rd.forgotten.slice(0, 10).map((f) => `${f.artist}: ${r(f.plays)} plays, last ${f.last}`),
          gems: rd.gems?.songs.length,
        };
      })(),
      computeMs: ms,
    };
    console.log(JSON.stringify(report, null, 2));
    expect(w.totals.missingYears).toContain(2013);
  });
});
