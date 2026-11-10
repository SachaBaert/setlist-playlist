# Setlist to Playlist

Paste a setlist, check the Spotify matches, and create a private playlist with the songs in the exact order.

Live: https://sachabaert.github.io/setlist-playlist/

## How it works

- **Login:** Spotify Authorization Code flow with PKCE, entirely in the browser (no client secret, no server).
- **Matching:** finds the artist first, then searches each title and only accepts tracks by that artist ID. Titles are normalized (accents, punctuation, "feat.") and studio versions are preferred over live/remix versions unless the setlist asks for one. Every match can be changed or skipped before the playlist is created.
- **Creating:** `POST /me/playlists`, then `POST /playlists/{id}/items` in batches of 100 (Spotify's February 2026 endpoints).

## Development

```bash
npm install
npm run dev     # http://127.0.0.1:5173/
npm test        # unit tests for the matching logic
```

Spotify only accepts `127.0.0.1`, not `localhost`, as a local redirect URI.

## Spotify app settings

Redirect URIs registered in the developer dashboard:

- `https://sachabaert.github.io/setlist-playlist/`
- `http://127.0.0.1:5173/`

The app is in Development Mode: only allow-listed accounts (max 5) can log in.

## Deploy

Every push to `main` runs the tests, builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`.
Pages source must be set to **GitHub Actions** (Settings → Pages).

## setlist.fm import

Paste a setlist.fm link to fill in artist, playlist name and songs. Tapes are skipped unless you tick the box; covers are written as `Song | Original artist` and searched under that artist.

The page can't call setlist.fm directly (no CORS, and the API key must stay secret), so it goes through a Cloudflare Worker: `worker/worker.js`, deployed as `setlist-proxy`. The key is stored as the Worker secret `SETLISTFM_API_KEY`; each setlist is cached for a day.

## Listening stats

`stats.html` turns a Spotify Extended Streaming History export into an all-time Wrapped: a chapter per year plus all-time highlights. The zip is read in the browser (File API + [fflate](https://github.com/101arrowz/fflate)); nothing is uploaded. Songs left on repeat in the background are capped so they don't distort the rankings.
