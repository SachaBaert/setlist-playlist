# Setlist to Playlist: context for Claude

Personal web app of Sacha Baert: paste or import a concert setlist, check the Spotify matches, create a private playlist in the exact order. UI in English.

- Live: https://sachabaert.github.io/setlist-playlist/
- Repo: https://github.com/SachaBaert/setlist-playlist (public, `main` deploys automatically)

## Stack and layout

Vite + TypeScript, no framework, static site on GitHub Pages.

- `src/auth.ts`: Spotify login, Authorization Code + PKCE, token refresh. Holds the Client ID and redirect URIs.
- `src/spotify.ts`: thin Web API client (search, create playlist, add items, 429 retry).
- `src/match.ts`: pure matching logic (parse setlist, normalize titles, score/rank candidates). Unit-tested.
- `src/setlistfm.ts`: setlist.fm import and concert search via the Worker, playlist name and description. Unit-tested.
- `src/concerts.ts`: concert search cleanup and the "prepare for a concert" mix (last ≤10 past setlists with songs of the latest tour, rarities under 1/3 of shows dropped, ordered by average position). Unit-tested.
- `src/main.ts`: UI (form, review screen with dropdowns and manual search, create, "Make another playlist").
- `stats.html` + `src/stats/`: statistics page (local only). `history.ts` reads the zip (fflate) and normalizes streams, `wrapped.ts` computes the all-time Wrapped, `yearlists.ts` ranks songs and builds playlist drafts (top 30 per year), `eras.ts` detects eras, `onthisday.ts` (5 and 10 years ago, nearest day within ±3 if silent), `comebacks.ts` (comebacks, forgotten favorites, forgotten gems; `rediscoverFixture()` in fixture.ts), `page.ts` renders (playlists via the shared `draftHtml` helper; logging in from the stats page returns there via `login('stats.html')`). `discover.ts` (Discover: seeds, Last.fm candidate scoring, track picks, description; orchestration in `page.ts`, which hands the result to the main page's review screen via `src/handoff.ts`; Last.fm client in `src/lastfm.ts`). `fixture.ts` is a synthetic export (fake artists, no IPs) for tests; later rounds should build on it. Unit-tested.
- `test/real-export.test.ts`: opt-in check against the real export, prints aggregates only: `STATS_ZIP=/path/my_spotify_data.zip npx vitest run test/real-export.test.ts`.
- `worker/worker.js`: Cloudflare Worker that proxies setlist.fm and Last.fm.
- `.github/workflows/deploy.yml`: test, build, deploy to Pages on every push to `main`.

Commands: `npm install`, `npm run dev` (http://127.0.0.1:5173/), `npm test`, `npm run build`.

## Spotify rules that shape the code

- App is in **Development Mode**: max 5 allow-listed users. Extended quota needs 250k MAU and a registered company, so the app stays personal. Don't build sharing features.
- Use the **February 2026** endpoints: `POST /me/playlists`, `POST /playlists/{id}/items` (not `/tracks`, not `/users/{id}/playlists`). Search `limit` max is **10** in dev mode.
- Removed for dev-mode apps: `GET /artists/{id}/top-tracks`, recommendations, batch fetches (`GET /tracks?ids=`, `/artists?ids=`, ...), browse endpoints. Still available: `GET /me/top/{type}`, `GET /me/player/recently-played` (last 50 only).
- Redirect URIs registered in the dashboard: `https://sachabaert.github.io/setlist-playlist/` and `http://127.0.0.1:5173/` (Spotify rejects `localhost`). Scopes: `playlist-modify-private playlist-modify-public`.
- Matching: resolve the artist ID first and only accept that artist's tracks; prefer studio over live/remix; covers are written `Song | Original artist` and searched under that artist.

## setlist.fm Worker

- Deployed in Cloudflare as `setlist-proxy`: `https://setlist-proxy.sacha-baert-88.workers.dev/?id=<setlistId>` (one setlist, cached a day) and `?artist=<name>&p=<1-5>` (search, songs included, cached 6 h; setlist.fm's 404 = no results is returned as an empty list).
- Last.fm: `?similar=<artist>` (artist.getSimilar, top 30, `{artist, similar:[{name, match}]}`) and `?toptracks=<artist>` (artist.getTopTracks, top 10, `{artist, tracks:[{name, playcount}]}`), autocorrect on, cached a week; unknown artist = empty list; 503 if `LASTFM_API_KEY` is missing.
- API keys are the Worker secrets `SETLISTFM_API_KEY` and `LASTFM_API_KEY` (dashboard secrets, never in wrangler.toml). Never put it in the repo or the page.
- CORS only for `https://sachabaert.github.io` and `http://127.0.0.1:5173`. Setlists are cached for a day.
- **Deploys are automated:** `.github/workflows/worker.yml` runs `wrangler deploy` (config in `wrangler.toml`) on every push to `main` that touches `worker/**` or `wrangler.toml`, and via "Run workflow". It uses the repo secrets `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers", expires 2027-11-10) and `CLOUDFLARE_ACCOUNT_ID`. Never ask Sacha to paste the token in chat. Never define `SETLISTFM_API_KEY` in wrangler.toml or `vars`: it is a dashboard secret and survives deploys.
- setlist.fm API terms require attribution: playlist descriptions link the setlist, the import box credits setlist.fm.

## Deploy notes

- Pages source is "GitHub Actions". Builds take ~20 s; deploys usually < 1 min. A stuck deploy is a GitHub hiccup: push a new commit rather than re-running the same SHA.
- The GitHub MCP connector cannot write `.github/workflows/*`. Use git or the GitHub web editor for workflow changes.
- No `package-lock.json` is committed; the workflow uses `npm install`.

## Privacy

Sacha's Spotify Extended Streaming History (2011–2026, ~84k streams, ~70 MB) contains `ip_addr` and `conn_country` per stream. **Never commit it, upload it to the project, or send it anywhere.** Statistics features must parse the export in the browser (File API, unzip client-side) so nothing leaves his computer.

Counting rules (in `history.ts`): a play is 30 s+; in rankings a song counts at most 10 times a day (`DAY_CAP`, continuous, no cliff); 20+ plays of one song in a day is flagged as a background loop; days over 12 h raw are flagged, scaled to 12 h and left out of "biggest day". Day boundaries use Europe/Brussels. Hours shown as "listened" are raw; rankings use the weighted numbers.

Export format: `Streaming_History_Audio_YYYY.json` arrays with `ts` (UTC), `ms_played`, `master_metadata_track_name`, `master_metadata_album_artist_name`, `master_metadata_album_album_name`, `spotify_track_uri`, `skipped`, `shuffle`, `reason_start`, `reason_end`, `platform`, plus podcast/audiobook fields. Count a stream as a play from 30 s. Some days are a song looping in the background (e.g. 151 plays of one song in a day, an 18.7 h day): detect and down-weight these so they don't distort rankings.

## Roadmap

Done: paste/import setlist, matching + review, manual search, setlist.fm credit, "Make another playlist", concert search by artist (empty/upcoming concerts shown greyed out), "prepare for a concert" mix, "No songs on setlist.fm yet" message.

Round 2 (needs new Worker endpoints; they deploy automatically):
1. Search concerts by artist instead of pasting a link (setlist.fm `/search/setlists?artistName=`).
2. Empty setlists: setlist.fm has many concerts without songs entered (e.g. id `2370a073` returns `songs: []`). Show "No songs on setlist.fm yet for this concert" instead of "Imported 0 songs", and in concert search mark or hide empty setlists.
3. "Prepare for a concert" mix: last 5–10 setlists of the current tour, songs ranked by how often they're played, in their usual order.

Statistics (separate page, local parsing only). Sacha wants **all** of these; build in this order:

Steps 1–7 are done (`stats.html`). Era thresholds (`ERA_*` in `eras.ts`) and the comeback/gem thresholds (`SILENCE_MONTHS`, `BEFORE_PLAYS`, `GEM_PLAYS`, … in `comebacks.ts`) are untuned against the real export: check them with the opt-in real-export test, which prints the eras, comebacks and forgotten favorites.

1. **Foundation:** load the export zip in the browser, normalize streams (play = 30 s or more), flag "on repeat in the background" days separately so they don't distort rankings.
2. **All-time Wrapped:** scrollable story with a chapter per year (song of the year, discovery of the year, hours listened) plus all-time highlights: first ever stream, most-played songs, biggest day, longest streak, most exploratory year.
3. **Year playlists:** top 30 per year (2014 onwards), created with the existing playlist code.
4. **Music timeline / eras:** detect eras automatically (e.g. Twenty One Pilots from 2015, the punk years with PUP and IDLES, KNEECAP from 2025).
5. **"On this day":** what he listened to on this date 5 and 10 years ago.
6. **Comebacks and forgotten favorites:** artists played a lot and then not for years (e.g. Fall Out Boy 2016 to 2022), with one-click playlist.
7. **"Forgotten gems" playlist:** songs played often in one period and then never again.
8. **Discoveries:** first play per artist and how fast they climbed (KNEECAP: first play Feb 2025, top 10 all-time within two years). Skip rate per artist and a listening heatmap (hour x weekday).
9. **Concert prep from his own taste:** for a setlist, which songs he already knows and which not yet, so he can listen to the unknown ones first.
10. **Games:** "Guess the year" (play a song from his history, guess when it was a favorite) and "Higher or lower" (which of two artists he played more).

**Discover (built 2026-11-11, untuned against the real export):** section on the stats page; "Find new music" matches on Spotify, then opens the main page's review screen with the picks (rows show "· Artist, via Seed"). Adventure = 2 hops: second-hop artists (not directly similar to any seed) first, hop 1 fills up. Thresholds in `discover.ts` (`SEED_COUNT`, `RECENT_YEARS`, `HOP_VIA`) and `DISCOVER_TRIES`/`TRACK_TRIES` in `page.ts`. A Spotify artist must match the Last.fm name exactly (`artistKey`) or it's skipped. Original spec: a playlist of music Sacha has never heard that fits his taste.
- Spotify recommendations and related artists are not available to dev-mode apps, so taste comes from **Last.fm** (`artist.getSimilar`, `artist.getTopTracks`) via new Worker endpoints. The key is the Worker secret `LASTFM_API_KEY` (Sacha adds it in the Cloudflare dashboard; never in the repo or chat). Cache Last.fm responses in the Worker.
- Seeds: his top artists from the export (weighted, recent years by default; options: last year, all time, a detected era). Score candidate artists by summed similarity x seed weight.
- "Never heard" = artist has zero streams in his export (checked in the browser). Optional "adventure" slider: one or two similarity hops.
- Tracks: Last.fm top tracks per new artist, matched on Spotify with the existing matching code, also excluding any `spotify_track_uri` in his history. Max 2 per artist, 30 total. Reuse the review screen and playlist creation; description says which seed artist each pick came from.

Reference numbers from a first analysis (for sanity-checking the code): 83,854 audio streams, 2011-12-21 to 2026-11-05, ~3,970 hours; no data from 2012-02-04 to 2014-06-16 (a gap in the export itself; show it as "no data", never as zero listening); top artist Twenty One Pilots (~275 h); most-played song "I Really Want to Stay at Your House" (Rosa Walton, 342 plays of 30 s+); 2018 had the most distinct artists (1,573). All verified by the code (2026-11-10). 25 entries have no track metadata, so 83,829 music streams, 68,406 plays. Weighted, "I Really Want to Stay at Your House" drops out of the top 5 (199 of its plays were on two loop days); top song becomes "Stressed Out" (185 weighted, 251 raw). 97 loop days flagged (biggest: "The Contract", 158× on 2025-06-13); longest raw day 2017-09-24 (20.7 h, a soundtrack looping); weighted biggest day 2015-03-26 (11 h); longest streak 28 days (2025-04-27 to 05-24).

## Working with Sacha

- Wants the best option recommended with arguments, and pushback when his idea is worse.
- Usage-conscious: keep scope tight, build in rounds, collect feedback in one batch.
- Tests (vitest) for pure logic; keep UI code thin.
