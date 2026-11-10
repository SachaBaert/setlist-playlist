# Setlist to Playlist: context for Claude

Personal web app of Sacha Baert: paste or import a concert setlist, check the Spotify matches, create a private playlist in the exact order. UI in English.

- Live: https://sachabaert.github.io/setlist-playlist/
- Repo: https://github.com/SachaBaert/setlist-playlist (public, `main` deploys automatically)

## Stack and layout

Vite + TypeScript, no framework, static site on GitHub Pages.

- `src/auth.ts`: Spotify login, Authorization Code + PKCE, token refresh. Holds the Client ID and redirect URIs.
- `src/spotify.ts`: thin Web API client (search, create playlist, add items, 429 retry).
- `src/match.ts`: pure matching logic (parse setlist, normalize titles, score/rank candidates). Unit-tested.
- `src/setlistfm.ts`: setlist.fm import via the Worker, playlist name and description. Unit-tested.
- `src/main.ts`: UI (form, review screen with dropdowns and manual search, create, "Make another playlist").
- `worker/worker.js`: Cloudflare Worker that proxies setlist.fm.
- `.github/workflows/deploy.yml`: test, build, deploy to Pages on every push to `main`.

Commands: `npm install`, `npm run dev` (http://127.0.0.1:5173/), `npm test`, `npm run build`.

## Spotify rules that shape the code

- App is in **Development Mode**: max 5 allow-listed users. Extended quota needs 250k MAU and a registered company, so the app stays personal. Don't build sharing features.
- Use the **February 2026** endpoints: `POST /me/playlists`, `POST /playlists/{id}/items` (not `/tracks`, not `/users/{id}/playlists`). Search `limit` max is **10** in dev mode.
- Removed for dev-mode apps: `GET /artists/{id}/top-tracks`, recommendations, batch fetches (`GET /tracks?ids=`, `/artists?ids=`, ...), browse endpoints. Still available: `GET /me/top/{type}`, `GET /me/player/recently-played` (last 50 only).
- Redirect URIs registered in the dashboard: `https://sachabaert.github.io/setlist-playlist/` and `http://127.0.0.1:5173/` (Spotify rejects `localhost`). Scopes: `playlist-modify-private playlist-modify-public`.
- Matching: resolve the artist ID first and only accept that artist's tracks; prefer studio over live/remix; covers are written `Song | Original artist` and searched under that artist.

## setlist.fm Worker

- Deployed by hand in Cloudflare as `setlist-proxy`: https://setlist-proxy.sacha-baert-88.workers.dev/?id=<setlistId>
- API key is the Worker secret `SETLISTFM_API_KEY`. Never put it in the repo or the page.
- CORS only for `https://sachabaert.github.io` and `http://127.0.0.1:5173`. Setlists are cached for a day.
- **Changing `worker/worker.js` in the repo does not deploy it.** Sacha pastes the code into the Cloudflare editor and clicks Deploy. The deployed version may lag the repo (e.g. the `url` field; the app falls back to the pasted link).
- setlist.fm API terms require attribution: playlist descriptions link the setlist, the import box credits setlist.fm.

## Deploy notes

- Pages source is "GitHub Actions". Builds take ~20 s; deploys usually < 1 min. A stuck deploy is a GitHub hiccup: push a new commit rather than re-running the same SHA.
- The GitHub MCP connector cannot write `.github/workflows/*`. Use git or the GitHub web editor for workflow changes.
- No `package-lock.json` is committed; the workflow uses `npm install`.

## Privacy

Sacha's Spotify Extended Streaming History (2011–2026, ~84k streams, ~70 MB) contains `ip_addr` and `conn_country` per stream. **Never commit it, upload it to the project, or send it anywhere.** Statistics features must parse the export in the browser (File API, unzip client-side) so nothing leaves his computer.

Export format: `Streaming_History_Audio_YYYY.json` arrays with `ts` (UTC), `ms_played`, `master_metadata_track_name`, `master_metadata_album_artist_name`, `master_metadata_album_album_name`, `spotify_track_uri`, `skipped`, `shuffle`, `reason_start`, `reason_end`, `platform`, plus podcast/audiobook fields. Count a stream as a play from 30 s. Some days are a song looping in the background (e.g. 151 plays of one song in a day, an 18.7 h day): detect and down-weight these so they don't distort rankings.

## Roadmap

Done: paste/import setlist, matching + review, manual search, setlist.fm credit, "Make another playlist".

Round 2 (needs new Worker endpoints, then Sacha pastes the Worker again):
1. Search concerts by artist instead of pasting a link (setlist.fm `/search/setlists?artistName=`).
2. "Prepare for a concert" mix: last 5–10 setlists of the current tour, songs ranked by how often they're played, in their usual order.

Statistics (separate page, local parsing only), in this order:
1. Wrapped-style all-time overview with a chapter per year, plus year playlists (top 30 per year) using the existing playlist code.
2. Eras timeline, "on this day", forgotten favorites and comebacks, discoveries, skip rate, listening heatmap.
3. Concert links: songs from a setlist you already know vs. not yet.
4. Games later (guess the year, higher or lower).

## Working with Sacha

- Wants the best option recommended with arguments, and pushback when his idea is worse.
- Usage-conscious: keep scope tight, build in rounds, collect feedback in one batch.
- Tests (vitest) for pure logic; keep UI code thin.
