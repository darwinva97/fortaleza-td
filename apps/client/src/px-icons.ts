// ICONOS PIXEL de la interfaz (torres, enemigos, tipos de daño/armadura, afijos,
// fusiones). Sustituyen a los emojis, que cada sistema (Windows, macOS, Discord)
// pinta distinto y a veces ni pinta: un sprite se ve igual en todas partes.
//
// Todos viven en UNA rejilla, /icons/px-atlas.png (sprites 16x16 nativos del
// Pixel Art Atlas, CC0), generada por tools/pixel-atlas/build.py a partir de
// tools/pixel-atlas/picks.json. Para añadir o cambiar un icono: edita picks.json
// y vuelve a ejecutar el script; px-icons.gen.ts se regenera solo.
//
// Si una clave no tiene celda (p. ej. una torre nueva aún sin icono), se devuelve
// el emoji de siempre: nada se queda en blanco.
import { AFFIXES, ATTACK_TYPE_INFO, ARMOR_TYPE_INFO } from '@td/shared';
import type { AffixId, ArmorTypeId, AttackTypeId, EnemyTypeId, TowerTypeId } from '@td/shared';
import { PX_CELLS, PX_COLS, PX_ROWS } from './px-icons.gen.js';
import { ENEMY_ICONS, TOWER_ICONS } from './renderer.js';

const ATLAS_URL = '/icons/px-atlas.png';
const CELL = 16;

// background-position en % para que el icono escale con el font-size del contenedor
function pct(i: number, n: number): number {
  return n > 1 ? (i / (n - 1)) * 100 : 0;
}

// <i> con el sprite; `fallback` (emoji) si la clave no está en el atlas.
export function pxIcon(key: string, fallback = ''): string {
  const cell = PX_CELLS[key];
  if (!cell) return fallback;
  return `<i class="px" style="background-position:${pct(cell[0], PX_COLS)}% ${pct(cell[1], PX_ROWS)}%" aria-hidden="true"></i>`;
}

export const towerIcon = (t: TowerTypeId): string => pxIcon(`tower:${t}`, TOWER_ICONS[t]);
export const enemyIcon = (t: EnemyTypeId): string => pxIcon(`enemy:${t}`, ENEMY_ICONS[t]);
export const attackIcon = (a: AttackTypeId): string => pxIcon(`atk:${a}`, ATTACK_TYPE_INFO[a].icon);
export const armorIcon = (a: ArmorTypeId): string => pxIcon(`armor:${a}`, ARMOR_TYPE_INFO[a].icon);
export const affixIcon = (a: AffixId): string => pxIcon(`affix:${a}`, AFFIXES[a].icon);
export const fusionIcon = (f: { id: string; icon: string }): string => pxIcon(`fusion:${f.id}`, f.icon);

// ---------- canvas ----------
let atlas: HTMLImageElement | null = null;
let atlasReady = false;
function getAtlas(): HTMLImageElement | null {
  if (!atlas) {
    atlas = new Image();
    atlas.onload = () => (atlasReady = true);
    atlas.src = ATLAS_URL;
  }
  return atlasReady ? atlas : null;
}

// Dibuja el icono centrado en (cx, cy) con lado `size`. Devuelve false si aún no
// cargó el atlas o la clave no existe: el llamante pinta su emoji de respaldo.
export function drawPxIcon(g: CanvasRenderingContext2D, key: string, cx: number, cy: number, size: number): boolean {
  const cell = PX_CELLS[key];
  const img = cell ? getAtlas() : null;
  if (!cell || !img) return false;
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false; // pixel art: nada de difuminar al escalar
  g.drawImage(img, cell[0] * CELL, cell[1] * CELL, CELL, CELL, cx - size / 2, cy - size / 2, size, size);
  g.imageSmoothingEnabled = smooth;
  return true;
}
