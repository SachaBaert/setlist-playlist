// Statistics page UI. Thin: reads files locally, calls the pure modules, renders.
import '../style.css';
import { buildHistory, parseJsonFile, readZip, DAY_CAP, LONG_DAY_HOURS, LOOP_PLAYS, type History, type RawStream } from './history';
import { buildWrapped, type SongStat, type Wrapped } from './wrapped';

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
