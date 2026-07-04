// Bestiario: ficha de cada monstruo (icono, nombre, rasgos y qué hace).
// Solo cliente. Las descripciones son texto curado; los RASGOS se derivan de los
// flags reales de cada EnemyDef para no desincronizarse nunca de la mecánica.
import { ENEMY_ORDER, ENEMIES } from '@td/shared';
import type { EnemyDef, EnemyTypeId } from '@td/shared';
import { ENEMY_ICONS } from './renderer.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Descripción curada por enemigo (fiel a la simulación).
const DESC: Record<EnemyTypeId, string> = {
  goblin: 'Tropa básica. Sin sorpresas: llega en número y desgasta tus defensas.',
  runner: 'Muy rápido y frágil. Se cuela si tus torres son lentas o dejas huecos.',
  brute: 'Aguanta golpes y lleva algo de armadura. Cuesta 2 vidas si se escapa.',
  bat: 'Vuela: solo lo alcanzan las torres con anti-aire (arquero, hielo, veneno, tesla, francotirador).',
  armored: 'Mucha armadura: reduce el daño físico plano. Usa perforación o daño mágico.',
  shaman: 'Cura a los enemigos cercanos con su aura. Mátalo primero o mantendrá viva a la horda.',
  larva: 'Diminuta, rapidísima y muy débil. Viene en enjambres para saturar tus torres.',
  troll: 'Regenera vida sin parar. Necesita daño sostenido o un golpe que lo mate de una.',
  slime: 'Al morir se divide en 2 Babosines. El daño en área ayuda a limpiar los restos.',
  slimelet: 'La cría del Baboso: débil y rápida. Aparece en pares al reventar a su padre.',
  ghost: 'Esquiva el 30% de los proyectiles. Los disparos instantáneos (francotirador, tesla) siempre aciertan.',
  golem: 'Jefe. Enorme y acorazado; al morir suelta 3 Brutos. Aparece cada 10 oleadas.',
  sapper:
    'Se detiene junto a tu torre más cercana y la ATURDE mientras viva: deja de disparar. Prioriza matarlo — es físico, cualquier torre le hace daño.',
  thief: 'No quita vidas: si escapa, ROBA oro del equipo. Rápido y frágil; no lo dejes pasar.',
  berserker:
    'Al bajar del 40% de vida se ENFURECE y corre un 50% más rápido. Remátalo de golpe antes de que acelere.',
  skywhale: 'Volador TANQUE: enorme cantidad de vida por el aire. Castiga no tener buen anti-aire.',
  wraith:
    'Esquiva el 45% e INMUNE a la magia (hielo, veneno y ejecución; el tesla le pega reducido). Usa daño físico o el disparo certero del francotirador.',
  chimera: 'Jefe VOLADOR (oleadas 15/25/35). Obliga a tener anti-aire: el cañón y el mortero no la alcanzan.',
  behemoth: 'Jefe demoledor. Al cruzar cada esquina ATURDE todas las torres a su alrededor. Vida descomunal.',
};

interface Trait {
  icon: string;
  label: string;
  cls?: string;
}

// Rasgos derivados de los flags REALES del EnemyDef (nunca se desincronizan).
function traitsOf(def: EnemyDef): Trait[] {
  const t: Trait[] = [];
  if (def.boss) t.push({ icon: '💀', label: 'Jefe', cls: 'boss' });
  if (def.flying) t.push({ icon: '🦅', label: 'Volador', cls: 'air' });
  if (def.spellImmune) t.push({ icon: '🛡', label: 'Inmune a magia', cls: 'immune' });
  if (def.sapper) t.push({ icon: '🔨', label: 'Aturde torres' });
  if (def.stunOnCorner) t.push({ icon: '💥', label: 'Aturde al girar' });
  if (typeof def.stealGold === 'number' && def.stealGold > 0) t.push({ icon: '💰', label: 'Roba oro' });
  if (typeof def.berserkBelow === 'number') t.push({ icon: '🐗', label: 'Se enfurece' });
  if (typeof def.dodge === 'number' && def.dodge > 0)
    t.push({ icon: '🌫', label: `Esquiva ${Math.round(def.dodge * 100)}%` });
  if (typeof def.regen === 'number' && def.regen > 0) t.push({ icon: '♻️', label: 'Regenera' });
  if (def.healAura) t.push({ icon: '✨', label: 'Cura aliados' });
  if (def.spawnOnDeath) t.push({ icon: '🔁', label: 'Se divide' });
  if (def.armor >= 6) t.push({ icon: '🩹', label: 'Muy blindado' });
  if (!def.boss && def.speed >= 2.2) t.push({ icon: '💨', label: 'Rápido' });
  return t;
}

function speedLabel(s: number): string {
  if (s < 0.7) return 'Muy lento';
  if (s < 1.0) return 'Lento';
  if (s < 1.6) return 'Normal';
  if (s < 2.2) return 'Rápido';
  return 'Muy rápido';
}

let built = false;
function build(): void {
  if (built) return;
  built = true;
  // enemigos normales primero, jefes al final
  const order = [...ENEMY_ORDER].sort(
    (a, b) => Number(ENEMIES[a].boss ?? false) - Number(ENEMIES[b].boss ?? false),
  );
  $('bestiary-grid').innerHTML = order
    .map((type) => {
      const def = ENEMIES[type];
      const chips = traitsOf(def)
        .map((tr) => `<span class="etrait ${tr.cls ?? ''}">${tr.icon} ${tr.label}</span>`)
        .join('');
      const armorStat = def.armor > 0 ? ` <span>🛡 ${def.armor}</span>` : '';
      return `<div class="enemy-card${def.boss ? ' boss' : ''}">
        <div class="ecard-head">
          <span class="eicon">${ENEMY_ICONS[type]}</span>
          <span class="ename">${def.name}</span>
        </div>
        <div class="etraits">${chips}</div>
        <p class="edesc">${DESC[type]}</p>
        <div class="estats"><span>❤️ ${def.hp}</span> <span>🦶 ${speedLabel(def.speed)}</span> <span>🪙 ${def.bounty}</span>${armorStat}</div>
      </div>`;
    })
    .join('');
}

export function openBestiary(): void {
  build();
  $('overlay-bestiary').hidden = false;
}

function closeBestiary(): void {
  $('overlay-bestiary').hidden = true;
}

// Cablea los botones que abren el bestiario (home + pausa) y el cierre.
export function initBestiary(): void {
  build();
  const overlay = $('overlay-bestiary');
  for (const id of ['btn-bestiary', 'btn-bestiary-pause']) {
    const b = document.getElementById(id);
    if (b)
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        openBestiary();
      });
  }
  $('bestiary-close').addEventListener('click', closeBestiary);
  // clic en el fondo (no en la tarjeta) cierra
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeBestiary();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeBestiary();
  });
}
