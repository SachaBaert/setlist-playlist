// Pure matching logic: no network, so it can be unit-tested.

export interface Candidate {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album: { name: string; album_type: string };
}

export type Confidence = 'exact' | 'close' | 'weak' | 'none';

export interface SetlistEntry {
  title: string;
  artist?: string; // set for covers: "Song | Original artist"
}

/** Turn pasted text into entries: one per line, numbering and bullets stripped. */
export function parseSetlist(text: string): SetlistEntry[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(\d+\s*[.)\-:]|[-*•·])\s*/, '') // "1. ", "12) ", "- ", "• "
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .map((line) => {
      const bar = line.lastIndexOf(' | ');
      if (bar < 0) return { title: line };
      const artist = line.slice(bar + 3).trim();
      return artist ? { title: line.slice(0, bar).trim(), artist } : { title: line.slice(0, bar).trim() };
    });
}

/** Lowercase, strip accents, punctuation and "feat./with" parts. */
export function normalize(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([].*?(feat\.?|ft\.?|with)\b.*?[)\]]/g, '')
    .replace(/\s+-\s+.*$/, (m) => (VERSION_WORDS.test(m) ? '' : m)) // " - Live at X", " - Remastered"
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const VERSION_WORDS = /\b(live|remix|mix|demo|acoustic|edit|version|remaster(ed)?|instrumental|session|radio)\b/i;

function versionTags(title: string): boolean {
  // Version info usually lives in brackets or after " - ".
  const extra = (title.match(/[([].*?[)\]]/g) ?? []).join(' ') + (title.split(' - ').slice(1).join(' '));
  return VERSION_WORDS.test(extra);
}

/** Score one candidate for a requested title. Higher is better; returns null if not usable. */
export function scoreCandidate(
  requested: string,
  candidate: Candidate,
  artistId?: string,
): { score: number; confidence: Confidence } | null {
  if (artistId && !candidate.artists.some((a) => a.id === artistId)) return null;

  const want = normalize(requested);
  const got = normalize(candidate.name);
  // Compare titles without bracketed version info too.
  const gotBase = normalize(candidate.name.replace(/[([].*?[)\]]/g, '').split(' - ')[0]);

  let score = 0;
  let confidence: Confidence;
  if (got === want) {
    score += 100;
    confidence = 'exact';
  } else if (gotBase === want) {
    score += 80;
    confidence = 'close';
  } else if (got.includes(want) || want.includes(gotBase)) {
    score += 50;
    confidence = 'close';
  } else {
    const overlap = wordOverlap(want, gotBase);
    if (overlap < 0.5) return null;
    score += 30 * overlap;
    confidence = 'weak';
  }

  // Prefer studio versions unless the setlist asks for a specific version.
  if (versionTags(candidate.name) && !versionTags(requested)) score -= 30;
  if (/live/i.test(candidate.album.name) && !/live/i.test(requested)) score -= 15;

  score += { album: 10, single: 6, compilation: 0 }[candidate.album.album_type] ?? 0;
  return { score, confidence };
}

function wordOverlap(a: string, b: string): number {
  const wa = new Set(a.split(' '));
  const wb = new Set(b.split(' '));
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / Math.max(wa.size, wb.size);
}

/** Rank candidates best-first; drops ones that don't match at all. */
export function rankCandidates<T extends Candidate>(
  requested: string,
  candidates: T[],
  artistId?: string,
): { track: T; score: number; confidence: Confidence }[] {
  const seen = new Set<string>();
  return candidates
    .map((track) => ({ track, result: scoreCandidate(requested, track, artistId) }))
    .filter((x): x is { track: T; result: { score: number; confidence: Confidence } } => x.result !== null)
    .map(({ track, result }) => ({ track, ...result }))
    .sort((a, b) => b.score - a.score)
    .filter(({ track }) => {
      // Same song on single + album: keep only the best-scored copy.
      const key = track.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
