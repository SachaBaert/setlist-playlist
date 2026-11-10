// Statistics page UI. Thin: reads files locally, calls the pure modules, renders.
import '../style.css';
import { buildHistory, parseJsonFile, readZip, DAY_CAP, LONG_DAY_HOURS, LOOP_PLAYS, type History, type RawStream } from './history';
import { buildWrapped, type SongStat, type Wrapped } from './wrapped';
import { yearPlaylists, YEAR_TOP, type PlaylistDraft } from './yearlists';
import { detectEras, monthIndex, type Era } from './eras';
import { isLoggedIn, login } from '../auth';
import { addItems, createPlaylist } from '../spotify';

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
      <p class="muted">Your top ${YEAR_TOP} songs of each year, as private playlists.${isLoggedIn() ? '' : ' Log in once; you will need to load the export again after.'}</p>
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

    ${erasHtml(detectEras(hist), t.first, t.last)}
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

$('file').addEventListener('change', async (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files?.length) return;
  out.innerHTML = '';
  drafts.clear();
  setStatus('Reading your history…');
  await new Promise((r) => setTimeout(r, 30)); // let the status paint before the heavy work
  try {
    const hist = buildHistory(await readFiles(files));
    render(buildWrapped(hist, 10), hist);
    setStatus(`Loaded ${n0(hist.streams.length)} streams, ${hist.streams[0]?.day} to ${hist.streams.at(-1)?.day}.`, 'ok');
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
  }
});
