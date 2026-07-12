import type { Difficulty, GameMode, GameState, PlayerState } from '../types.js';
import {
  CLASSIC_WAVES,
  FIRST_INTERLUDE_SEC,
  START_GOLD,
  START_LIVES,
  START_WOOD,
  TICK_RATE,
  TURBO_INTERLUDE_MULT,
  WOOD_PRICE_BASE,
} from '../constants.js';

export interface NewPlayerInput {
  id: string;
  name: string;
  color: string;
}

export function makePlayer(input: NewPlayerInput, gold: number, wood = START_WOOD): PlayerState {
  return {
    id: input.id,
    name: input.name,
    color: input.color,
    gold,
    wood,
    orcLevel: 1,
    connected: true,
    stats: { kills: 0, damage: 0, goldEarned: 0, goldSpent: 0, towersBuilt: 0 },
  };
}

export function createGame(
  mapId: string,
  mode: GameMode,
  difficulty: Difficulty,
  seed: number,
  players: NewPlayerInput[],
  // MODO TURBO ⚡ (issue #14): opcional para no tocar los call sites que no lo usan
  // (herramientas, pruebas). Se NORMALIZA aquí (fuente de verdad de la sim): SIEMPRE
  // false en horda, aunque el llamador pase true. Así toda la sim puede leer
  // state.turbo sin repetir la excepción de la horda.
  turbo = false,
): GameState {
  const turboActive = turbo && mode !== 'horde';
  return {
    tick: 0,
    mapId,
    mode,
    difficulty,
    turbo: turboActive,
    rng: seed | 0,
    lives: START_LIVES,
    maxLives: START_LIVES,
    wave: 0,
    // classic tiene fin por número de oleadas; endless y horde son infinitos (0)
    totalWaves: mode === 'classic' ? CLASSIC_WAVES : 0,
    waveState: 'interlude',
    // el turbo recorta el PRIMER interludio a la mitad (igual que los normales en step.ts)
    interludeLeft: Math.round(FIRST_INTERLUDE_SEC * TICK_RATE * (turboActive ? TURBO_INTERLUDE_MULT : 1)),
    nextWaveComp: [],
    nextWaveImmune: false,
    nextWaveBlessed: false,
    nextWaveFlying: false,
    nextWaveInvisible: false,
    nextWaveBoss: null,
    pendingWave: null,
    pendingBoss: false,
    pendingBossType: null,
    blessedBonusMult: 1,
    spawnQueue: [],
    spawnCooldown: 0,
    enemies: [],
    towers: [],
    projectiles: [],
    players: players.map((p) => makePlayer(p, START_GOLD[difficulty])),
    woodPrice: WOOD_PRICE_BASE,
    nextId: 1,
    over: null,
  };
}
