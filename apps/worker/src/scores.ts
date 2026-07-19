import { MAX_PLAYERS, type HighscoreEntry } from '@td/shared';
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

// clave de identidad de una entrada (SIN fecha): mismos jugadores + oleada + modo
// + dificultad + mapa = la MISMA marca. Recargar un guardado y reenviar la misma
// oleada no debe crear una entrada nueva (las reanudadas SÍ puntúan, pero una
// marca idéntica se cuenta una vez). Nombres ordenados: el orden no importa.
function scoreKey(e: HighscoreEntry): string {
  return `${[...e.names].sort().join('|')}·${e.wave}·${e.mode}·${e.difficulty}·${e.mapId}`;
}

export async function saveScore(env: Env, entry: HighscoreEntry): Promise<void> {
  if (!env.SCORES) return;
  // DEFENSA EN PROFUNDIDAD: una sala jamás tiene más de MAX_PLAYERS simultáneos;
  // si llegan más nombres es que algo (p. ej. un guardado adulterado con joins
  // inyectados — visto en producción: 80 «MigracionN») se coló aguas arriba.
  // La validación del guardado ya lo rechaza en el borde; aquí capamos igual.
  if (entry.names.length > MAX_PLAYERS) entry = { ...entry, names: entry.names.slice(0, MAX_PLAYERS) };
  const list = await loadScores(env);
  // dedup: si ya existe una entrada idéntica (misma gente/oleada/modo/dif/mapa),
  // no la dupliques — cubre recargar el mismo guardado varias veces.
  const key = scoreKey(entry);
  if (list.some((e) => scoreKey(e) === key)) return;
  list.push(entry);
  list.sort((a, b) => b.wave - a.wave);
  await env.SCORES.put(KEY, JSON.stringify(list.slice(0, MAX)));
}
