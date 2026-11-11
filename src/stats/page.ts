// Statistics page UI. Thin: reads files locally, calls the pure modules, renders.
import '../style.css';
import { buildHistory, parseJsonFile, readZip, DEFAULT_TZ, DAY_CAP, LONG_DAY_HOURS, LOOP_PLAYS, type History, type RawStream } from './history';
import { buildWrapped, type SongStat, type Wrapped } from './wrapped';
import { yearPlaylists, YEAR_TOP, type PlaylistDraft } from './yearlists';
import { detectEras, monthIndex, type Era } from './eras';
import { onThisDay, todayIn, type DayLook } from './onthisday';
import { rediscover, SILENCE_MONTHS, type Rediscover } from './comebacks';
import { artistKey, discoverDescription, heardUris, knownArtists, pickTracks, rankNewArtists, seedArtists, steppingStones, PER_ARTIST, SEED_COUNT, TOTAL, type SeedRange, type Similar } from './discover';
import { getAccessToken, isLoggedIn, login, TRACKER_RESULT_KEY } from '../auth';
import { coverage, fromListens, latest, mergeStreams, slim, type CachedStream } from './cache';
import { forgetCache, loadCache, saveCache } from './store';
import { stopTracker, trackedListens, TrackerError, type TrackerStatus } from '../tracker';
import { rankCandidates } from '../match';
import { fetchSimilar, fetchTopTracks } from '../lastfm';
import { saveHandoff, type HandoffRow } from '../handoff';
import { addItems, createPlaylist, searchArtists, searchTracks, type Track } from '../spotify';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status');
const out = $('wrapped');

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n0 = (n: number) => Math.round(n).toLocaleString('en-GB');
const h = (hours: number) => (hours < 1 ? `${Math.round(hours * 60)} min` : `${n0(hours)} h`);
const plays = (n: number) => `${n0(n)} ${Math.round(n) === 1 ? 'play' : 'plays'}`;
const date = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const song = (s: SongStat | null) => (s ? `<strong>${esc(s.track)}</strong> <span class="by">${esc(s.artist)}</span>` : '—');

function setStatus(text: string, kind: 'info' | 'error' | 'ok' = 'info') {
  status.textContent = text;
  status.dataset.kind = kind;
}

async function readFiles(files: FileList): Promise<RawStream[]> {
  const raw: RawStream[] = [];
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (/\.zip$/i.test(f.name)) raw.push(...readZip(new Uint8Array(await f.arrayBuffer())));
    else if (/Streaming_History_Audio_.*\.json$/i.test(f.name)) raw.push(...parseJsonFile(await f.text(), f.name));
  }
  if (!raw.length) throw new Error('No audio streaming history found in these files.');
  return raw;
}

const month = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

// --- Playlists (shared by every "make this a playlist" feature) ---
const drafts = new Map<string, PlaylistDraft>();

function draftHtml(d: PlaylistDraft, summary: string): string {
  drafts.set(d.id, d);
  return `
    <details class="draft">
      <summary>${summary}</summary>
      <ol class="rank">${d.songs.map((s) => `<li><strong>${esc(s.track)}</strong> <span class="by">${esc(s.artist)}</span> <span class="num">${n0(s.plays)}</span></li>`).join('')}</ol>
      <p class="draft-actions">${
        isLoggedIn()
          ? `<button class="small primary" data-create="${esc(d.id)}">Create “${esc(d.name)}”</button>`
          : `<button class="small ghost" data-login>Log in with Spotify to create playlists</button>`
      } <span class="draft-status"></span></p>
    </details>`;
}

out.addEventListener('click', async (e) => {
  const el = e.target as HTMLElement;
  if (el.closest('[data-login]')) return login('stats.html');
  const discover = el.closest<HTMLButtonElement>('[data-discover]');
  if (discover) return runDiscover(discover);
  const btn = el.closest<HTMLButtonElement>('[data-create]');
  const d = btn && drafts.get(btn.dataset.create!);
  if (!btn || !d) return;
  const note = btn.parentElement!.querySelector('.draft-status')!;
  btn.disabled = true;
  note.textContent = 'Creating…';
  try {
    const pl = await createPlaylist(d.name, d.description);
    await addItems(pl.id, d.songs.map((s) => s.uri));
    note.innerHTML = `Done: <a href="${esc(pl.external_urls.spotify)}" target="_blank" rel="noopener">open in Spotify</a>`;
  } catch (err) {
    btn.disabled = false;
    note.textContent = err instanceof Error ? err.message : String(err);
  }
});

function yearsHtml(lists: PlaylistDraft[]): string {
  if (!lists.length) return '';
  return `
    <section class="chapter">
      <h2>Year playlists</h2>
      <p class="muted">Your top ${YEAR_TOP} songs of each year, as private playlists.</p>
      ${lists.map((d) => draftHtml(d, `<strong>${d.id.slice(5)}</strong> <span class="by">${d.songs.length} songs, starting with ${esc(d.songs[0].track)}</span>`)).join('')}
    </section>`;
}

function erasHtml(eras: Era[], first: string, last: string): string {
  if (!eras.length) return '';
  const start = monthIndex(first);
  const span = monthIndex(last) - start + 1;
  const pct = (ym: string) => ((monthIndex(`${ym}-01`) - start) / span) * 100;
  const years: number[] = [];
  for (let y = +first.slice(0, 4) + 1; y <= +last.slice(0, 4); y++) years.push(y);
  return `
    <section class="chapter">
      <h2>Your eras</h2>
      <p class="muted">Stretches of at least three months when one or a few artists led your listening. Detected automatically.</p>
      <div class="timeline">
        ${years.map((y) => `<span class="tick" style="left:${pct(`${y}-01`)}%">${y % 5 === 0 || years.length < 8 ? y : ''}</span>`).join('')}
        ${eras.map((e) => `<div class="era-bar" style="left:${pct(e.from)}%;width:${Math.max(((e.months) / span) * 100, 0.6)}%" title="${esc(e.artists.join(' & '))}"><span>${esc(e.artists[0])}</span></div>`).join('')}
      </div>
      <ol class="eras">${eras
        .map(
          (e) => `<li><strong>${esc(e.artists.join(' & '))}</strong> <span class="num">${month(e.from)} – ${e.ongoing ? 'now' : month(e.to)} · ${h(e.hours)}</span>
          ${e.topSongs.length ? `<br><span class="by">${e.topSongs.slice(0, 3).map((s) => esc(s.track)).join(' · ')}</span>` : ''}</li>`,
        )
        .join('')}</ol>
    </section>`;
}

function onThisDayHtml(looks: DayLook[]): string {
  if (!looks.length) return '';
  return `
    <section class="chapter">
      <h2>On this day</h2>
      ${looks
        .map(
          (l) => `
      <h3>${l.yearsAgo} years ago${l.exact ? '' : `, closest day with music`}: ${date(l.day)}</h3>
      <p class="muted">${h(l.hours)} · ${plays(l.plays)}${l.artists.length ? ` · mostly ${l.artists.map(esc).join(', ')}` : ''}</p>
      <ol class="rank">${l.topSongs.map((s) => `<li>${song({ ...s, hours: 0 })}</li>`).join('')}</ol>`,
        )
        .join('')}
    </section>`;
}

function rediscoverHtml(r: Rediscover): string {
  if (!r.comebacks.length && !r.forgotten.length && !r.gems) return '';
  const years = SILENCE_MONTHS / 12;
  return `
    <section class="chapter">
      <h2>Comebacks and forgotten favorites</h2>
      ${
        r.comebacks.length
          ? `<h3>Comebacks</h3><p class="muted">Artists you played a lot, then hardly at all for ${years}+ years, then again.</p>
      ${r.comebacks.slice(0, 10).map((c) => draftHtml(c.playlist, `<strong>${esc(c.artist)}</strong> <span class="by">${month(c.before.from)} – ${month(c.before.to)}, gone ${Math.round(c.silentMonths / 12)} years, back ${month(c.back)}</span>`)).join('')}`
          : ''
      }
      ${
        r.forgotten.length
          ? `<h3>Forgotten favorites</h3><p class="muted">Artists you played a lot and not in the last ${years}+ years.</p>
      ${r.forgotten.slice(0, 10).map((f) => draftHtml(f.playlist, `<strong>${esc(f.artist)}</strong> <span class="by">${n0(f.plays)} plays, ${month(f.from)} – ${month(f.last)}</span>`)).join('')}`
          : ''
      }
      ${r.gems ? `<h3>Forgotten gems</h3><p class="muted">Songs you played a lot once and never again (at most 3 per artist).</p>${draftHtml(r.gems, `<strong>${r.gems.songs.length} songs</strong> <span class="by">starting with ${esc(r.gems.songs[0].track)}</span>`)}` : ''}
    </section>`;
}

// --- Discover: new artists via Last.fm, matched on Spotify, reviewed on the main page ---
let loaded: { hist: History; eras: Era[] } | null = null;
/** Artists to try on Spotify; some won't be there or have only heard tracks. */
const DISCOVER_TRIES = 30;
/** Last.fm top tracks tried per artist before giving up on it. */
const TRACK_TRIES = 4;

function discoverHtml(eras: Era[]): string {
  return `
    <section class="chapter">
      <h2>Discover</h2>
      <p class="muted">Up to ${TOTAL} songs by artists you have never played, similar to your top ${SEED_COUNT} artists. Max ${PER_ARTIST} per artist.</p>
      <div class="discover-form">
        <label>Based on
          <select id="discover-seeds">
            <option value="recent">Recent years</option>
            <option value="year">The last year</option>
            <option value="all">All time</option>
            ${eras.map((e, i) => `<option value="era-${i}">Era: ${esc(e.artists.join(' & '))} (${month(e.from)} – ${e.ongoing ? 'now' : month(e.to)})</option>`).join('')}
          </select>
        </label>
        <label>Adventure <span class="hint">close to home ↔ one step further</span>
          <input id="discover-hops" type="range" min="1" max="2" step="1" value="1" />
        </label>
      </div>
      <p class="draft-actions">${
        isLoggedIn()
          ? `<button class="small primary" data-discover>Find new music</button>`
          : `<button class="small ghost" data-login>Log in with Spotify to discover</button>`
      } <span class="draft-status" id="discover-status"></span></p>
      <p class="credit">Similar artists from <a href="https://www.last.fm" target="_blank" rel="noopener">Last.fm</a></p>
    </section>`;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, stop: () => boolean): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !stop()) await fn(items[next++]);
    }),
  );
}

async function runDiscover(btn: HTMLButtonElement) {
  if (!loaded) return;
  const note = $('discover-status');
  const choice = $<HTMLSelectElement>('discover-seeds').value;
  const hops = $<HTMLInputElement>('discover-hops').value === '2' ? 2 : 1;
  const era = choice.startsWith('era-') ? loaded.eras[Number(choice.slice(4))] : null;
  const range: SeedRange = era ? { kind: 'era', era } : { kind: choice as 'recent' | 'year' | 'all' };
  const label = era ? `${era.artists.join(' & ')} era` : { recent: 'top artists of recent years', year: 'top artists of the last year', all: 'all-time top artists' }[choice]!;
  const { hist } = loaded;
  btn.disabled = true;
  try {
    const seeds = seedArtists(hist, range);
    if (!seeds.length) throw new Error('No plays in this period.');
    const similar = new Map<string, Similar[]>();
    const lookup = (a: string) => similar.get(artistKey(a));
    const load = async (names: string[]) => {
      await mapLimit(names.filter((n) => !lookup(n)), 4, async (n) => void similar.set(artistKey(n), (await fetchSimilar(n)).similar), () => false);
    };
    note.textContent = `Finding artists similar to ${seeds.length} of yours…`;
    await load(seeds.map((s) => s.artist));
    if (hops === 2) {
      note.textContent = 'One step further…';
      await load(steppingStones(seeds, lookup));
    }
    const known = knownArtists(hist);
    const heard = heardUris(hist);
    const candidates = rankNewArtists(seeds, lookup, known, hops).slice(0, DISCOVER_TRIES);
    if (!candidates.length) throw new Error('Last.fm has no similar artists you haven’t played yet.');

    // Match each artist on Spotify: exact artist name, then its Last.fm top tracks.
    const matched = new Map<string, (HandoffRow & { uri: string })[]>();
    let usable = 0;
    let done = 0;
    await mapLimit(
      candidates,
      3,
      async (c) => {
        note.textContent = `Matching on Spotify… ${++done}/${candidates.length}`;
        const top = await fetchTopTracks(c.artist);
        const sp = (await searchArtists(c.artist)).find((a) => artistKey(a.name) === artistKey(c.artist));
        if (!sp || known.has(artistKey(sp.name))) return;
        const rows: (HandoffRow & { uri: string })[] = [];
        for (const t of top.tracks.slice(0, TRACK_TRIES)) {
          if (rows.length >= PER_ARTIST) break;
          const options = rankCandidates(t.name, await searchTracks(t.name, sp.name), sp.id)
            .filter((o) => !heard.has(o.track.uri))
            .map(({ track, confidence }) => ({ track: track as Track, confidence }));
          if (options.length) rows.push({ title: t.name, artist: sp, note: `via ${c.via}`, options, choice: 0, uri: options[0].track.uri });
        }
        matched.set(c.artist, rows);
        usable += rows.length;
      },
      () => usable >= TOTAL + PER_ARTIST * 3, // a little spare for duplicates
    );

    const picks = pickTracks(candidates, (a) => matched.get(a), heard);
    if (!picks.length) throw new Error('None of the suggestions could be found on Spotify.');
    saveHandoff({
      heading: `Discover: ${picks.length} songs by ${new Set(picks.map((p) => p.artist)).size} artists you’ve never played`,
      name: `Discover: ${era ? `${era.artists[0]} era` : { recent: 'recent taste', year: 'this year', all: 'all-time taste' }[choice]}`,
      description: discoverDescription(picks, label),
      rows: picks.map((p) => p.track),
    });
    window.location.href = './';
  } catch (err) {
    btn.disabled = false;
    note.textContent = err instanceof Error ? err.message : String(err);
  }
}

function render(w: Wrapped, hist: History) {
  const t = w.totals;
  const first = w.firstStream;
  const years = w.years.filter((y) => y.plays > 0);
  out.innerHTML = `
    <section class="chapter hero">
      <p class="eyebrow">${esc(t.first.slice(0, 4))} – ${esc(t.last.slice(0, 4))}</p>
      <div class="stats-grid">
        <div><span class="big">${h(t.rawHours)}</span><span>listened</span></div>
        <div><span class="big">${n0(t.plays)}</span><span>plays of 30 s+</span></div>
        <div><span class="big">${w.longestStreak?.days ?? 0}</span><span>days in a row, longest streak</span></div>
      </div>
      ${first ? `<p>It started on <strong>${date(first.day)}</strong> with <strong>${esc(first.track)}</strong> <span class="by">${esc(first.artist)}</span>.</p>` : ''}
    </section>

    ${years
      .map(
        (y) => `
    <section class="chapter">
      <h2>${y.year}</h2>
      <p class="muted">${h(y.rawHours)} · ${plays(y.plays)} · ${n0(y.artists)} artists</p>
      <dl>
        <dt>Song of the year</dt><dd>${song(y.topSong)} <span class="num">${y.topSong ? plays(y.topSong.plays) : ''}</span></dd>
        <dt>Artist of the year</dt><dd><strong>${esc(y.topArtist?.artist ?? '—')}</strong> <span class="num">${h(y.topArtist?.hours ?? 0)}</span></dd>
        <dt>Discovery of the year</dt><dd><strong>${esc(y.discovery?.artist ?? '—')}</strong> <span class="num">${y.discovery ? plays(y.discovery.plays) : ''}</span></dd>
      </dl>
    </section>`,
      )
      .join('')}
    ${t.missingYears.length ? `<p class="muted">No data for ${t.missingYears.join(', ')}.</p>` : ''}

    <section class="chapter">
      <h2>All time</h2>
      <h3>Most-played songs</h3>
      <ol class="rank">${w.topSongs.map((s) => `<li>${song(s)} <span class="num">${n0(s.plays)}</span></li>`).join('')}</ol>
      <h3>Most-played artists</h3>
      <ol class="rank">${w.topArtists.map((a) => `<li><strong>${esc(a.artist)}</strong> <span class="num">${h(a.hours)}</span></li>`).join('')}</ol>
      <dl>
        ${w.biggestDay ? `<dt>Biggest day</dt><dd>${date(w.biggestDay.day)}: ${h(w.biggestDay.hours)}, mostly ${song(w.biggestDay.topSong)}</dd>` : ''}
        ${w.longestStreak ? `<dt>Longest streak</dt><dd>${w.longestStreak.days} days, ${date(w.longestStreak.from)} to ${date(w.longestStreak.to)}</dd>` : ''}
        ${w.mostExploratoryYear ? `<dt>Most exploratory year</dt><dd>${w.mostExploratoryYear.year}: ${n0(w.mostExploratoryYear.artists)} different artists</dd>` : ''}
      </dl>
    </section>

    ${onThisDayHtml(onThisDay(hist, todayIn(DEFAULT_TZ)))}
    ${erasHtml(loaded!.eras, t.first, t.last)}
    ${rediscoverHtml(rediscover(hist))}
    ${discoverHtml(loaded!.eras)}
    ${yearsHtml(yearPlaylists(hist))}

    <details class="chapter">
      <summary>How this was counted</summary>
      <p>A play is 30 seconds or more. In rankings a song counts at most ${DAY_CAP} times a day, and days over ${LONG_DAY_HOURS} hours are scaled down and left out of “biggest day”, so music left on repeat in the background doesn't take over. Rankings count ${h(t.hours)} of the ${h(t.rawHours)} in ${n0(t.streams)} streams${hist.skippedEntries ? ` (${n0(hist.skippedEntries)} podcast or unknown entries skipped)` : ''}.</p>
      <h3>On repeat in the background (${LOOP_PLAYS}+ plays of one song in a day): ${hist.loops.length}</h3>
      <ul class="rank">${hist.loops.slice(0, 15).map((l) => `<li>${date(l.day)}: <strong>${esc(l.track)}</strong> <span class="by">${esc(l.artist)}</span> <span class="num">${l.plays}×</span></li>`).join('')}</ul>
      <h3>Days over ${LONG_DAY_HOURS} hours: ${hist.longDays.length}</h3>
      <ul class="rank">${hist.longDays.map((d) => `<li>${date(d.day)} <span class="num">${d.hours} h</span></li>`).join('')}</ul>
    </details>`;
}

// --- Local cache + tracker ---
let cached: CachedStream[] = [];
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function show(streams: CachedStream[], from: 'cache' | 'file' | 'tracker') {
  out.innerHTML = '';
  drafts.clear();
  const hist = buildHistory(streams);
  if (!hist.streams.length) return setStatus('No music in the saved history yet.', 'info');
  loaded = { hist, eras: detectEras(hist) };
  render(buildWrapped(hist, 10), hist);
  const c = coverage(streams);
  const tracked = c.tracked
    ? ` Includes ${n0(c.tracked)} tracked ${c.tracked === 1 ? 'play' : 'plays'} from ${date(c.trackedFrom!.slice(0, 10))} (hours estimated from song length${c.exportEnd ? `; nothing between the export’s end on ${date(c.exportEnd.slice(0, 10))} and the start of tracking` : ''}).`
    : '';
  const src = { cache: 'Loaded from this device', file: 'Loaded and saved on this device', tracker: 'Updated with tracked plays' }[from];
  setStatus(`${src}: ${n0(hist.streams.length)} streams, ${hist.streams[0].day} to ${hist.streams.at(-1)!.day}.${tracked}`, 'ok');
  $('cache-actions').hidden = false;
  $('cache-note').textContent = 'Your history is saved in this browser.';
}

async function store(streams: CachedStream[]) {
  cached = streams;
  try {
    await saveCache(streams);
  } catch {
    setStatus('Could not save your history in this browser; load the export again next time.', 'error');
  }
}

$('file').addEventListener('change', async (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files?.length) return;
  setStatus('Reading your history…');
  await new Promise((r) => setTimeout(r, 30)); // let the status paint before the heavy work
  try {
    const merged = mergeStreams(cached, slim(await readFiles(files)));
    show(merged, 'file');
    await store(merged);
    void syncTracker();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
  }
});

$('forget-btn').addEventListener('click', async () => {
  if (!confirm('Remove your saved listening history from this browser? Tracked plays stay on the Worker until you stop tracking.')) return;
  await forgetCache();
  cached = [];
  loaded = null;
  out.innerHTML = '';
  $('cache-actions').hidden = true;
  setStatus('Forgotten. Nothing is saved in this browser any more.', 'ok');
});

const trackerNote = $('tracker-status');
const trackerActions = $('tracker-actions');

function trackerHtml(st: TrackerStatus | null) {
  if (!isLoggedIn()) return `<button class="small ghost" data-login>Log in with Spotify to set up tracking</button>`;
  if (st?.tracking) return `<button class="small ghost" id="stop-tracking">Stop tracking</button>`;
  return `<button class="small primary" id="start-tracking">Start tracking</button>`;
}

function trackerText(st: TrackerStatus): string {
  if (!st.tracking) return st.lastError ? `Tracking stopped: ${st.lastError}` : 'Not tracking.';
  const last = st.lastRun ? ` Last check ${when(st.lastRun)}${st.lastCount ? `, ${st.lastCount} new` : ''}.` : '';
  return `Tracking since ${when(st.startedAt!)}.${last}${st.lastError ? ` Last error: ${st.lastError}` : ''}`;
}

/** Status, and new tracked plays merged into the cache. */
async function syncTracker() {
  let st: TrackerStatus | null = null;
  try {
    if (isLoggedIn()) {
      const token = await getAccessToken();
      const res = await trackedListens(token, latest(cached));
      st = res;
      trackerNote.textContent = trackerText(st);
      if (res.listens.length) {
        const merged = mergeStreams(cached, fromListens(res.listens));
        if (merged.length !== cached.length) {
          show(merged, 'tracker');
          await store(merged);
        }
      }
    }
  } catch (err) {
    trackerNote.textContent =
      err instanceof TrackerError && err.status === 401 ? 'Tracking only works for the owner’s Spotify account.'
      : err instanceof TrackerError && err.status === 503 ? 'The tracker isn’t set up on the Worker yet.'
      : err instanceof Error ? err.message : String(err);
  }
  trackerActions.innerHTML = trackerHtml(st);
}

$('tracker').addEventListener('click', async (e) => {
  const el = e.target as HTMLElement;
  if (el.closest('[data-login]')) return login('stats.html');
  if (el.closest('#start-tracking')) return login('stats.html', { tracker: true });
  if (el.closest('#stop-tracking')) {
    try {
      await stopTracker(await getAccessToken());
      trackerActions.innerHTML = trackerHtml({ tracking: false } as TrackerStatus);
      trackerNote.innerHTML = 'Stopped; the Worker no longer has your token. To revoke access completely, remove this app at <a href="https://www.spotify.com/account/apps/" target="_blank" rel="noopener">spotify.com/account/apps</a>.';
    } catch (err) {
      trackerNote.textContent = err instanceof Error ? err.message : String(err);
    }
  }
});

(async () => {
  const result = sessionStorage.getItem(TRACKER_RESULT_KEY);
  sessionStorage.removeItem(TRACKER_RESULT_KEY);
  const saved = await loadCache();
  if (saved) {
    cached = saved;
    setStatus('Loading your saved history…');
    await new Promise((r) => setTimeout(r, 30));
    show(saved, 'cache');
  }
  await syncTracker();
  if (result && result !== 'ok') trackerNote.textContent = `Could not start tracking: ${result}`;
  else if (result === 'ok') trackerNote.textContent = `Tracking started. ${trackerNote.textContent}`;
})();
