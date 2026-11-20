// CACERÍA · tablas de equilibrio.
//
// Los números siguen las curvas del mapa de referencia del género (Troll & Elves
// 3.9, modo «-single» a velocidad normal), medidas en su object data y su script:
//   · 1 casilla = 128 unidades de WC3. Muros y torres ocupan 1×1; casa, taller,
//     árbol y mina 2×2.
//   · Velocidades en casillas/s = unidades/128 (elfo 250 → 1.95, troll 350 → 2.73).
//   · Casi todo se DUPLICA por nivel (vida, daño, ingreso, coste) y cada mejora de
//   la casa se amortiza en 50 s.
//   · Armadura: reducción = 0.02·a / (1 + 0.02·a) (el mapa cambia el 0.06 de WC3);
//     negativa: ×(2 − 0.98^−a). Todos los tipos de ataque pegan 100 % a todo.
// Los nombres, el universo y el arte son de Fortaleza: aquí solo viven las reglas.

// Todo lo que se GANA (oro y madera, en los dos bandos) vale el triple que en el
// original: ingresos de la casa, minas, guarida y leñadores, oro por golpe,
// recompensas, robo del ángel y oro inicial del lobo. La velocidad del juego no
// cambia. No se multiplican el mercado de madera ni los reembolsos (serían un
// bucle para fabricar oro).
export const RESOURCE_MULT = 3;

export const T_PER_UNIT = 1 / 128;
export const toTiles = (units: number): number => units / 128;

// ---------- tiempos y ritmo de partida ----------
export const PHASE = {
  headStartSec: 30, // ventaja de los colonos: el cazador sale a los 30 s
  sprintSpeed: toTiles(522), // los colonos corren al máximo mientras dura la ventaja
  sharedVisionSec: 180, // hasta aquí cada colono solo ve lo suyo
  exposeSec: 420, // a quien siga sin casa se le ve desde el bando del cazador
  dayLengthSec: 480, // un día entero
  firstNightSec: 180, // se empieza a las 21:00: 3 min de noche y luego 4/4
} as const;

export function isNight(sec: number): boolean {
  if (sec < PHASE.firstNightSec) return true;
  const t = (sec - PHASE.firstNightSec) % PHASE.dayLengthSec;
  return t >= PHASE.dayLengthSec / 2;
}

// ---------- armadura ----------
export function armorMult(armor: number): number {
  if (armor >= 0) return 1 - (0.02 * armor) / (1 + 0.02 * armor);
  return 2 - Math.pow(0.98, -armor);
}

// ---------- tablas por minuto (robo del ángel, oro del lobo, recompensas) ----------
// Puntos medidos (minuto → valor). Entre puntos se interpola en escala logarítmica.
const A2E: [number, number][] = [
  [0, 1],
  [5, 16],
  [10, 75],
  [15, 209],
  [20, 576],
  [25, 1589],
  [30, 4378],
  [40, 33252],
  [50, 252511],
  // el original se para en 1 000 000 por el tope del motor; aquí sigue creciendo
];
const A6E: [number, number][] = [
  [0, 50],
  [5, 135],
  [10, 375],
  [15, 1045],
  [20, 2880],
  [25, 7945],
  [30, 21890],
  [40, 166260],
];
function logLerp(table: [number, number][], min: number): number {
  if (min <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [m1, v1] = table[i];
    const [m0, v0] = table[i - 1];
    if (min <= m1) return Math.round(v0 * Math.pow(v1 / v0, (min - m0) / (m1 - m0)));
  }
  // más allá del último punto medido: mismo ritmo de crecimiento (sin tope)
  const [m1, v1] = table[table.length - 1];
  const [m0, v0] = table[table.length - 2];
  return Math.round(v1 * Math.pow(v1 / v0, (min - m1) / (m1 - m0)));
}
export const goldUnit = (min: number): number => logLerp(A2E, min); // «unidad de oro» del minuto
export const roleBounty = (min: number): number => logLerp(A6E, min); // matar un ángel o un lobo
export const wolfStartGold = (min: number): number => Math.round(3.75 * Math.pow(goldUnit(min), 1.25)) * RESOURCE_MULT;

// ---------- personajes ----------
export type Form = 'hunter' | 'elf' | 'angel' | 'wolf';

export const HUNTER = {
  hp: 750,
  dmg: 5,
  attackSec: 1.5,
  armor: 3.9,
  speed: toTiles(350),
  visionDay: toTiles(1400),
  visionNight: toTiles(1100),
  // por nivel (STR +20, AGI +8, INT +1 con las constantes del mapa)
  hpPerLevel: 500,
  regenPerLevel: 1,
  dmgPerLevel: 8,
  asPerLevel: 0.32,
  armorPerLevel: 4,
  maxAttackSpeed: 4, // +400 %: el golpe más rápido es 1.5 / 5 = 0.3 s
  lifesteal: 0.2, // «Sed de sangre»: también contra edificios
  focusPerHit: 0.03, // «Concentración»: +3 % de cadencia por golpe…
  focusMax: 10, // …hasta 10 cargas…
  focusSec: 2.5, // …que caducan si deja de pegar
  focusBase: 0.05,
  maxSpeed: toTiles(522),
  // «Deceleración pasiva» (orbe de escarcha A0KS): sus golpes ralentizan 3 s. El
  // mapa no trae el porcentaje; se usa un 25 % (el orbe de escarcha de WC3)
  frostSec: 3,
  frostSlow: 0.25,
  // talentos que se aprenden juntos al nivel 1: Ojo EX (+1 a todo) y el hueco
  // de botas, que si está vacío da otro +1 a todo
  talentAttr: 1,
  emptyBootsAttr: 1,
} as const;

// XP acumulada para alcanzar cada nivel (curva de WC3: 200, 500, 900, 1400…)
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  let xp = 200;
  for (let l = 3; l <= level; l++) xp += 100 * l;
  return xp;
}
// XP que da matar algo (constantes del mapa: 25 por nivel de la víctima)
export const xpForKill = (victimLevel: number): number => 25 * Math.max(1, victimLevel) + 25;
export const XP_FOR_ELF = 100;

export const ELF = {
  hp: 10,
  armor: 0,
  speed: toTiles(250),
  visionDay: toTiles(1200),
  visionNight: toTiles(1400),
  startGold: 30,
  startWood: 8,
  baseFood: 40,
  foodCeiling: 100,
} as const;

// maná (máximo y recuperación por segundo) de cada forma; el troll suma INT por nivel
export const MANA: Record<'hunter' | 'wolf' | 'elf' | 'angel', { max: number; regen: number }> = {
  hunter: { max: 200, regen: 1 },
  wolf: { max: 200, regen: 1 },
  elf: { max: 200, regen: 2 },
  angel: { max: 100, regen: 1.5 },
};
export const MANA_PER_INT = { max: 15, regen: 0.05 };
export const HUT_MANA_REGEN = 0.06; // aura de la guarida: +6 % del maná máx por segundo

export const ANGEL = {
  hp: 32,
  speed: toTiles(280),
  vision: toTiles(1400),
  respawnSec: 10,
  invulnOnSpawnSec: 5,
} as const;

export const WOLF = {
  respawnSec: 20,
} as const;

// recompensa por matar a un colono: 67 % de su oro + 10 por cada madera
export const ELF_KILL_GOLD_FRAC = 0.67;
export const ELF_KILL_GOLD_PER_WOOD = 10;
// sin tope de oro ni de madera (en el WC3 original el motor paraba en 1 000 000)
export const GOLD_CAP = Number.MAX_SAFE_INTEGER;

// ---------- edificios ----------
export type BuildingType =
  | 'house' // la Casa: da oro por segundo
  | 'wall'
  | 'tower'
  | 'workshop' // Taller → Ayuntamiento I-III → Fortaleza (tecnología + reparadores)
  | 'elftree' // Árbol madre: leñadores
  | 'mine'
  | 'sight'; // Atalaya: revela invisibles

export const BUILDING_ORDER: BuildingType[] = ['house', 'wall', 'tower', 'workshop', 'elftree', 'mine', 'sight'];

export interface BuildingInfo {
  type: BuildingType;
  name: string;
  icon: string; // clave del atlas pixel (hk:*)
  emoji: string;
  size: 1 | 2;
  limit: number;
  desc: string;
  hotkey: string;
}

export const BUILDINGS: Record<BuildingType, BuildingInfo> = {
  house: {
    type: 'house',
    name: 'Casa',
    icon: 'hk:house',
    emoji: '🏡',
    size: 2,
    limit: 1,
    hotkey: '2',
    desc: 'Tu fuente de oro: 1 de oro por segundo, y cada mejora lo DUPLICA y se paga sola en 50 s. Solo una. Para subirla tienes que subir antes tus murallas. Si la destruyen recuperas todo lo invertido.',
  },
  wall: {
    type: 'wall',
    name: 'Muralla',
    icon: 'hk:wall',
    emoji: '🧱',
    size: 1,
    limit: 40,
    hotkey: '3',
    desc: 'Cierra las puertas de tu parcela. No ataca. Cada nivel le sube vida y armadura; al nivel 6 eliges una especialidad.',
  },
  tower: {
    type: 'tower',
    name: 'Torre',
    icon: 'hk:tower',
    emoji: '🏹',
    size: 1,
    limit: 30,
    hotkey: '4',
    desc: 'Cuesta 1 de madera y no dispara hasta que la mejoras. Después cada nivel duplica su daño. Puedes llevarla por la rama de oro: pega menos pero te paga por cada disparo.',
  },
  workshop: {
    type: 'workshop',
    name: 'Taller',
    icon: 'hk:workshop',
    emoji: '🔨',
    size: 2,
    limit: 2,
    hotkey: '5',
    desc: 'Contrata reparadores. Mejorado se convierte en Ayuntamiento I, II, III y Fortaleza: la tecnología que desbloquea torres, casa y murallas altas.',
  },
  elftree: {
    type: 'elftree',
    name: 'Árbol madre',
    icon: 'hk:elftree',
    emoji: '🌳',
    size: 2,
    limit: 2,
    hotkey: '6',
    desc: 'Cría leñadores: cada uno se posa en un árbol y te da madera sin parar. Requiere Ayuntamiento I.',
  },
  mine: {
    type: 'mine',
    name: 'Mina de oro',
    icon: 'hk:mine',
    emoji: '⛏️',
    size: 2,
    limit: 99,
    hotkey: '7',
    desc: 'Oro por segundo extra. Desde el nivel 3 se paga en madera (25 de madera por cada 1 de oro/s). Muy frágil. Requiere Ayuntamiento II.',
  },
  sight: {
    type: 'sight',
    name: 'Atalaya',
    icon: 'hk:sighttower',
    emoji: '🗼',
    size: 1,
    limit: 4,
    hotkey: '8',
    desc: 'Revela al cazador aunque vaya invisible. Requiere Fortaleza.',
  },
};

// Requisitos de tecnología: nivel del Taller (1 Taller · 2 Ayto I · 3 Ayto II ·
// 4 Ayto III · 5 Fortaleza), nivel de muralla más alto y nivel de casa.
export interface Req {
  tech?: number;
  wall?: number;
  house?: number;
}
export const TECH_NAMES = ['—', 'Taller', 'Ayuntamiento I', 'Ayuntamiento II', 'Ayuntamiento III', 'Fortaleza'];

export interface LevelDef {
  name: string;
  hp: number;
  armor: number;
  gold: number; // coste para llegar a este nivel (el 1 es el de construir)
  wood: number;
  req?: Req;
  // efectos (según el tipo)
  income?: number; // oro/s
  food?: number;
  regen?: number; // vida/s
  dmg?: number;
  cd?: number;
  range?: number; // casillas
  goldPerHit?: number; // torre de oro: oro por disparo · muralla de oro: oro por golpe recibido
  flatReduce?: number; // cemento: −N de daño por golpe recibido (mín. 1)
  thorns?: number; // coral: daño de vuelta al que pega cuerpo a cuerpo
  slowAura?: number; // hielo: −% de cadencia de quien la ataca
  repairBonus?: number; // ruinas: +% de reparación
  chain?: boolean; // torre: rayo (25 % de golpes con +25 % de daño)
  burn?: boolean; // torre: quema 512/s 3 s y −80 % de cadencia
  auraHaste?: number; // torre rúnica: +cadencia a las torres aliadas cercanas
  frost?: boolean; // torre: ralentiza el movimiento 5 s
  corrupt?: number; // torre: −armadura 5 s
  poisonDps?: number; // torre: veneno 3 s
  luck?: boolean; // muralla aleatoria: sortea armadura extra
  eatsTree?: number; // muralla de árbol: se come un árbol cercano y gana vida
  extraDamageTaken?: number; // heno: +N de daño por golpe recibido
  // remates de muralla (niveles 16-18, uno por rama)
  evasion?: number; // glaciar: probabilidad de esquivar el golpe
  dmgTakenMult?: number; // aleación: daño recibido ×N
  reflect?: number; // aleación: devuelve esta fracción del daño recibido
  burst?: { chance: number; dmg: number; r: number }; // cactus: al recibir daño, a veces estalla
  wealth?: number; // fortuna: cada N s, oro para todos los aliados (Abundancia)
}

// --- Casa ---
const HOUSE_NAMES = ['Campamento', 'Granja', 'Granja élfica', 'Granja alta', 'Taller pequeño', 'Taller mediano', 'Taller grande', 'Obrador', 'Gran obrador', 'Obrador supremo'];
const HOUSE_REQ: Req[] = [{}, { wall: 1 }, { wall: 4 }, { tech: 2 }, { wall: 6 }, { tech: 3 }, { wall: 9 }, { wall: 11 }, { wall: 12 }, { wall: 13 }];
const HOUSE_WOOD = [0, 0, 0, 0, 0, 30, 60, 128, 256, 512];
export const HOUSE_LEVELS: LevelDef[] = HOUSE_NAMES.map((name, i) => ({
  name,
  hp: 10 * 2 ** i,
  armor: 5,
  gold: i === 0 ? 0 : 50 * 2 ** (i - 1),
  wood: HOUSE_WOOD[i],
  req: HOUSE_REQ[i],
  income: 2 ** i,
  food: 4 * (i + 1),
}));

// --- Murallas: tronco de 5 niveles y 7 especialidades del 6 al 15 ---
export type WallBranch = 'rock' | 'elf' | 'ice' | 'cement' | 'coral' | 'gold' | 'ruin' | 'tree' | 'hay' | 'random';
export const WALL_BRANCH_ORDER: WallBranch[] = ['rock', 'elf', 'ice', 'cement', 'coral', 'gold', 'ruin', 'tree', 'hay', 'random'];

interface TopSpec {
  hp: number;
  armor: number;
  gold: number;
  wood: number;
  fx: Partial<LevelDef>;
}
interface BranchSpec {
  name: string;
  icon: string;
  pitch: string;
  hp6: number;
  gold6: number;
  armor6: number;
  armorStep: number;
  woodBase: number; // madera al nivel 11 (×2 después)
  maxLevel?: number;
  hidden?: boolean; // la de oro no se elige: solo puede salir de la aleatoria
  effect: (lvl: number) => Partial<LevelDef>;
  topName: string; // remate de los niveles 16-18
  top: [TopSpec, TopSpec, TopSpec];
}
// remates (u027.., u02K.., u02X.., u03A.., u01U.., u072.., u07F.., u07S.., u086..)
const TOP = (hp: [number, number, number], armor: [number, number, number], gold: [number, number, number], wood: [number, number, number], fx: [Partial<LevelDef>, Partial<LevelDef>, Partial<LevelDef>]): [TopSpec, TopSpec, TopSpec] =>
  [0, 1, 2].map((i) => ({ hp: hp[i], armor: armor[i], gold: gold[i], wood: wood[i], fx: fx[i] })) as [TopSpec, TopSpec, TopSpec];
const k = (lvl: number) => lvl - 6; // 0 en el primer nivel de la rama
export const WALL_BRANCHES: Record<WallBranch, BranchSpec> = {
  rock: {
    name: 'Roca',
    icon: 'hk:wall-rock',
    pitch: 'La más barata y la que más vida acumula por oro. Sin trucos.',
    hp6: 300,
    gold6: 120,
    armor6: 2,
    armorStep: 0.8,
    woodBase: 30,
    effect: () => ({}),
    topName: 'Torre de piedra',
    top: TOP([327680, 655360, 880000], [10, 26, 107], [122880, 153600, 880000], [960, 12000, 880000], [{ flatReduce: 128 }, { flatReduce: 1440 }, { flatReduce: 16000 }]),
  },
  elf: {
    name: 'Élfica',
    icon: 'hk:wall-elf',
    pitch: 'Se regenera sola (2 de vida/s y se duplica cada nivel). El Guardián lunar dura un 20 % más sobre ella.',
    hp6: 320,
    gold6: 128,
    armor6: 3,
    armorStep: 1,
    woodBase: 32,
    effect: (l) => ({ regen: 2 * 2 ** k(l) }),
    topName: 'Cristal',
    top: TOP([327680, 655360, 920000], [13, 30, 114], [131072, 163840, 920000], [1024, 12800, 920000], [{ regen: 2048 }, { regen: 4096 }, { regen: 5120 }]),
  },
  ice: {
    name: 'Hielo',
    icon: 'hk:wall-ice',
    pitch: 'Congela a quien la golpea: le resta velocidad de ataque (−12 % y llega a −140 %; nunca baja de −80 % en total). Un troll con guantes lo compensa. Su remate, el Glaciar, esquiva golpes.',
    hp6: 340,
    gold6: 136,
    armor6: 4,
    armorStep: 1.2,
    woodBase: 34,
    // −12/18/24/30/40 % y −60/80/100/120/140 % de cadencia (el WC3 topa en −80 %)
    effect: (l) => ({ slowAura: [0.12, 0.18, 0.24, 0.3, 0.4, 0.6, 0.8, 1, 1.2, 1.4][k(l)] }),
    topName: 'Glaciar',
    top: TOP([327680, 655360, 960000], [16, 34, 121], [139264, 174080, 960000], [1088, 13600, 960000], [{ evasion: 0.02 }, { evasion: 0.04 }, { evasion: 0.06 }]),
  },
  cement: {
    name: 'Cemento',
    icon: 'hk:wall-cement',
    pitch: 'Le resta daño fijo a cada golpe (−1 por nivel, y el doble a partir del 11). Frena mucho a un cazador débil.',
    hp6: 360,
    gold6: 144,
    armor6: 5,
    armorStep: 1.4,
    woodBase: 36,
    effect: (l) => ({ flatReduce: l <= 10 ? l - 5 : 5 * 2 ** (l - 10) }),
    topName: 'Aleación',
    top: TOP([327680, 655360, 1000000], [19, 38, 128], [147456, 184320, 1000000], [1152, 14400, 1000000], [
      { dmgTakenMult: 0.99, reflect: 0.01 },
      { dmgTakenMult: 0.97, reflect: 0.03 },
      { dmgTakenMult: 0.94, reflect: 0.06 },
    ]),
  },
  coral: {
    name: 'Coral',
    icon: 'hk:wall-coral',
    pitch: 'Espinas: devuelve daño a quien la golpea cuerpo a cuerpo (8 por golpe y sube cada nivel).',
    hp6: 360,
    gold6: 144,
    armor6: 3,
    armorStep: 1,
    woodBase: 36,
    effect: (l) => ({ thorns: l <= 10 ? 8 * (k(l) + 1) : 40 * 2 ** (l - 10) }),
    topName: 'Cactus',
    top: TOP([327680, 655360, 1000000], [13, 30, 114], [147456, 184320, 1000000], [1152, 14400, 1000000], [
      { burst: { chance: 0.2, dmg: 12500, r: toTiles(300) } },
      { burst: { chance: 0.2, dmg: 25000, r: toTiles(300) } },
      { burst: { chance: 0.2, dmg: 75000, r: toTiles(300) } },
    ]),
  },
  gold: {
    name: 'Oro',
    icon: 'hk:wall-gold',
    pitch: 'Cada golpe que recibe TE da oro (2 por golpe y sube cada nivel). Solo sale de la muralla aleatoria.',
    hp6: 340,
    gold6: 136,
    armor6: 3,
    armorStep: 1,
    woodBase: 34,
    hidden: true,
    effect: (l) => ({ goldPerHit: l <= 10 ? [2, 4, 6, 8, 12][k(l)] : 16 * 2 ** (l - 11) }),
    topName: 'Fortuna',
    // Abundancia (A0M1): 200 de maná de 1000 con +0.5/1/1.5 por s → cada 400/200/133 s
    top: TOP([327680, 655360, 960000], [13, 30, 114], [139264, 174080, 960000], [1088, 13600, 960000], [
      { goldPerHit: 512, wealth: 400 },
      { goldPerHit: 1280, wealth: 200 },
      { goldPerHit: 3200, wealth: 133 },
    ]),
  },
  ruin: {
    name: 'Ruinas',
    icon: 'hk:wall-ruin',
    pitch: 'Tus reparadores la arreglan un 25 % más rápido.',
    hp6: 320,
    gold6: 128,
    armor6: 3,
    armorStep: 1,
    woodBase: 32,
    effect: () => ({ repairBonus: 0.25 }),
    topName: 'Búnker',
    top: TOP([327680, 655360, 920000], [13, 30, 114], [131072, 163840, 920000], [1024, 12800, 920000], [{ repairBonus: 0.25 }, { repairBonus: 0.25 }, { repairBonus: 0.25 }]),
  },
  tree: {
    name: 'Árbol de guerra',
    icon: 'hk:wall-tree',
    pitch: 'Se come un árbol cercano y gana vida durante 30 s, y además golpea al cazador que se le pega. Su remate, el Árbol del viento, dispara de lejos.',
    hp6: 320,
    gold6: 128,
    armor6: 3,
    armorStep: 1,
    woodBase: 32,
    // también ataca cuerpo a cuerpo: 20..100 (cada 2.5 s) y 200..3200 (cada 2 s)
    effect: (l) => ({ eatsTree: 200 * 2 ** k(l), dmg: l <= 10 ? 20 * (k(l) + 1) : 200 * 2 ** (l - 11), cd: l <= 10 ? 2.5 : 2, range: toTiles(100) + 0.6 }),
    topName: 'Árbol del viento',
    top: TOP([327680, 655360, 920000], [13, 30, 114], [131072, 163840, 920000], [1024, 12800, 920000], [
      { eatsTree: 204800, dmg: 32000, cd: 1.5, range: toTiles(600) },
      { eatsTree: 409600, dmg: 320000, cd: 1.5, range: toTiles(600) },
      { eatsTree: 640000, dmg: 3200000, cd: 1.5, range: toTiles(600) },
    ]),
  },
  hay: {
    name: 'Heno',
    icon: 'hk:wall-hay',
    pitch: 'La más barata, pero recibe daño EXTRA en cada golpe (+2 por nivel). Para salir del paso.',
    hp6: 280,
    gold6: 112,
    armor6: 1,
    armorStep: 0.6,
    woodBase: 28,
    effect: (l) => ({ extraDamageTaken: l <= 10 ? 2 * (k(l) + 1) : 10 * 2 ** (l - 10) }),
    topName: 'Arcilla',
    top: TOP([286720, 573440, 840000], [7, 22, 100], [114688, 143360, 840000], [896, 11200, 840000], [{ extraDamageTaken: 640 }, { extraDamageTaken: 1280 }, { extraDamageTaken: 12800 }]),
  },
  random: {
    name: 'Aleatoria',
    icon: 'hk:wall-random',
    pitch: 'Se convierte al instante en una muralla de nivel 6 de una rama al azar (puede salir la de oro, que no se elige de otra forma). A los 3 minutos puedes sortear una vez su armadura: de −3 a +3.',
    hp6: 320,
    gold6: 128,
    armor6: 3,
    armorStep: 1,
    woodBase: 32,
    maxLevel: 6,
    effect: () => ({ luck: true }),
    topName: 'Aleatoria',
    top: TOP([0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [{}, {}, {}]),
  },
};

export const WALL_MAX_LEVEL = 18;
export const WALL_RANDOM_POOL: WallBranch[] = ['elf', 'rock', 'tree', 'ice', 'cement', 'coral', 'ruin', 'gold', 'hay'];
export const WALL_LUCK_SEC = 180; // sorteo único de armadura de la aleatoria
export const WALL_LUCK_VALUES = [3, 2, 1, 0, -1, -2, -3];
const WALL_TRUNK: LevelDef[] = [
  { name: 'Muralla de piedra', hp: 50, armor: 5, gold: 4, wood: 0 },
  { name: 'Muralla de piedra II', hp: 80, armor: 5, gold: 8, wood: 0 },
  { name: 'Muralla de piedra III', hp: 140, armor: 5, gold: 16, wood: 0 },
  { name: 'Muralla de piedra IV', hp: 200, armor: 5, gold: 32, wood: 0 },
  { name: 'Muralla de piedra V', hp: 250, armor: 5, gold: 64, wood: 0 },
];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
// Niveles 16-18: «muralla torre». Mucha vida y armadura y, sobre todo, restan
// una cantidad FIJA a cada golpe (128 / 1440 / 16 000): el último techo del colono.

export function wallMaxLevel(branch: WallBranch | null): number {
  return branch ? (WALL_BRANCHES[branch].maxLevel ?? WALL_MAX_LEVEL) : WALL_MAX_LEVEL;
}
export function huntWallLevel(level: number, branch: WallBranch | null): LevelDef {
  if (level <= 5 || !branch) return WALL_TRUNK[Math.min(5, level) - 1];
  const b = WALL_BRANCHES[branch];
  if (level >= 16) {
    // remate propio de cada rama (datos del original); pide la Fortaleza (Cenarion Keep)
    const top = b.top[level - 16];
    const base = b.effect(15);
    // el Glaciar pierde el aura; la Aleación se queda con su −160 fijo; el Cactus pierde las espinas
    if (branch === 'ice') delete base.slowAura;
    if (branch === 'coral') delete base.thorns;
    if (branch === 'gold') delete base.goldPerHit;
    if (branch === 'hay') delete base.extraDamageTaken;
    if (branch === 'tree') {
      delete base.dmg;
      delete base.cd;
      delete base.range;
    }
    return {
      ...base,
      ...top.fx,
      name: `${b.topName} ${level === 18 ? 'MÁX' : ROMAN[level - 16]}`,
      hp: top.hp,
      armor: top.armor,
      gold: top.gold,
      wood: top.wood,
      req: { tech: 5 },
    };
  }
  const i = level - 6;
  return {
    name: `Muralla de ${b.name.toLowerCase()} ${ROMAN[i]}`,
    hp: b.hp6 * 2 ** i,
    armor: Math.round((b.armor6 + b.armorStep * i) * 10) / 10,
    gold: b.gold6 * 2 ** i,
    wood: level >= 11 ? b.woodBase * 2 ** (level - 11) : 0,
    ...b.effect(level),
  };
}

// --- Torres: línea principal y rama de oro ---
export type TowerBranch = 'main' | 'gold';
const TOWER_MAIN: LevelDef[] = [
  { name: 'Poste de vigía', hp: 10, armor: 1, gold: 0, wood: 1 },
  { name: 'Torre de madera', hp: 15, armor: 2, gold: 16, wood: 0, dmg: 2, cd: 0.7, range: toTiles(600) },
  { name: 'Torre de piedra', hp: 30, armor: 3, gold: 32, wood: 0, dmg: 4, cd: 0.9, range: toTiles(625), req: { tech: 2 } },
  { name: 'Torreón', hp: 50, armor: 4, gold: 64, wood: 0, dmg: 8, cd: 0.9, range: toTiles(650), req: { tech: 2 } },
  { name: 'Torre de energía', hp: 80, armor: 4, gold: 128, wood: 0, dmg: 16, cd: 0.9, range: toTiles(675), req: { tech: 3 } },
  { name: 'Torre de cristal rojo', hp: 140, armor: 4, gold: 256, wood: 0, dmg: 32, cd: 0.9, range: toTiles(700), req: { tech: 3 } },
  { name: 'Cristal fortificado', hp: 200, armor: 4, gold: 512, wood: 16, dmg: 64, cd: 0.8, range: toTiles(725), req: { tech: 4 }, chain: true },
  { name: 'Cristal oscuro', hp: 250, armor: 4, gold: 1024, wood: 32, dmg: 128, cd: 0.8, range: toTiles(750), req: { tech: 4 }, chain: true },
  { name: 'Torre infernal', hp: 500, armor: 8, gold: 2048, wood: 64, dmg: 256, cd: 0.6, range: toTiles(775), req: { house: 8 } },
  { name: 'Torre rúnica', hp: 1000, armor: 4, gold: 4096, wood: 128, dmg: 800, cd: 0.5, range: toTiles(800), req: { tech: 5 }, auraHaste: 0.1 },
  { name: 'Torre del dragón', hp: 1000, armor: 4, gold: 8192, wood: 256, dmg: 1728, cd: 0.5, range: toTiles(850), req: { tech: 5 }, burn: true },
  { name: 'Dragón negro', hp: 5120, armor: 4, gold: 32768, wood: 1024, dmg: 5120, cd: 0.5, range: toTiles(900), req: { tech: 5 } },
  { name: 'Dragón de hielo', hp: 32000, armor: 8, gold: 0, wood: 10240, dmg: 40960, cd: 0.5, range: toTiles(950), req: { tech: 5 }, frost: true },
  { name: 'Altar maldito', hp: 64000, armor: 16, gold: 0, wood: 25600, dmg: 81920, cd: 0.5, range: toTiles(1000), req: { tech: 5 }, corrupt: 512 },
  { name: 'Dragón verde', hp: 128000, armor: 32, gold: 0, wood: 160000, dmg: 512000, cd: 0.5, range: toTiles(1100), req: { tech: 5 }, poisonDps: 512 },
  { name: 'Torre del misterio', hp: 250000, armor: 32, gold: 1_000_000, wood: 1_000_000, dmg: 3_200_000, cd: 0.35, range: toTiles(1200), req: { tech: 5 } },
];
// 66 torres del misterio se funden en un Mago élfico
export const MAGE_FUSION_TOWERS = 66;
export const MAGE = { hp: 5_120_000, armor: 160, dmg: 5_120_000, cd: 0.5, range: toTiles(800), speed: toTiles(500), regen: 512 };
const TOWER_GOLD: LevelDef[] = [
  { name: 'Torre de oro', hp: 30, armor: 3, gold: 32, wood: 0, dmg: 1, cd: 0.9, range: toTiles(625), goldPerHit: 1, req: { tech: 2 } },
  { name: 'Torreón de oro', hp: 50, armor: 4, gold: 64, wood: 0, dmg: 4, cd: 0.9, range: toTiles(650), goldPerHit: 1, req: { tech: 2 } },
  { name: 'Torre de energía dorada', hp: 80, armor: 4, gold: 128, wood: 0, dmg: 8, cd: 0.9, range: toTiles(675), goldPerHit: 2, req: { tech: 3 } },
  { name: 'Cristal rojo dorado', hp: 140, armor: 4, gold: 256, wood: 0, dmg: 16, cd: 0.9, range: toTiles(700), goldPerHit: 4, req: { tech: 3 } },
  { name: 'Cristal fortificado dorado', hp: 200, armor: 4, gold: 512, wood: 16, dmg: 32, cd: 0.8, range: toTiles(725), goldPerHit: 8, req: { tech: 4 }, chain: true },
  { name: 'Cristal oscuro dorado', hp: 250, armor: 4, gold: 1024, wood: 32, dmg: 64, cd: 0.8, range: toTiles(750), goldPerHit: 16, req: { tech: 4 }, chain: true },
];
export const TOWER_MAX_LEVEL = TOWER_MAIN.length;
// Bifurcaciones del original: la Torre del dragón (11) puede saltarse el Dragón
// negro e ir al de hielo (13); el Altar maldito (14) acaba en Dragón verde (15)
// O en Torre del misterio (16), y el Dragón verde ya no sube más.
export const TOWER_FORKS: Record<number, { branch: string; level: number; name: string }[]> = {
  11: [
    { branch: 'black', level: 12, name: 'Dragón negro' },
    { branch: 'ice', level: 13, name: 'Dragón de hielo' },
  ],
  14: [
    { branch: 'green', level: 15, name: 'Dragón verde' },
    { branch: 'mystery', level: 16, name: 'Torre del misterio' },
  ],
};
export const TOWER_GREEN_FINAL = 15;
// la rama de oro ocupa los niveles 3-8 y al 9 vuelve a la línea principal
export function huntTowerLevel(level: number, branch: TowerBranch): LevelDef {
  if (branch === 'gold' && level >= 3 && level <= 8) return TOWER_GOLD[level - 3];
  return TOWER_MAIN[Math.min(level, TOWER_MAIN.length) - 1];
}

// --- Taller → Ayuntamientos → Fortaleza (el nivel ES la tecnología) ---
export const WORKSHOP_LEVELS: LevelDef[] = [
  { name: 'Taller', hp: 25, armor: 5, gold: 32, wood: 0 },
  { name: 'Ayuntamiento I', hp: 50, armor: 5, gold: 64, wood: 0 },
  { name: 'Ayuntamiento II', hp: 100, armor: 5, gold: 256, wood: 0 },
  { name: 'Ayuntamiento III', hp: 200, armor: 5, gold: 1024, wood: 0 },
  { name: 'Fortaleza', hp: 400, armor: 5, gold: 0, wood: 512 },
];
export const ELFTREE_LEVELS: LevelDef[] = [{ name: 'Árbol madre', hp: 100, armor: 5, gold: 256, wood: 0, req: { tech: 2 } }];
export const SIGHT_LEVELS: LevelDef[] = [{ name: 'Atalaya', hp: 10, armor: 5, gold: 0, wood: 256, req: { tech: 5 }, range: toTiles(900) }];

// --- Minas: ingreso ×4 por coste ×4; desde la tercera, en madera ---
export const MINE_LEVELS: LevelDef[] = [
  { name: 'Mina embrujada', hp: 50, armor: -17, gold: 90, wood: 0, income: 1, req: { tech: 3 } },
  { name: 'Mina abandonada', hp: 50, armor: -17, gold: 0, wood: 24, income: 2 },
  { name: 'Mina vieja', hp: 50, armor: -17, gold: 0, wood: 200, income: 8 },
  { name: 'Mina activa', hp: 50, armor: -17, gold: 0, wood: 800, income: 32 },
  { name: 'Mina rica', hp: 50, armor: -17, gold: 0, wood: 3200, income: 128 },
  { name: 'Mina profunda', hp: 50, armor: -17, gold: 0, wood: 12800, income: 512 },
  { name: 'Veta madre', hp: 50, armor: -17, gold: 0, wood: 51200, income: 2048 },
  { name: 'Veta de los reyes', hp: 50, armor: -17, gold: 0, wood: 200000, income: 8888 },
  { name: 'Corazón de la montaña', hp: 50, armor: -17, gold: 0, wood: 1000000, income: 38400 },
];

export function levelsOf(type: BuildingType): number {
  switch (type) {
    case 'house':
      return HOUSE_LEVELS.length;
    case 'wall':
      return WALL_MAX_LEVEL; // la aleatoria se corta en el 6 (ver wallMaxLevel)
    case 'tower':
      return TOWER_MAX_LEVEL;
    case 'workshop':
      return WORKSHOP_LEVELS.length;
    case 'elftree':
      return 1;
    case 'mine':
      return MINE_LEVELS.length;
    case 'sight':
      return 1;
  }
}

export function levelDef(type: BuildingType, level: number, wallBranch: WallBranch | null, towerBranch: TowerBranch): LevelDef {
  switch (type) {
    case 'house':
      return HOUSE_LEVELS[level - 1];
    case 'wall':
      return huntWallLevel(level, wallBranch);
    case 'tower':
      return huntTowerLevel(level, towerBranch);
    case 'workshop':
      return WORKSHOP_LEVELS[level - 1];
    case 'elftree':
      return ELFTREE_LEVELS[0];
    case 'mine':
      return MINE_LEVELS[level - 1];
    case 'sight':
      return SIGHT_LEVELS[0];
  }
}

// ---------- unidades entrenables ----------
export interface WorkerTier {
  name: string;
  gold: number;
  hp: number;
  food: number;
  wood?: number;
  ratio?: number; // reparador: tarda 50 s × ratio en reparar un edificio entero
  woodPerSec?: number; // leñador
  req?: Req;
}
export const REPAIR_BASE_SEC = 50;
export const REPAIRERS: WorkerTier[] = [
  // e000..e004: sin requisito de tecnología; comida 8/10/12/14/16
  { name: 'Aprendiz', gold: 32, hp: 20, food: 8, ratio: 4 },
  { name: 'Reparador', gold: 128, hp: 40, food: 10, ratio: 2.5 },
  { name: 'Autómata de cuerda', gold: 512, hp: 80, food: 12, ratio: 1.5 },
  { name: 'Autómata de acero', gold: 2048, hp: 160, food: 14, ratio: 1 },
  { name: 'Maestro de obras', gold: 8192, hp: 320, food: 16, ratio: 0.5 },
  // e005 Paladin: 32 768 de oro + 256 de madera; repara, Luz sagrada, Armadura
  // sagrada y aura de +3 de armadura (A02W..A02Z)
  { name: 'Paladín', gold: 32768, wood: 256, hp: 800, food: 32, ratio: 0.2, req: { tech: 5 } },
];
export const LUMBERJACKS: WorkerTier[] = [
  // e006..e00D: sin requisito de tecnología; los cinco primeros comen 1
  { name: 'Leñador torpe', gold: 520, hp: 20, food: 1, woodPerSec: 0.2 },
  { name: 'Leñador perezoso', gold: 1200, hp: 40, food: 1, woodPerSec: 0.5 },
  { name: 'Leñador', gold: 2000, hp: 80, food: 1, woodPerSec: 1 },
  { name: 'Leñador hábil', gold: 3600, hp: 160, food: 1, woodPerSec: 2 },
  { name: 'Leñador listo', gold: 18000, hp: 320, food: 1, woodPerSec: 10 },
  { name: 'Leñador incansable', gold: 80000, hp: 640, food: 0, woodPerSec: 55 },
  { name: 'Leñador loco', gold: 255000, hp: 1280, food: 0, woodPerSec: 255 },
  { name: 'Espíritu del bosque', gold: 1_000_000, hp: 2560, food: 0, woodPerSec: 2200 },
  // e00E Bright elf: 1 M de oro + 1 M de madera, 10 000 de madera/s (A038)
  { name: 'Elfo brillante', gold: 1_000_000, wood: 1_000_000, hp: 5120, food: 0, woodPerSec: 10000 },
];
export const MAX_LUMBERJACKS = 12;
export const WORKER_SPEED = toTiles(270);

// ---------- mercado de madera (compartido por toda la partida) ----------
export const MARKET = { start: 150, step: 5, min: 5, max: 490, lot: 10 } as const;

// ---------- habilidades ----------
export type Ability =
  // colono
  | 'blink'
  | 'haste'
  | 'roots'
  | 'silence'
  | 'moonguard'
  | 'holylight'
  // cazador
  | 'windwalk'
  | 'eye'
  | 'berserk'
  | 'trap'
  | 'recall'
  | 'ams'
  // especialidades del colono (libro)
  | 'moonlight'
  | 'fullforce'
  | 'blind'
  | 'pack'
  | 'retrofit'
  | 'blinkback'
  // ángel
  | 'steal'
  | 'stun'
  | 'holyarmor'
  | 'angelblink'
  | 'angelhaste'
  | 'occult'
  // lobo
  | 'run'
  | 'howl'
  | 'detect'
  | 'bloodlust'
  | 'wolfams';

export interface AbilityDef {
  id: Ability;
  name: string;
  icon: string;
  emoji: string;
  key: string;
  mana?: number; // coste de maná (datos del original)
  cd: number;
  target: 'none' | 'point' | 'building' | 'self';
  range?: number; // casillas
  radius?: number;
  dur?: number;
  desc: string;
}

export const ABILITIES: Record<Ability, AbilityDef> = {
  blink: { id: 'blink', name: 'Salto', icon: 'hk:blink', emoji: '✨', key: 'F', mana: 20, cd: 25, target: 'point', range: toTiles(1500), desc: 'Te teletransportas hasta 11 casillas, también por encima de muros.' },
  haste: { id: 'haste', name: 'Prisa mágica', icon: 'hk:haste', emoji: '💨', key: 'X', mana: 20, cd: 30, target: 'self', dur: 15, desc: '+110 % de velocidad durante 15 s.' },
  roots: { id: 'roots', name: 'Raíces', icon: 'hk:roots', emoji: '🌿', key: 'E', mana: 40, cd: 45, target: 'point', range: toTiles(400), radius: toTiles(300), dur: 3, desc: 'Las raíces atrapan al cazador 3 s: no puede moverse ni atacar.' },
  silence: { id: 'silence', name: 'Silencio', icon: 'hk:silence', emoji: '🤫', key: 'C', mana: 40, cd: 60, target: 'point', range: toTiles(600), radius: toTiles(300), dur: 5, desc: 'El cazador no puede usar habilidades 5 s (corta su regreso).' },
  moonguard: { id: 'moonguard', name: 'Guardián lunar', icon: 'hk:moonguard', emoji: '🌙', key: 'Q', mana: 10, cd: 180, target: 'building', range: toTiles(400), dur: 3, desc: 'Un edificio tuyo se vuelve invulnerable: 10 s tu muralla más alta, 6 s lo demás (+20 % en muralla élfica).' },
  holylight: { id: 'holylight', name: 'Luz sagrada', icon: 'hk:spec-holylight', emoji: '✝️', key: 'V', cd: 150, target: 'building', range: toTiles(800), desc: 'Cura a un edificio aliado 10 de vida más el 35 % de la que le falta. Puede salvar una muralla.' },
  moonlight: { id: 'moonlight', name: 'Luz de luna', icon: 'hk:moonlight', emoji: '🌕', key: 'V', cd: 120, target: 'self', dur: 30, desc: 'Hace de noche 30 s: el cazador ve menos y los colonos más.' },
  fullforce: { id: 'fullforce', name: 'Plena fuerza', icon: 'hk:fullforce', emoji: '💪', key: 'V', cd: 180, target: 'point', range: toTiles(700), radius: toTiles(300), dur: 5, desc: 'Durante 5 s, todo lo aliado en la zona ataca y corre el doble, y las minas producen el doble.' },
  blind: { id: 'blind', name: 'Cegar', icon: 'hk:blind', emoji: '🙈', key: 'V', cd: 180, target: 'point', range: toTiles(400), radius: toTiles(300), dur: 4, desc: 'Los enemigos de la zona fallan todos sus golpes durante 4 s.' },
  pack: { id: 'pack', name: 'Empaquetar', icon: 'hk:pack', emoji: '🎒', key: 'V', cd: 300, target: 'self', dur: 40, desc: 'Tu casa desaparece 40 s: sigue dando oro, no se puede atacar y no cuenta como «sin casa».' },
  retrofit: { id: 'retrofit', name: 'Remodelar', icon: 'hk:retrofit', emoji: '🛠️', key: 'V', cd: 180, target: 'building', range: toTiles(700), desc: 'Una torre gana +20 % de alcance y +5 % de cadencia (hasta 5 veces; se conserva al mejorarla).' },
  blinkback: { id: 'blinkback', name: 'Volver', icon: 'hk:blinkback', emoji: '↩️', key: 'G', cd: 180, target: 'self', dur: 10, desc: 'Hasta 10 s después de un Salto, vuelves al punto de partida y se recargan Salto y Prisa.' },
  ams: { id: 'ams', name: 'Escudo antimagia', icon: 'hk:ams', emoji: '🔰', key: 'F', mana: 10, cd: 120, target: 'self', dur: 10, desc: 'Inmune a la magia de los colonos 10 s (raíces, silencio, ceguera, aturdir).' },
  angelhaste: { id: 'angelhaste', name: 'Prisa', icon: 'hk:haste', emoji: '💨', key: 'X', mana: 10, cd: 30, target: 'self', dur: 15, desc: '+100 % de velocidad 15 s.' },
  occult: { id: 'occult', name: 'Velo lunar', icon: 'hk:occult', emoji: '🌫️', key: 'T', mana: 10, cd: 45, target: 'point', range: toTiles(600), radius: 1.2, dur: 15, desc: 'Un colono aliado se vuelve invisible para el cazador 15 s (se descubre si construye).' },
  detect: { id: 'detect', name: 'Olfato', icon: 'hk:detect', emoji: '👃', key: 'C', mana: 10, cd: 45, target: 'point', range: 9999, radius: toTiles(1600), dur: 8, desc: 'Revela una zona del mapa 8 s.' },
  bloodlust: { id: 'bloodlust', name: 'Sed de sangre', icon: 'hk:bloodlust', emoji: '🩸', key: 'Q', mana: 40, cd: 60, target: 'self', dur: 15, desc: 'Tú y los tuyos cercanos: +50 % de cadencia y +30 % de velocidad 15 s.' },
  wolfams: { id: 'wolfams', name: 'Escudo antimagia', icon: 'hk:ams', emoji: '🔰', key: 'F', mana: 40, cd: 120, target: 'self', dur: 10, desc: 'Tú y el cazador, si está cerca, inmunes a la magia 10 s.' },
  windwalk: { id: 'windwalk', name: 'Paso del viento', icon: 'hk:windwalk', emoji: '👻', key: 'Z', mana: 10, cd: 30, target: 'self', dur: 20, desc: 'Invisible 20 s y +50 % de velocidad. Atacar te descubre.' },
  eye: { id: 'eye', name: 'Ojo del cazador', icon: 'hk:eye', emoji: '👁', key: 'C', mana: 60, cd: 30, target: 'point', range: 9999, radius: toTiles(1800), dur: 10, desc: 'Ves una zona grande en cualquier punto del mapa 10 s. Lo que ve no se puede derribar.' },
  berserk: { id: 'berserk', name: 'Furia', icon: 'hk:berserk', emoji: '😡', key: 'B', mana: 5, cd: 120, target: 'self', dur: 10, desc: '10 s: +100 % de cadencia y +50 % de velocidad, pero recibes un 50 % más de daño.' },
  trap: { id: 'trap', name: 'Trampa', icon: 'hk:trap', emoji: '🪤', key: 'E', mana: 40, cd: 120, target: 'point', range: toTiles(550), radius: toTiles(500), dur: 4, desc: 'Trampa invisible: cuando se acerca un colono, aturde 4 s a sus unidades y edificios cercanos. Dura 5 min.' },
  recall: { id: 'recall', name: 'Regreso', icon: 'hk:recall', emoji: '🏚', key: 'T', mana: 10, cd: 45, target: 'self', dur: 2, desc: 'Tras 2 s quieto vuelves a tu guarida, donde te curas y compras.' },
  steal: { id: 'steal', name: 'Robo', icon: 'hk:steal', emoji: '💰', key: 'Q', mana: 10, cd: 0.75, target: 'none', range: 1.6, desc: 'Junto a la guarida del cazador, le robas oro (sube con los minutos de partida).' },
  stun: { id: 'stun', name: 'Prisión de hielo', icon: 'hk:stun', emoji: '🧊', key: 'Z', mana: 40, cd: 70, target: 'point', range: toTiles(500), radius: toTiles(300), dur: 2, desc: 'Encierra en hielo al cazador o a un lobo 2 s: ni se mueve, ni ataca, ni lanza nada.' },
  holyarmor: { id: 'holyarmor', name: 'Armadura sagrada', icon: 'hk:holyarmor', emoji: '😇', key: 'E', mana: 0, cd: 60, target: 'self', dur: 6, desc: 'Invulnerable 6 s.' },
  angelblink: { id: 'angelblink', name: 'Vuelo', icon: 'hk:blink', emoji: '🕊', key: 'F', mana: 10, cd: 45, target: 'point', range: 9999, desc: 'Vuelas a cualquier punto del mapa.' },
  run: { id: 'run', name: 'Carrera', icon: 'hk:run', emoji: '🐺', key: 'Z', mana: 5, cd: 60, target: 'self', dur: 15, desc: '+100 % de velocidad 15 s.' },
  howl: { id: 'howl', name: 'Aullido', icon: 'hk:howl', emoji: '🌕', key: 'E', mana: 40, cd: 90, target: 'self', radius: toTiles(500), dur: 20, desc: 'Aterra a las torres cercanas: hacen un 25 % menos de daño 20 s.' },
};

export const FORM_ABILITIES: Record<Form, Ability[]> = {
  elf: ['blink', 'haste', 'roots', 'silence', 'moonguard'],
  hunter: ['windwalk', 'eye', 'berserk', 'trap', 'ams', 'recall'],
  angel: ['steal', 'stun', 'holyarmor', 'angelblink', 'angelhaste', 'occult'],
  wolf: ['run', 'howl', 'detect', 'bloodlust', 'wolfams', 'recall'],
};

// ---------- especialidades del colono (libro: se elige UNA) ----------
export type Spec =
  | 'moonlight'
  | 'holylight'
  | 'fullforce'
  | 'skin'
  | 'blind'
  | 'pack'
  | 'retrofit'
  | 'durability'
  | 'blinkex'
  | 'hasteex'
  | 'repairex';
export const SPEC_ORDER: Spec[] = ['moonlight', 'holylight', 'fullforce', 'skin', 'blind', 'pack', 'retrofit', 'durability', 'blinkex', 'hasteex', 'repairex'];
// la habilidad que da cada especialidad (las pasivas no dan ninguna)
export const SPEC_ABILITY: Partial<Record<Spec, Ability>> = {
  moonlight: 'moonlight',
  holylight: 'holylight',
  fullforce: 'fullforce',
  blind: 'blind',
  pack: 'pack',
  retrofit: 'retrofit',
  blinkex: 'blinkback',
};
export const SPECS: Record<Spec, { name: string; icon: string; desc: string; stars: number }> = {
  moonlight: { name: 'Luz de luna', icon: 'hk:moonlight', stars: 3, desc: 'Habilidad: hace de noche 30 s (el cazador ve menos, los colonos más). Recarga 2 min.' },
  holylight: { name: 'Luz sagrada', icon: 'hk:spec-holylight', stars: 3, desc: 'Habilidad: cura a un edificio 10 + el 35 % de la vida que le falta. Recarga 150 s.' },
  fullforce: { name: 'Plena fuerza', icon: 'hk:fullforce', stars: 2, desc: 'Habilidad: 5 s de cadencia y velocidad dobles en una zona, y minas al doble. Recarga 3 min.' },
  skin: { name: 'Piel endurecida', icon: 'hk:spec-skin', stars: 2, desc: 'Pasiva: el primer golpe mortal no te mata: quedas invulnerable 2 s. Una sola vez.' },
  blind: { name: 'Cegar', icon: 'hk:blind', stars: 2, desc: 'Habilidad: los enemigos de una zona fallan todos sus golpes 4 s. Recarga 3 min.' },
  pack: { name: 'Empaquetar', icon: 'hk:pack', stars: 1, desc: 'Habilidad: guardas la casa 40 s; sigue dando oro y nadie la puede tocar. Recarga 5 min.' },
  retrofit: { name: 'Remodelar', icon: 'hk:retrofit', stars: 2, desc: 'Habilidad: una torre gana +20 % de alcance y +5 % de cadencia, hasta 5 veces. Recarga 3 min.' },
  durability: { name: 'Aura de durabilidad', icon: 'hk:aura', stars: 3, desc: 'Pasiva: todas las torres de los colonos disparan un 5 % más rápido.' },
  blinkex: { name: 'Salto EX', icon: 'hk:blinkback', stars: 1, desc: 'Habilidad: hasta 10 s después de saltar, vuelves al punto de partida y se recargan Salto y Prisa.' },
  hasteex: { name: 'Prisa EX', icon: 'hk:hasteex', stars: 2, desc: 'Tu Prisa sube al máximo de velocidad y recarga en 1 s (dura 5 s).' },
  repairex: { name: 'Manos de oro', icon: 'hk:repairex', stars: 2, desc: 'Pasiva: tú y tus reparadores reparáis un 25 % más rápido.' },
};

// ---------- guarida del cazador y tienda ----------
export const HUT_LEVELS = [
  { income: 3, cost: 0 },
  { income: 5, cost: 400 },
  { income: 9, cost: 800 },
  { income: 17, cost: 1600 },
  { income: 25, cost: 5000 },
];
export const HUT_REGEN = 0.06; // fracción de vida máx por segundo
export const HUT_RADIUS = toTiles(500);
export const SHOP_RADIUS = toTiles(650) + 1;

export type ItemLine = 'weapon' | 'armor' | 'life' | 'regen' | 'gloves' | 'boots';
export const ITEM_LINE_ORDER: ItemLine[] = ['weapon', 'armor', 'life', 'regen', 'gloves', 'boots'];
export interface ItemTier {
  name: string;
  icon: string;
  gold: number;
  wood: number;
  value: number; // daño / armadura / vida / regen / % cadencia / velocidad (casillas/s)
  agi?: number; // botas: también dan agilidad
  splash?: number; // arma final: golpea al 100 % en este radio (casillas)
  merge: number; // copias del nivel anterior que se funden en este (0 = no viene de fusión)
}
const t = (name: string, icon: string, gold: number, wood: number, value: number, merge = 2): ItemTier => ({ name, icon, gold, wood, value, merge });
export const ITEMS: Record<ItemLine, { name: string; stat: string; tiers: ItemTier[] }> = {
  weapon: {
    name: 'Armas',
    stat: 'daño',
    tiers: [
      t('Espada corta', 'hk:item-sword', 100, 0, 2, 0),
      t('Espada', 'hk:item-sword', 200, 0, 4),
      t('Espada larga', 'hk:item-sword', 400, 0, 8),
      t('Mandoble', 'hk:item-sword', 800, 0, 16),
      t('Lanza', 'hk:item-lance', 1600, 0, 32),
      t('Pica', 'hk:item-lance', 3200, 0, 64),
      t('Alabarda', 'hk:item-lance', 6400, 0, 128),
      t('Lanza de guerra', 'hk:item-lance', 12800, 0, 256),
      t('Hacha rúnica', 'hk:item-axe', 0, 1, 1280, 5),
      t('Hacha rúnica II', 'hk:item-axe', 0, 2, 2560),
      t('Hacha rúnica III', 'hk:item-axe', 0, 8, 10240, 4),
      t('Hacha rúnica IV', 'hk:item-axe', 0, 32, 40960, 4),
      { ...t('Hacha del fin', 'hk:item-axe', 0, 128, 163840, 4), splash: toTiles(200) },
    ],
  },
  armor: {
    name: 'Escudos',
    stat: 'armadura',
    tiers: [
      t('Escudo de cobre', 'hk:item-shield', 800, 0, 8, 0),
      t('Escudo de hierro', 'hk:item-shield', 1600, 0, 16),
      t('Escudo de acero', 'hk:item-shield', 3200, 0, 32),
      t('Escudo de mithril', 'hk:item-shield', 6400, 0, 64),
      t('Escudo de adamante', 'hk:item-shield', 12800, 0, 128),
      t('Égida rúnica', 'hk:item-shield', 0, 1, 640, 5),
      t('Égida rúnica II', 'hk:item-shield', 0, 2, 1280),
      t('Égida rúnica III', 'hk:item-shield', 0, 8, 5120, 4),
      t('Égida rúnica IV', 'hk:item-shield', 0, 32, 20480, 4),
      t('Égida del fin', 'hk:item-shield', 0, 128, 81920, 4),
    ],
  },
  life: {
    name: 'Vida',
    stat: 'vida',
    tiers: [
      t('Corazón pequeño', 'hk:item-hp', 100, 0, 250, 0),
      t('Corazón', 'hk:item-hp', 200, 0, 500),
      t('Corazón grande', 'hk:item-hp', 400, 0, 1000),
      t('Corazón de oso', 'hk:item-hp', 800, 0, 2000),
      t('Corazón de gigante', 'hk:item-hp', 1600, 0, 4000),
      t('Corazón de titán', 'hk:item-hp', 3200, 0, 8000),
      t('Corazón de dragón', 'hk:item-hp', 6400, 0, 16000),
      t('Corazón ancestral', 'hk:item-hp', 12800, 0, 32000),
      t('Corazón eterno', 'hk:item-hp', 0, 1, 160000, 5),
      t('Corazón eterno II', 'hk:item-hp', 0, 2, 320000),
      t('Corazón eterno III', 'hk:item-hp', 0, 8, 500000, 4),
    ],
  },
  regen: {
    name: 'Regeneración',
    stat: 'vida/s',
    tiers: [
      t('Colgante druida', 'hk:item-regen', 800, 0, 32, 0),
      t('Amuleto verde', 'hk:item-regen', 1600, 0, 64),
      t('Amuleto vivo', 'hk:item-regen', 3200, 0, 128),
      t('Amuleto del bosque', 'hk:item-regen', 6400, 0, 256),
      t('Amuleto ancestral', 'hk:item-regen', 12800, 0, 512),
      t('Savia eterna', 'hk:item-regen', 0, 1, 2560, 5),
      t('Savia eterna II', 'hk:item-regen', 0, 2, 5120),
      t('Savia eterna III', 'hk:item-regen', 0, 8, 20480, 4),
    ],
  },
  gloves: {
    name: 'Guantes',
    stat: '% cadencia',
    tiers: [
      t('Guantes de cuero', 'hk:item-gloves', 125, 0, 0.12, 0),
      t('Guantes tachonados', 'hk:item-gloves', 250, 0, 0.25),
      t('Guanteletes', 'hk:item-gloves', 500, 0, 0.5),
      t('Guanteletes de furia', 'hk:item-gloves', 1000, 0, 1),
      t('Garras de furia', 'hk:item-gloves', 2000, 0, 2),
      t('Garras del frenesí', 'hk:item-gloves', 4000, 0, 4),
      // I03V: +800 % en el papel, pero el juego topa la cadencia en +400 %
      t('Garras del caos', 'hk:item-gloves', 8000, 0, 8),
    ],
  },
  boots: {
    name: 'Botas',
    stat: 'velocidad',
    tiers: [
      { ...t('Botas', 'hk:item-boots', 200, 0, toTiles(120), 0), agi: 2 },
      { ...t('Botas rápidas', 'hk:item-boots', 400, 0, toTiles(135), 0), agi: 4 },
      { ...t('Botas del viento', 'hk:item-boots', 800, 0, toTiles(150), 0), agi: 8 },
    ],
  },
};
export const INVENTORY_SLOTS = 6; // + 1 hueco aparte solo para botas (talento)
export const WOOD_FOR_GOLD = 64000; // la guarida vende 1 de madera por 64 000 de oro
export const WOOD_BULK = { wood: 8, gold: 500_000 }; // I0AC: 8 de madera de golpe, algo más baratas

// Objetos sueltos (no se funden). Los atributos siguen las constantes del mapa:
// 1 de fuerza = +25 de vida · 1 de agilidad = +0.5 de armadura, +4 % de cadencia
// y +1 de daño (es el atributo principal).
export type Trinket =
  | 'branch'
  | 'ring'
  | 'mask'
  | 'orb'
  | 'helm'
  | 'woodshield'
  | 'whitesleg'
  | 'whiteslegex'
  | 'mercury'
  | 'heartbuilding';
export interface TrinketDef {
  name: string;
  icon: string;
  gold: number;
  wood: number;
  str?: number;
  agi?: number;
  block?: number; // resta este daño a cada golpe que recibe
  speed?: number; // casillas/s
  attackSpeed?: number;
  hp?: number;
  regenPct?: number; // % de vida máx por segundo
  immune?: boolean; // inmune a la magia de los colonos
  maxSpeed?: boolean; // velocidad y cadencia al máximo
  desc: string;
}
export const TRINKET_ORDER: Trinket[] = ['branch', 'ring', 'mask', 'orb', 'helm', 'woodshield', 'whitesleg', 'whiteslegex', 'mercury', 'heartbuilding'];
export const TRINKETS: Record<Trinket, TrinketDef> = {
  branch: { name: 'Rama de hierro', icon: 'hk:item-branch', gold: 85, wood: 0, str: 1, agi: 1, desc: '+1 a todos los atributos.' },
  ring: { name: 'Anillo', icon: 'hk:item-ring', gold: 200, wood: 0, str: 5, agi: 2, desc: '+5 de fuerza y +2 de agilidad.' },
  mask: { name: 'Máscara loca', icon: 'hk:item-mask', gold: 500, wood: 0, str: 5, agi: 5, desc: '+5 a todos los atributos.' },
  orb: { name: 'Orbe supremo', icon: 'hk:item-orb', gold: 1100, wood: 0, str: 10, agi: 10, desc: '+10 a todos los atributos.' },
  helm: { name: 'Yelmo de voluntad', icon: 'hk:item-helm', gold: 2000, wood: 0, str: 15, agi: 15, desc: '+15 a todos los atributos.' },
  woodshield: { name: 'Escudo de madera', icon: 'hk:item-woodshield', gold: 400, wood: 0, block: 3, desc: 'Bloquea 3 de daño de cada golpe.' },
  whitesleg: { name: 'Pierna de White', icon: 'hk:item-whitesleg', gold: 5000, wood: 0, speed: toTiles(150), attackSpeed: 4, str: 5, agi: 5, desc: '+150 de velocidad, +400 % de cadencia y +5 a todo.' },
  whiteslegex: { name: 'Pierna de White EX', icon: 'hk:item-whitesleg', gold: 10000, wood: 0, speed: toTiles(200), attackSpeed: 4, str: 15, agi: 15, desc: '+200 de velocidad, +400 % de cadencia y +15 a todo.' },
  mercury: { name: 'Zapatos de mercurio', icon: 'hk:item-mercury', gold: 0, wood: 32, immune: true, maxSpeed: true, desc: 'Inmune a la magia; velocidad y cadencia al máximo.' },
  heartbuilding: { name: 'Corazón del edificio', icon: 'hk:item-heartbuilding', gold: 0, wood: 80, hp: 1_000_000, regenPct: 0.02, desc: '+1 000 000 de vida y +2 % de vida por segundo.' },
};
export const ATTR = { hpPerStr: 25, regenPerStr: 0.05, armorPerAgi: 0.5, asPerAgi: 0.04, dmgPerAgi: 1 } as const;

export type Consumable = 'scroll' | 'ankh' | 'ward' | 'potion' | 'speedscroll' | 'voodoo' | 'bookstr' | 'bookagi';
export const CONSUMABLES: Record<Consumable, { name: string; icon: string; gold: number; wood: number; desc: string }> = {
  scroll: { name: 'Pergamino de regreso', icon: 'hk:item-scroll', gold: 115, wood: 0, desc: 'Vuelves a tu guarida al instante. Se gasta.' },
  ward: { name: 'Tótem sanador', icon: 'hk:item-ward', gold: 10000, wood: 0, desc: 'Lo plantas y cura un 1 % de vida/s a tu bando durante 30 s.' },
  ankh: { name: 'Cruz del renacer', icon: 'hk:item-ankh', gold: 0, wood: 1, desc: 'Si mueres, revives en tu guarida con la vida entera. Una vez.' },
  potion: { name: 'Poción antimagia', icon: 'hk:item-potion', gold: 800, wood: 0, desc: 'Inmune a la magia de los colonos 15 s.' },
  speedscroll: { name: 'Pergamino veloz', icon: 'hk:item-speedscroll', gold: 50, wood: 0, desc: 'Velocidad máxima durante 15 s.' },
  voodoo: { name: 'Minitienda vudú', icon: 'hk:item-voodoo', gold: 0, wood: 16, desc: 'Plantas una tienda donde quieras: puedes comprar junto a ella 2 minutos. 2 usos.' },
  bookstr: { name: 'Libro de fuerza', icon: 'hk:item-bookstr', gold: 990_000, wood: 0, desc: '+4000 de fuerza para siempre (+100 000 de vida). Se lee al comprarlo.' },
  bookagi: { name: 'Libro de agilidad', icon: 'hk:item-bookagi', gold: 990_000, wood: 0, desc: '+2000 de agilidad para siempre (+2000 de daño, +1000 de armadura). Se lee al comprarlo.' },
};

// ---------- el rastreador: compañero que se compra en la guarida ----------
export const BEAST = {
  name: 'Rastreador',
  wood: 8,
  hp: 50000,
  dmg: 640,
  attackSec: 0.5,
  speed: toTiles(522),
  respawnSec: 20,
  plunder: 0.5, // cobra la mitad del daño en oro
  leash: 9, // no se aleja más de esto de su amo si no tiene presa
  // habilidades del H027 (las usa solo): olfato, red, antimagia y paso del viento
  detect: { cd: 45, dur: 8, r: toTiles(1600) },
  ensnare: { cd: 60, dur: 5, range: toTiles(800) },
  ams: { cd: 120, dur: 10 },
  windwalk: { cd: 30, dur: 20 },
} as const;

// ---------- Ejército élfico (Cenarion Keep u01B; aquí lo entrena la Fortaleza) ----------
export type SoldierKind = 'owl' | 'bladecar' | 'elfhunter' | 'breaker' | 'warder' | 'ctree' | 'giant' | 'raptor' | 'claw';
export const SOLDIER_ORDER: SoldierKind[] = ['owl', 'bladecar', 'elfhunter', 'breaker', 'warder', 'ctree', 'giant', 'raptor', 'claw'];
export interface SoldierDef {
  name: string;
  icon: string;
  gold: number;
  wood: number;
  food: number;
  hp: number;
  armor: number;
  dmg: number; // 0 = no ataca (búho)
  cd: number;
  range: number; // casillas
  speed: number; // casillas/s
  regen: number; // vida/s (de noche, los que regeneran de noche)
  nightRegen?: boolean;
  fly?: boolean; // vuela por encima de muros y árboles
  size: number; // tamaño de dibujo (casillas)
  desc: string;
}
// datos de UnitBalance/UnitWeapons/AbilityData del original (velocidad normal)
export const SOLDIERS: Record<SoldierKind, SoldierDef> = {
  owl: { name: 'Búho', icon: 'enemy:harpy', gold: 0, wood: 512, food: 2, hp: 10, armor: 0, dmg: 0, cd: 1, range: 0, speed: toTiles(310), regen: 0.5, fly: true, size: 0.9, desc: 'Explorador volador e invisible. Ve al cazador invisible a su alrededor (visión verdadera 900).' },
  bladecar: { name: 'Carro de cuchillas', icon: 'fusion:shredder', gold: 2560, wood: 80, food: 4, hp: 300, armor: 2, dmg: 512, cd: 1, range: toTiles(1150), speed: toTiles(280), regen: 0, size: 1.1, desc: 'Asedio de muy largo alcance (1150). 20 % de golpes críticos ×1,5.' },
  elfhunter: { name: 'Cazadora elfa', icon: 'tower:archer', gold: 5120, wood: 160, food: 4, hp: 575, armor: 2, dmg: 1024, cd: 1, range: toTiles(700), speed: toTiles(350), regen: 0.5, nightRegen: true, size: 1.05, desc: 'Su hoja lunar rebota a otro enemigo cercano.' },
  breaker: { name: 'Rompemagia', icon: 'enemy:knight', gold: 7680, wood: 240, food: 4, hp: 650, armor: 3, dmg: 1024, cd: 0.75, range: toTiles(600), speed: toTiles(300), regen: 0.5, size: 1.05, desc: 'Inmune a la magia. Cada golpe quema 4 de maná y hace 4 de daño por cada uno.' },
  warder: { name: 'Guardiana', icon: 'enemy:stalker', gold: 15360, wood: 480, food: 4, hp: 550, armor: 2, dmg: 1600, cd: 1, range: toTiles(600), speed: toTiles(300), regen: 0.5, size: 1.05, desc: 'Sus dagas envenenan: 512 de daño por segundo 3 s y −25 % de velocidad.' },
  ctree: { name: 'Árbol cenarion', icon: 'hk:wall-tree', gold: 0, wood: 7680, food: 8, hp: 102400, armor: 14, dmg: 20480, cd: 1, range: toTiles(600), speed: toTiles(220), regen: 100, nightRegen: true, size: 1.7, desc: 'Enreda al enemigo con raíces 2 s cada 8 s.' },
  giant: { name: 'Gigante de montaña', icon: 'enemy:golem', gold: 0, wood: 15360, food: 4, hp: 256000, armor: 85, dmg: 51200, cd: 1, range: 1.3, speed: toTiles(270), regen: 128, nightRegen: true, size: 1.9, desc: 'Piel dura: cada golpe que recibe hace 2000 menos (como mínimo 1000).' },
  raptor: { name: 'Druida raptor', icon: 'enemy:chimera', gold: 0, wood: 51200, food: 4, hp: 256000, armor: 64, dmg: 128000, cd: 1, range: toTiles(800), speed: toTiles(350), regen: 256, nightRegen: true, size: 1.6, desc: 'Fuego feérico (−1024 de armadura 20 s) y ciclón (2 s fuera de combate cada 60 s).' },
  claw: { name: 'Druida garra', icon: 'enemy:brute', gold: 0, wood: 99999, food: 4, hp: 256000, armor: 128, dmg: 256000, cd: 1, range: 1.3, speed: toTiles(270), regen: 256, nightRegen: true, size: 1.8, desc: 'Rugido: +25 % de daño 30 s a sí mismo y a los suyos cercanos.' },
};
export const SOLDIER_SKILLS = {
  ctreeRoot: { cd: 8, dur: 2, range: toTiles(800) },
  raptorFire: { cd: 45, dur: 20, armor: 1024, range: toTiles(700) },
  raptorCyclone: { cd: 60, dur: 2, range: toTiles(600) },
  clawRoar: { cd: 67, dur: 30, bonus: 0.25, r: toTiles(500) },
  warderPoison: { dps: 512, dur: 3 },
  breakerBurn: 4,
  giantSkin: { reduce: 2000, min: 1000 },
  owlSight: toTiles(900),
  carCrit: { chance: 0.2, mult: 1.5 },
};

// Paladín (último reparador): Luz sagrada, Armadura sagrada y aura de armadura
export const PALADIN = {
  holyLight: { cd: 150, range: toTiles(800), base: 5, missing: 0.35 },
  holyArmor: { cd: 30, dur: 6 },
  aura: { armor: 3, r: toTiles(900) },
} as const;
