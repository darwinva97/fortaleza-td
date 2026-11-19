// CACERÍA · modo ASIMÉTRICO: un CAZADOR contra los COLONOS.
//
// Inspirado en el género «troll contra elfos» (las curvas salen del mapa de
// referencia Troll & Elves 3.9: ver defs.ts). Los colonos tienen 30 s de ventaja
// para elegir una parcela del laberinto, cerrarla con murallas y montar su
// economía (casa, minas, leñadores, mercado de madera); mueren en dos golpes. El
// cazador cobra en oro cada punto de daño, sube de nivel con las bajas y se
// equipa en la tienda de su guarida, donde además se cura. Al caer, un colono
// vuelve como ángel (ayuda a los suyos) o como lobo (se pasa al cazador).
//
// Módulos: defs.ts (equilibrio), map.ts (laberinto), sim.ts (reglas, visión y
// snapshot), bot.ts (cazador de la máquina). Este archivo es la puerta pública.
import { TICK_RATE } from '../constants.js';
import type { HuntState } from './sim.js';

export * from './defs.js';
export * from './map.js';
export * from './sim.js';
export * from './bot.js';

export const HUNT = {
  MIN_PLAYERS: 1, // con uno solo, el cazador lo lleva el bot
} as const;

export interface HuntInit {
  youAre: string;
  hunterId: string;
  players: { id: string; name: string; color: string; role: 'hunter' | 'colonist' }[];
}

export interface HuntResultPlayer {
  id: string;
  name: string;
  color: string;
  role: 'hunter' | 'colonist';
  form: string;
  alive: boolean;
  goldEarned: number;
  damage: number;
  built: number;
  kills: number;
  level: number;
}

export interface HuntResult {
  winner: 'hunter' | 'colonist';
  reason: string;
  seconds: number;
  players: HuntResultPlayer[];
}

export function huntResult(st: HuntState): HuntResult {
  return {
    winner: st.over?.winner ?? 'colonist',
    reason: st.over?.reason ?? 'hunter_dead',
    seconds: Math.round(st.tick / TICK_RATE),
    players: st.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      role: p.role,
      form: p.form,
      alive: p.alive,
      goldEarned: Math.round(p.stats.goldEarned),
      damage: Math.round(p.stats.damage),
      built: p.stats.built,
      kills: p.stats.kills,
      level: p.level,
    })),
  };
}
