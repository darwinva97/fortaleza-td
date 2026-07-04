// Carga de sprites reales de torre (PNG en /sprites/, servidos desde public/) con
// FALLBACK al arte vectorial: si un sprite no existe o aún no cargó, getTowerSprite
// devuelve null y el renderer dibuja el vector de siempre. Migración gradual y segura.
import type { TowerTypeId } from '@td/shared';

const cache = new Map<string, HTMLImageElement | null>();

export let spritesEnabled = localStorage.getItem('td_sprites') !== '0';
export function setSpritesEnabled(on: boolean): void {
  spritesEnabled = on;
  localStorage.setItem('td_sprites', on ? '1' : '0');
}

// Carga perezosa + cacheada. Devuelve la imagen si ya está lista, o null mientras
// carga / si falló (404). El renderer usa el vector hasta que esté disponible.
function load(url: string): HTMLImageElement | null {
  const cached = cache.get(url);
  if (cached !== undefined) return cached;
  const img = new Image();
  cache.set(url, null);
  img.onload = () => cache.set(url, img);
  img.onerror = () => cache.set(url, null);
  img.src = url;
  return null;
}

// etapa del sprite: especializada -> specA/specB ; si no -> l1/l2/l3
function stageOf(level: number, spec: number): string {
  if (spec === 0) return 'specA';
  if (spec === 1) return 'specB';
  return `l${Math.max(1, Math.min(3, level))}`;
}

// torres que ya tienen hoja de sprites (el resto cae al vector automáticamente)
const HAS_SPRITE = new Set<TowerTypeId>([
  'archer', 'cannon', 'frost', 'poison', 'tesla', 'sniper', 'mortar', 'banner', 'trap',
]);

export function getTowerSprite(type: TowerTypeId, level: number, spec: number): HTMLImageElement | null {
  if (!spritesEnabled || !HAS_SPRITE.has(type)) return null;
  // la Trampa no se mejora: siempre su única imagen.
  const stage = type === 'trap' ? 'l1' : stageOf(level, spec);
  const img = load(`/sprites/tower_${type}_${stage}.png`);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

// texturas de partícula (blanco, para tintar). part_<name>.png
export function getPartSprite(name: string): HTMLImageElement | null {
  if (!spritesEnabled) return null;
  const img = load(`/sprites/part_${name}.png`);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

export function getProjSprite(name: string): HTMLImageElement | null {
  if (!spritesEnabled) return null;
  const img = load(`/sprites/proj_${name}.png`);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
