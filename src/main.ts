import './style.css';
import { handleRedirect, isLoggedIn, login, logout } from './auth';
import { parseSetlist, rankCandidates, type Confidence } from './match';
import { extractSetlistId, fetchSetlist, playlistName, toSetlistText, WORKER_URL } from './setlistfm';
import { addItems, createPlaylist, searchArtists, searchTracks, type Artist, type Track } from './spotify';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const views = { login: $('login-view'), form: $('form-view'), review: $('review-view') };
const status = $('status');
const DRAFT_KEY = 'setlist_draft';

interface Row {
  title: string;
  artist: Artist | null; // the artist this row was searched under
  options: { track: Track; confidence: Confidence }[];
  choice: number; // index into options, -1 = skip
}

let rows: Row[] = [];
let artist: Artist | null = null;

function show(view: keyof typeof views) {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
}

function setStatus(text: string, kind: 'info' | 'error' | 'ok' = 'info') {
  status.textContent = text;
  status.dataset.kind = kind;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// --- Draft: keeps the form filled across the Spotify login redirect ---
const fields = () => ({
  artist: $<HTMLInputElement>('artist'),
  name: $<HTMLInputElement>('playlist-name'),
  setlist: $<HTMLTextAreaElement>('setlist'),
});

function saveDraft() {
  const f = fields();
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ artist: f.artist.value, name: f.name.value, setlist: f.setlist.value }));
  } catch {
    /* storage unavailable, not critical */
  }
}

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
    if (!d) return;
    const f = fields();
    f.artist.value = d.artist ?? '';
    f.name.value = d.name ?? '';
    f.setlist.value = d.setlist ?? '';
  } catch {
    /* ignore */
  }
}

// --- Matching ---
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function runMatching(event: Event) {
  event.preventDefault();
  saveDraft();
  const f = fields();
  const titles = parseSetlist(f.setlist.value);
  if (titles.length === 0) return setStatus('Paste at least one song.', 'error');

  const btn = $<HTMLButtonElement>('match-btn');
  btn.disabled = true;
  try {
    setStatus('Looking up the artist…');
    artist = await resolveArtist(f.artist.value);
    if (!artist) return setStatus(`No artist called "${f.artist.value}" found on Spotify.`, 'error');

    // Covers are searched under their original artist; resolve each name once.
    const others = new Map<string, Artist | null>();
    for (const name of new Set(titles.map((t) => t.artist).filter((a): a is string => !!a))) {
      others.set(name.toLowerCase(), await resolveArtist(name));
    }

    let done = 0;
    rows = await mapLimit(titles, 3, async (entry) => {
      const by = entry.artist ? others.get(entry.artist.toLowerCase()) ?? null : artist;
      setStatus(`Matching songs… ${++done}/${titles.length}`);
      if (!by) return { title: entry.title, artist: null, options: [], choice: -1 };
      const results = await searchTracks(entry.title, by.name);
      const options = rankCandidates(entry.title, results, by.id).map(({ track, confidence }) => ({ track, confidence }));
      return { title: entry.title, artist: by, options, choice: options.length ? 0 : -1 };
    });
    setStatus('');
    renderReview();
    show('review');
  } catch (err) {
    setStatus((err as Error).message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function resolveArtist(name: string): Promise<Artist | null> {
  const artists = await searchArtists(name.trim());
  const wanted = name.trim().toLowerCase();
  return artists.find((a) => a.name.toLowerCase() === wanted) ?? artists[0] ?? null;
}

// --- setlist.fm import ---
async function importSetlist() {
  const id = extractSetlistId($<HTMLInputElement>('import-url').value);
  if (!id) return setStatus('That doesn’t look like a setlist.fm setlist link.', 'error');
  const btn = $<HTMLButtonElement>('import-btn');
  btn.disabled = true;
  try {
    setStatus('Fetching setlist…');
    const setlist = await fetchSetlist(id);
    const f = fields();
    f.artist.value = setlist.artist;
    f.name.value = playlistName(setlist);
    f.setlist.value = toSetlistText(setlist, $<HTMLInputElement>('include-tapes').checked);
    saveDraft();
    const tapes = setlist.songs.filter((s) => s.tape).length;
    setStatus(
      `Imported ${setlist.songs.length - tapes} songs` + (tapes ? ` (${tapes} tape${tapes > 1 ? 's' : ''} ${$<HTMLInputElement>('include-tapes').checked ? 'included' : 'skipped'}).` : '.') + ' Check the list, then find tracks.',
      'ok',
    );
  } catch (err) {
    setStatus((err as Error).message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// --- Review screen ---
const LABEL: Record<Confidence, string> = { exact: 'Exact', close: 'Close', weak: 'Check', none: 'Not found' };

function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderReview() {
  $('artist-line').innerHTML = `Artist: <strong>${escapeHtml(artist!.name)}</strong>`;
  const found = rows.filter((r) => r.choice >= 0).length;
  const toCheck = rows.filter((r) => r.choice >= 0 && r.options[r.choice].confidence !== 'exact').length;
  $('summary').textContent =
    `${found} of ${rows.length} songs matched` + (toCheck ? `, ${toCheck} worth a second look.` : '.');

  $('results').innerHTML = rows
    .map((row, i) => {
      const picked = row.choice >= 0 ? row.options[row.choice] : null;
      const conf: Confidence = picked ? picked.confidence : 'none';
      const img = picked?.track.album.images.at(-1)?.url;
      const options = row.options
        .map(
          (o, j) =>
            `<option value="${j}" ${j === row.choice ? 'selected' : ''}>${escapeHtml(o.track.name)} · ${escapeHtml(o.track.album.name)} (${formatDuration(o.track.duration_ms)})</option>`,
        )
        .join('');
      return `
        <li class="result ${row.choice < 0 ? 'skipped' : ''}">
          <span class="num">${i + 1}</span>
          ${img ? `<img src="${img}" alt="" width="48" height="48" />` : '<span class="noimg"></span>'}
          <div class="info">
            <span class="requested">${escapeHtml(row.title)}${row.artist && row.artist.id !== artist!.id ? ` <span class="by">· ${escapeHtml(row.artist.name)}</span>` : ''}</span>
            <select data-row="${i}" aria-label="Match for ${escapeHtml(row.title)}">
              ${options}
              <option value="-1" ${row.choice < 0 ? 'selected' : ''}>${row.options.length ? 'Skip this song' : 'Not found on Spotify'}</option>
            </select>
          </div>
          <span class="badge" data-conf="${row.choice < 0 ? 'none' : conf}">${row.choice < 0 && row.options.length ? 'Skipped' : LABEL[conf]}</span>
        </li>`;
    })
    .join('');
}

$('results').addEventListener('change', (e) => {
  const sel = e.target as HTMLSelectElement;
  if (!sel.dataset.row) return;
  rows[Number(sel.dataset.row)].choice = Number(sel.value);
  renderReview();
});

async function create() {
  const uris = rows.filter((r) => r.choice >= 0).map((r) => r.options[r.choice].track.uri);
  if (uris.length === 0) return setStatus('No songs selected.', 'error');

  const btn = $<HTMLButtonElement>('create-btn');
  btn.disabled = true;
  try {
    setStatus('Creating playlist…');
    const name = fields().name.value.trim();
    const playlist = await createPlaylist(name, `Setlist by ${artist!.name}, made with Setlist to Playlist.`);
    await addItems(playlist.id, uris);
    status.dataset.kind = 'ok';
    status.innerHTML = `Done: <a href="${playlist.external_urls.spotify}" target="_blank" rel="noopener">open “${escapeHtml(name)}” in Spotify</a> (${uris.length} songs).`;
  } catch (err) {
    setStatus((err as Error).message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// --- Wiring ---
$('login-btn').addEventListener('click', () => login());
$('logout-btn').addEventListener('click', () => {
  logout();
  show('login');
});
$('setlist-form').addEventListener('submit', runMatching);
$('import-btn').addEventListener('click', importSetlist);
$('import-box').hidden = !WORKER_URL;
$('create-btn').addEventListener('click', create);
$('back-btn').addEventListener('click', () => {
  setStatus('');
  show('form');
});

(async () => {
  try {
    await handleRedirect();
  } catch (err) {
    setStatus((err as Error).message, 'error');
  }
  loadDraft();
  show(isLoggedIn() ? 'form' : 'login');
})();
