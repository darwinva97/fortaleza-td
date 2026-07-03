import type { HighscoreEntry } from '@td/shared';
import type { Env } from './room-do.js';

const KEY = 'highscores';
const MAX = 20;

// Récords guardados en KV (opcional: si no hay binding SCORES, se desactivan).
export async function loadScores(env: Env): Promise<HighscoreEntry[]> {
  if (!env.SCORES) return [];
  const raw = await env.SCORES.get(KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as HighscoreEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveScore(env: Env, entry: HighscoreEntry): Promise<void> {
  if (!env.SCORES) return;
  const list = await loadScores(env);
  list.push(entry);
  list.sort((a, b) => b.wave - a.wave);
  await env.SCORES.put(KEY, JSON.stringify(list.slice(0, MAX)));
}
