import type { AffixId } from '../types.js';

// Orden estable: se usa como índice de bit en el snapshot (bit = 1<<index).
export const AFFIX_ORDER: AffixId[] = [
  'swift',
  'armored',
  'regen',
  'vampiric',
  'elusive',
  'frostward',
  'explosive',
  // F9a (v19) · afijos de JEFE — SOLO crecen AL FINAL (el bit viaja en snapshot)
  'adaptive',
  'chillaura',
];

// F9a (v19) · afijos exclusivos de JEFE: nunca salen en élites ni en oleadas
// bendecidas (sus mecánicas — adaptación por impactos, aura anti-torres — están
// pensadas para UN objetivo gordo y telegrafiado, no para diez pequeños).
export const BOSS_ONLY_AFFIXES: AffixId[] = ['adaptive', 'chillaura'];
// Los afijos que un JEFE puede traer (F9a): los 7 de élite + los 2 nuevos.
export const BOSS_AFFIX_POOL: AffixId[] = [...AFFIX_ORDER];
// Los afijos que puede traer un ÉLITE o una oleada bendecida (sin los de jefe).
export const ELITE_AFFIX_POOL: AffixId[] = AFFIX_ORDER.filter((a) => !BOSS_ONLY_AFFIXES.includes(a));

export interface AffixDef {
  id: AffixId;
  name: string;
  icon: string;
  color: string;
  desc: string;
}

export const AFFIXES: Record<AffixId, AffixDef> = {
  swift: { id: 'swift', name: 'Veloz', icon: '💨', color: '#4fc3f7', desc: 'Se mueve mucho más rápido' },
  armored: { id: 'armored', name: 'Coraza', icon: '🛡️', color: '#b0bec5', desc: 'Armadura reforzada' },
  regen: { id: 'regen', name: 'Regenerador', icon: '💚', color: '#81c784', desc: 'Recupera vida constantemente' },
  vampiric: { id: 'vampiric', name: 'Vampírico', icon: '🩸', color: '#e57373', desc: 'Cura a los enemigos cercanos' },
  elusive: { id: 'elusive', name: 'Escurridizo', icon: '👁️', color: '#ce93d8', desc: 'Esquiva muchos proyectiles' },
  frostward: { id: 'frostward', name: 'Gélido', icon: '❄️', color: '#80deea', desc: 'Resiste el hielo' },
  explosive: { id: 'explosive', name: 'Explosivo', icon: '💥', color: '#ffb74d', desc: 'Suelta crías al morir' },
  // F9a (v19) · afijos de jefe
  adaptive: {
    id: 'adaptive',
    name: 'Adaptativo',
    icon: '🧬',
    color: '#ce93d8',
    desc: 'Tras muchos impactos del mismo tipo de ataque, gana resistencia contra él (−50%). Diversifica tus torres',
  },
  chillaura: {
    id: 'chillaura',
    // OJO: 'frostward' ya se llama "Gélido" (resiste el hielo); este es su espejo
    // ofensivo y se distingue por el "Aura".
    name: 'Aura Gélida',
    icon: '🥶',
    color: '#80deea',
    desc: 'Aura helada: las torres cercanas disparan mucho más lento mientras pasa',
  },
};

// Máscara de bits de una lista de afijos (para el snapshot compacto).
export function affixMask(affixes: AffixId[]): number {
  let m = 0;
  for (const a of affixes) m |= 1 << AFFIX_ORDER.indexOf(a);
  return m;
}

// Afijos presentes en una máscara (para el cliente).
export function affixesFromMask(mask: number): AffixId[] {
  const out: AffixId[] = [];
  for (let i = 0; i < AFFIX_ORDER.length; i++) if (mask & (1 << i)) out.push(AFFIX_ORDER[i]);
  return out;
}
