// Hands a ready-made review (e.g. Discover from the stats page) to the main page's
// review screen. One-shot: taking it removes it.
import type { Confidence } from './match';
import type { Artist, Track } from './spotify';

export interface HandoffRow {
  title: string;
  artist: Artist | null;
  note?: string; // shown after the artist, e.g. "via Twenty One Pilots"
  options: { track: Track; confidence: Confidence | 'manual' }[];
  choice: number;
}

export interface Handoff {
  heading: string; // replaces "Artist: …" on the review screen
  name: string;
  description: string;
  rows: HandoffRow[];
}

const KEY = 'review_handoff';

export function saveHandoff(h: Handoff): void {
  localStorage.setItem(KEY, JSON.stringify(h));
}

export function takeHandoff(): Handoff | null {
  try {
    const h = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    localStorage.removeItem(KEY);
    return h?.rows?.length ? h : null;
  } catch {
    return null;
  }
}
