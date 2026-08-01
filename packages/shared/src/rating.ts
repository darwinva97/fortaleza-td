// ---------- LADDER de ARENA · rating por pares (Elo multijugador) ----------
//
// La arena no es un 1v1: es un free-for-all de hasta MAX_PLAYERS con un resultado
// ORDINAL (quién aguantó más). El modelo estándar para eso es descomponer la
// partida en duelos: una de N jugadores son C(N,2) enfrentamientos, y cada uno
// "gana" a todos los que terminaron por debajo. El ajuste de cada jugador es la
// suma de sus duelos dividida entre (N-1), para que una partida de 8 no mueva el
// rating siete veces más que una de 2.
//
// Todo aquí es PURO y determinista: entra el orden final y los ratings previos,
// sale cuánto se mueve cada uno. Quién puede puntuar (sala pública, gente
// suficiente, sin turbo) es política del servidor y vive en isRankedArena; el
// histórico y la persistencia, en la base de datos. Así la fórmula se prueba en
// simtest sin levantar nada.

import type { GameMode } from './types.js';

// Todos empiezan en la media a propósito: con identidad de dispositivo, crearse
// una nueva es trivial, así que el sistema JAMÁS debe premiar el reinicio. Si
// empezar de cero te devuelve exactamente al punto de partida, resetear solo
// cuesta lo que llevabas ganado.
export const RATING_START = 1000;
// Suelo: por debajo de esto el número deja de significar nada y solo desmotiva.
export const RATING_FLOOR = 100;

// Fase PROVISIONAL: las primeras partidas mueven mucho más para que un recién
// llegado caiga rápido en su nivel real en vez de contaminar los duelos de los
// demás durante treinta partidas. Con una base de jugadores pequeña, converger
// rápido importa más que la suavidad de la curva.
export const PROVISIONAL_GAMES = 10;
export const K_PROVISIONAL = 64;
export const K_ESTABLISHED = 24;

// Mínimo de identidades DISTINTAS para que una partida puntúe. Con dos, montar un
// farmeo es tan fácil como abrir una ventana de incógnito y dejarse morir.
export const LADDER_MIN_PLAYERS = 3;

// Un jugador tal y como entra al cálculo: su rating previo, cuántas partidas
// lleva (decide el K) y en qué puesto acabó. `place` es 1 = mejor, y los empates
// COMPARTEN número (dos segundos ⇒ 1, 2, 2, 4).
export interface RatedEntry {
  pid: string;
  rating: number;
  games: number;
  place: number;
}

export interface RatingResult {
  pid: string;
  before: number;
  after: number;
  delta: number;
  k: number;
}

// Lo mínimo del resultado de arena que hace falta para ordenar el podio. Coincide
// con lo que ya viaja en EndStatsPlayer (waveReached / eliminatedTick /
// eliminated), así que el servidor no tiene que inventarse nada nuevo.
export interface ArenaOutcome {
  pid: string;
  eliminated: boolean;
  waveReached: number;
  eliminatedTick: number;
}

// Probabilidad esperada de que `rating` termine por delante de `vs` (curva Elo
// clásica: 400 puntos de diferencia ≈ 10 a 1).
export function expectedScore(rating: number, vs: number): number {
  return 1 / (1 + Math.pow(10, (vs - rating) / 400));
}

export function kFactor(games: number): number {
  return games < PROVISIONAL_GAMES ? K_PROVISIONAL : K_ESTABLISHED;
}

// PODIO de una partida de arena. MISMO criterio que usa la pantalla de fin: gana
// quien sigue en pie; entre eliminados, quien llegó a más oleada; y a igualdad de
// oleada, quien aguantó más dentro de ella (eliminatedTick mayor). Vive aquí para
// que el ranking que se PINTA y el que PUNTÚA no puedan divergir nunca.
export function arenaPlaces(players: ArenaOutcome[]): Map<string, number> {
  const orden = [...players].sort(cmpArena);
  const places = new Map<string, number>();
  let place = 0;
  for (let i = 0; i < orden.length; i++) {
    // empate exacto con el anterior ⇒ mismo puesto; si no, el puesto es la
    // posición real en la lista (1, 2, 2, 4 — no 1, 2, 2, 3).
    if (i === 0 || cmpArena(orden[i - 1], orden[i]) !== 0) place = i + 1;
    places.set(orden[i].pid, place);
  }
  return places;
}

// Comparador del podio. Devuelve 0 SOLO en empate real (los tres criterios
// iguales), que es lo que permite a arenaPlaces detectar los empates.
function cmpArena(a: ArenaOutcome, b: ArenaOutcome): number {
  if (!a.eliminated !== !b.eliminated) return a.eliminated ? 1 : -1;
  if (a.waveReached !== b.waveReached) return b.waveReached - a.waveReached;
  return b.eliminatedTick - a.eliminatedTick;
}

// El cálculo. Cada jugador se enfrenta a todos los demás: suma 1 por cada rival
// que quedó por debajo, 0.5 por cada empate y 0 por cada uno que quedó por encima,
// y se le resta lo que su rating hacía ESPERAR. Ganar a quien ya se te suponía
// superior apenas mueve; perder contra quien no debía, duele.
//
// NOTA sobre la suma cero: con K distintos (alguien provisional en la mesa) la
// suma de deltas no da exactamente 0, igual que en el Elo de la FIDE. Es
// deliberado — la convergencia rápida del recién llegado vale más que conservar
// la masa total al punto, y la desviación se limita sola porque la fase
// provisional dura PROVISIONAL_GAMES partidas. Entre jugadores ya establecidos la
// suma SÍ es cero exacta (simtest lo comprueba).
export function rateMatch(entries: RatedEntry[]): RatingResult[] {
  const n = entries.length;
  // con menos de dos no hay duelo posible: nadie se mueve
  if (n < 2) return entries.map((e) => ({ pid: e.pid, before: e.rating, after: e.rating, delta: 0, k: kFactor(e.games) }));

  return entries.map((yo) => {
    let suma = 0;
    for (const otro of entries) {
      if (otro === yo) continue;
      const s = yo.place < otro.place ? 1 : yo.place === otro.place ? 0.5 : 0;
      suma += s - expectedScore(yo.rating, otro.rating);
    }
    const k = kFactor(yo.games);
    const bruto = yo.rating + (k / (n - 1)) * suma;
    const after = Math.max(RATING_FLOOR, Math.round(bruto));
    return { pid: yo.pid, before: yo.rating, after, delta: after - yo.rating, k };
  });
}

// ---------- RANGOS · la medalla que se enseña ----------
//
// El número crudo se guarda pero NO se enseña: con partidas que mueven 12-24
// puntos, un MMR a la vista se lee como ruido y la gente juega mirando el número
// en vez del juego. Lo que se enseña es una MEDALLA con ESTRELLAS, al estilo de
// los sistemas de rango por divisiones: cada rango vale 200 puntos y cada una de
// sus 5 estrellas 40, así que 2-3 partidas ganadas encienden una estrella — hay
// avance visible casi cada sesión, y aun así subir de medalla cuesta. Al llenar
// la quinta estrella se pasa al rango siguiente.
//
// El último rango, INMORTAL, funciona distinto y a propósito: no tiene estrellas
// sino PUESTO. Quien más puntos tiene es el Inmortal 1, el siguiente el 2, y así.
// Como el orden se recalcula por puntos, el puesto se lo puede quitar cualquiera
// en su siguiente partida — que es justo lo que hace que la cima siga en juego.
export const RANK_STARS = 5;
export const RANK_WIDTH = 200;

export interface RankTier {
  id: string;
  name: string;
  min: number; // rating a partir del cual empieza este rango
}

// De menor a mayor. El primero recoge todo lo que baje del segundo (hasta el
// suelo) y el último —INMORTAL— es abierto por arriba y no tiene estrellas.
//
// La escala está puesta para que quien EMPIEZA caiga en Arconte ★★★: en mitad de
// los rangos con estrellas, pero con tres escalones y el Inmortal por encima. Un
// sistema donde arrancas ya en el nombre más vistoso no deja a dónde subir.
// Heraldo es más ancho que el resto a propósito: es el pozo del que cuesta salir.
export const RANKS: RankTier[] = [
  { id: 'heraldo', name: 'Heraldo', min: RATING_FLOOR },
  { id: 'guardian', name: 'Guardián', min: 700 },
  { id: 'arconte', name: 'Arconte', min: 900 },
  { id: 'leyenda', name: 'Leyenda', min: 1100 },
  { id: 'ancestral', name: 'Ancestral', min: 1300 },
  { id: 'divino', name: 'Divino', min: 1500 },
  { id: 'inmortal', name: 'Inmortal', min: 1700 },
];

// Índice del rango más alto (el único sin estrellas y con puesto numérico).
export const IMMORTAL_TIER = RANKS.length - 1;

export interface RankBadge {
  tier: number; // índice en RANKS
  id: string;
  name: string;
  stars: number; // 1..RANK_STARS; 0 en Inmortal (no tiene divisiones)
  provisional: boolean; // aún calibrando: no hay medalla que enseñar
  games: number;
  // INMORTAL · puesto en la clasificación de inmortales (1 = el que más puntos
  // tiene). null si no es inmortal o si aún no se ha consultado la tabla: el
  // puesto no se puede deducir del rating de uno solo, hay que mirarlos a todos.
  position: number | null;
}

// Medalla de un jugador. Durante la calibración NO se devuelve rango: enseñar una
// medalla que va a saltar tres escalones en las próximas partidas es peor que no
// enseñar ninguna. La UI pinta «Calibrando 4/10» con lo que hay en `games`.
//
// `position` solo se usa en Inmortal y lo aporta quien haya leído la tabla (ver
// immortalPositions): el puesto es RELATIVO al resto, así que esta función no
// puede calcularlo sola.
export function rankOf(rating: number, games: number, position: number | null = null): RankBadge {
  const provisional = games < PROVISIONAL_GAMES;
  let tier = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (rating >= RANKS[i].min) {
      tier = i;
      break;
    }
  }
  const top = tier === IMMORTAL_TIER;
  const desde = RANKS[tier].min;
  const ancho = top ? RANK_WIDTH : RANKS[tier + 1].min - desde;
  const stars = top
    ? 0
    : Math.max(1, Math.min(RANK_STARS, 1 + Math.floor(((rating - desde) / ancho) * RANK_STARS)));
  return {
    tier,
    id: RANKS[tier].id,
    name: RANKS[tier].name,
    stars,
    provisional,
    games,
    position: top ? position : null,
  };
}

// Cómo se escribe una medalla: «Arconte ★★★» o «Inmortal 4». El Inmortal se
// nombra por su PUESTO, no por estrellas — es la gracia del rango.
export function rankLabel(badge: RankBadge): string {
  if (badge.provisional) return `Calibrando ${badge.games}/${PROVISIONAL_GAMES}`;
  if (badge.tier === IMMORTAL_TIER) return badge.position ? `Inmortal ${badge.position}` : 'Inmortal';
  return `${badge.name} ${'★'.repeat(badge.stars)}`;
}

// INMORTAL · reparte los puestos. Se ordena por PUNTOS, así que el puesto no es
// un trofeo que se conserva: si el Inmortal 2 adelanta en puntos al 1, en la
// siguiente partida son 1 y 2 al revés, sin que nadie tenga que hacer nada. Los
// empates a puntos se deshacen por quien llegó antes a inmortal (`since`), que es
// estable y no depende del orden en que venga la lista.
export function immortalPositions(
  jugadores: { pid: string; rating: number; since: number }[],
): Map<string, number> {
  const inmortales = jugadores
    .filter((j) => j.rating >= RANKS[IMMORTAL_TIER].min)
    .sort((a, b) => b.rating - a.rating || a.since - b.since || (a.pid < b.pid ? -1 : 1));
  const out = new Map<string, number>();
  inmortales.forEach((j, i) => out.set(j.pid, i + 1));
  return out;
}

// ¿Esta partida puntúa? Reglas duras, todas por el mismo motivo: que el rating
// mida jugar bien y no montar el escenario que te conviene.
//   · solo ARENA (es el único modo que clasifica comparando carriles);
//   · solo salas PÚBLICAS: en una privada eliges tú a los rivales;
//   · al menos LADDER_MIN_PLAYERS identidades DISTINTAS (el Set las cuenta: dos
//     pestañas del mismo dispositivo comparten pid y NO suman);
//   · sin turbo, mismo criterio que los récords: su economía comprimida da más
//     oro con el mismo reto y no es comparable con una partida normal.
export function isRankedArena(opts: {
  mode: GameMode;
  turbo: boolean;
  publicRoom: boolean;
  pids: string[];
}): boolean {
  if (opts.mode !== 'arena' || opts.turbo || !opts.publicRoom) return false;
  const distintos = new Set(opts.pids.filter((p) => p.length > 0));
  return distintos.size >= LADDER_MIN_PLAYERS;
}
