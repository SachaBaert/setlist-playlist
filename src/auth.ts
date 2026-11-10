// Spotify login with Authorization Code + PKCE (no client secret needed).

export const CLIENT_ID = 'bde1387dee44433ab2311f114c7eae93';

export const REDIRECT_URI = import.meta.env.DEV
  ? 'http://127.0.0.1:5173/'
  : 'https://sachabaert.github.io/setlist-playlist/';

const SCOPES = 'playlist-modify-private playlist-modify-public';
const TOKEN_KEY = 'spotify_token';
const VERIFIER_KEY = 'pkce_verifier';
const STATE_KEY = 'pkce_state';
const RETURN_KEY = 'login_return_to';

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join('');
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** `returnTo`: a page of this site to go back to after login (the redirect URI is the main page). */
export async function login(returnTo?: string): Promise<void> {
  if (returnTo) sessionStorage.setItem(RETURN_KEY, returnTo);
  const verifier = randomString(64);
  const state = randomString(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: await sha256Base64Url(verifier),
    scope: SCOPES,
    state,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function requestToken(body: Record<string, string>): Promise<void> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }),
  });
  if (!res.ok) throw new Error(`Token request failed (${res.status})`);
  const data = await res.json();
  const previous = readToken();
  const token: StoredToken = {
    access_token: data.access_token,
    // Spotify doesn't always return a new refresh token on refresh.
    refresh_token: data.refresh_token ?? previous?.refresh_token ?? '',
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

/** After a login started elsewhere (e.g. the stats page), where to go back to. Read once. */
export function takeReturnTo(): string | null {
  const to = sessionStorage.getItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  return to && /^[\w-]+\.html$/.test(to) ? to : null;
}

/** Call once on page load: finishes the login if we're coming back from Spotify. */
export async function handleRedirect(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return;

  // Clean the URL either way.
  window.history.replaceState({}, '', REDIRECT_URI);
  if (error) throw new Error(`Spotify login cancelled (${error})`);

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier || params.get('state') !== sessionStorage.getItem(STATE_KEY)) {
    throw new Error('Login state mismatch, please try again.');
  }
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);

  await requestToken({
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
}

function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  return readToken() !== null;
}

/** Returns a valid access token, refreshing it if it expired. */
export async function getAccessToken(): Promise<string> {
  const token = readToken();
  if (!token) throw new Error('Not logged in');
  if (Date.now() < token.expires_at) return token.access_token;
  await requestToken({ grant_type: 'refresh_token', refresh_token: token.refresh_token });
  return readToken()!.access_token;
}
