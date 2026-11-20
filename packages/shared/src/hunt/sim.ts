// CACERÍA · la simulación (servidor). Ver defs.ts para los números y map.ts para
// el laberinto. No guarda replays: no hace falta que sea bit a bit determinista,
// pero no usa Date ni Math.random (todo sale de state.rng).
import { TICK_RATE } from '../constants.js';
import { rand } from '../rng.js';
import {
  ABILITIES,
  ANGEL,
  ATTR,
  BEAST,
  BUILDINGS,
  CONSUMABLES,
  ELF,
  ELF_KILL_GOLD_FRAC,
  ELF_KILL_GOLD_PER_WOOD,
  FORM_ABILITIES,
  GOLD_CAP,
  HUNTER,
  HUT_LEVELS,
  HUT_RADIUS,
  HUT_REGEN,
  INVENTORY_SLOTS,
  ITEMS,
  LUMBERJACKS,
  MAGE,
  MAGE_FUSION_TOWERS,
  MARKET,
  MAX_LUMBERJACKS,
  PHASE,
  SOLDIERS,
  SOLDIER_ORDER,
  SOLDIER_SKILLS,
  type SoldierKind,
  MANA,
  MANA_PER_INT,
  HUT_MANA_REGEN,
  PALADIN,
  WALL_LUCK_SEC,
  WALL_LUCK_VALUES,
  WALL_RANDOM_POOL,
  TOWER_FORKS,
  TOWER_GREEN_FINAL,
  RESOURCE_MULT,
  WOOD_BULK,
  REPAIRERS,
  REPAIR_BASE_SEC,
  SHOP_RADIUS,
  SPECS,
  SPEC_ABILITY,
  TRINKETS,
  WALL_BRANCHES,
  WALL_BRANCH_ORDER,
  WOLF,
  WOOD_FOR_GOLD,
  WORKER_SPEED,
  XP_FOR_ELF,
  armorMult,
  goldUnit,
  isNight,
  levelDef,
  levelsOf,
  roleBounty,
  wallMaxLevel,
  wolfStartGold,
  xpForKill,
  xpForLevel,
  type Ability,
  type BuildingType,
  type Consumable,
  type Form,
  type ItemLine,
  type LevelDef,
  type Req,
  type Spec,
  type TowerBranch,
  type Trinket,
  type WallBranch,
} from './defs.js';
import { TILE_FLOOR, getHuntMap, type HuntMap } from './map.js';

// ---------- estado ----------

export type Side = 'hunter' | 'elf';
export type UnitKind = 'hunter' | 'elf' | 'angel' | 'wolf' | 'repairer' | 'lumberjack' | 'beast' | 'mage' | SoldierKind;
export const UNIT_KIND_ORDER: UnitKind[] = ['hunter', 'elf', 'angel', 'wolf', 'repairer', 'lumberjack', 'beast', 'mage', ...SOLDIER_ORDER];
const isSoldier = (k: UnitKind): k is SoldierKind => k in SOLDIERS;
const toTilesRuntime = (wc3: number) => wc3 / 128;
const FIGHTER_KINDS: UnitKind[] = ['hunter', 'wolf', 'beast'];

export type InvSlot =
  | { kind: 'item'; line: ItemLine; tier: number }
  | { kind: 'cons'; c: Consumable; uses?: number }
  | { kind: 'trinket'; t: Trinket };

export interface HuntPlayer {
  id: string;
  name: string;
  color: string;
  side: Side; // bando ACTUAL (un colono muerto que vuelve como lobo cambia de bando)
  role: 'hunter' | 'colonist'; // papel con el que empezó
  form: Form | 'choosing' | 'dead';
  alive: boolean; // sigue en la pelea por la victoria (cazador vivo / colono vivo)
  connected: boolean;
  gold: number;
  wood: number;
  cds: Partial<Record<Ability, number>>; // tick en que vuelve a estar lista
  mana: number;
  level: number;
  xp: number;
  inv: (InvSlot | null)[];
  spec: Spec | null;
  skinUsed: boolean;
  boots: number; // nivel de las botas (hueco aparte; −1 sin botas)
  allowWolves: boolean; // cazador: ¿deja que los caídos se le unan como lobos?
  str: number; // atributos permanentes de los libros
  agi: number;
  chooseUntil: number; // colono caído: tick límite para elegir ángel o lobo
  respawnAt: number; // ángel o lobo muertos: tick en que vuelven
  stats: { goldEarned: number; damage: number; built: number; kills: number };
}

export type Order =
  | { k: 'idle' }
  | { k: 'move' }
  | { k: 'attack'; target: number }
  | { k: 'build'; type: BuildingType; cx: number; cy: number }
  | { k: 'repair'; target: number }
  | { k: 'follow' };

export interface HuntUnit {
  id: number;
  owner: string;
  kind: UnitKind;
  tier: number; // reparadores y leñadores
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  path: [number, number][];
  goal: { x: number; y: number; w: number; h: number; near: boolean } | null;
  dest: { x: number; y: number } | null; // punto exacto donde pararse (orden de mover)
  sx: number; // dirección de WASD (-1, 0, 1); 0,0 = sin teclas
  sy: number;
  claimAt: number; // último tick en que el cliente corrigió su posición (WASD)
  chillUntil: number; // escarcha del troll: −25 % de velocidad
  roarUntil: number; // rugido del druida garra: +25 % de daño
  recallTo: number; // «Regreso» hacia un aliado (id de unidad; 0 = a la guarida)
  ready: Record<string, number>; // recargas propias (Rastreador, Paladín): tick en que vuelve a estar lista
  anchorX: number; // obrero movido con el ratón: trabaja alrededor de aquí (−1 = donde sea)
  anchorY: number;
  actUntil: number; // golpeando o reparando hasta este tick (para la animación)
  actX: number; // hacia dónde (centro del objetivo)
  actY: number;
  order: Order;
  atkCd: number;
  alive: boolean;
  stunUntil: number;
  rootUntil: number;
  silenceUntil: number;
  invisUntil: number;
  hasteUntil: number; // colono +110 %, lobo +100 %, ángel +100 %
  berserkUntil: number;
  invulnUntil: number;
  focus: number;
  focusUntil: number;
  channelEnd: number; // regreso a la guarida
  tree: number; // leñador: casilla del árbol
  work: number; // reparador: edificio que repara
  repathAt: number;
  // estados nuevos
  missUntil: number; // cegado: falla todos los golpes
  immuneUntil: number; // inmune a la magia de los colonos
  slowUntil: number; // escarcha: −50 % de velocidad
  dotUntil: number; // quemadura / veneno
  dotDps: number;
  armorDownUntil: number; // corrupción
  armorDown: number;
  atkSlowUntil: number; // quemadura: −80 % de cadencia
  bloodlustUntil: number;
  forceUntil: number; // Plena fuerza
  speedMaxUntil: number; // pergamino veloz
  occultUntil: number; // velo lunar: invisible para el cazador
  blinkFrom: { x: number; y: number; until: number } | null;
}

export interface HuntBuilding {
  id: number;
  type: BuildingType;
  owner: string;
  cx: number;
  cy: number;
  size: number;
  level: number;
  wallBranch: WallBranch | null;
  towerBranch: TowerBranch;
  hp: number;
  maxHp: number;
  cd: number;
  invulnUntil: number;
  stunUntil: number;
  howlUntil: number; // torre afectada por el aullido de un lobo
  eyeUntil: number; // vista por el Ojo: no se puede derribar
  investGold: number;
  investWood: number;
  focus?: number; // torre: unidad a la que dispara primero (orden del jugador)
  retro: number; // remodelaciones (0..5)
  forceUntil: number; // Plena fuerza: torres y minas al doble
  packedUntil: number; // casa empaquetada
  luckArmor: number; // muralla aleatoria
  luckReady: number; // aleatoria: tick desde el que se puede sortear (0 = no aplica, −1 = ya sorteada)
  wealthAt?: number; // Fortuna: próxima Abundancia
  eatUntil: number; // muralla de árbol comiéndose un árbol
  eatRate: number;
}

export interface HuntTrap {
  id: number;
  owner: string;
  x: number;
  y: number;
  until: number;
}
export interface HuntEye {
  side: Side;
  detect?: boolean; // también descubre invisibles (Olfato del lobo y del Rastreador)
  x: number;
  y: number;
  r: number;
  until: number;
}
export interface HuntWard {
  owner: string;
  x: number;
  y: number;
  until: number;
}
export interface HuntShop {
  owner: string;
  x: number;
  y: number;
  until: number;
}

export interface HuntState {
  tick: number;
  rng: number;
  gameId: number; // distinto en cada partida (el cliente lo usa para no arrastrar la anterior)
  nextId: number;
  players: HuntPlayer[];
  units: HuntUnit[];
  buildings: HuntBuilding[];
  traps: HuntTrap[];
  eyes: HuntEye[];
  wards: HuntWard[];
  market: number;
  hutLevel: number;
  hunterId: string;
  releaseTick: number;
  over: null | { winner: 'hunter' | 'colonist'; reason: 'hunter_dead' | 'all_dead' | 'ended' };
  treeTaken: Map<number, number>; // casilla de árbol → id del leñador
  deadTrees: Map<number, number>; // árboles comidos → tick a partir del cual pueden volver
  nightUntil: number; // Luz de luna: noche forzada
  shops: HuntShop[]; // minitiendas vudú
}

export type HuntCommand =
  | { k: 'move'; x: number; y: number }
  | { k: 'steer'; dx: number; dy: number; x?: number; y?: number }
  // obreros con el ratón: a un punto, a reparar un edificio o a talar un árbol
  | { k: 'worker'; id: number; x?: number; y?: number; target?: number; tree?: number; follow?: boolean }
  | { k: 'sellunit'; id: number }
  // la Fortaleza (Cenarion Keep) entrena el ejército élfico
  | { k: 'army'; id: number; kind: SoldierKind }
  // torre: disparar primero a esta unidad (0 = la más cercana, como siempre)
  | { k: 'focus'; id: number; target: number }
  | { k: 'attack'; target: number }
  | { k: 'repair'; target: number }
  | { k: 'stop' }
  | { k: 'build'; type: BuildingType; cx: number; cy: number }
  | { k: 'upgrade'; id: number; branch?: string }
  | { k: 'demolish'; id: number }
  | { k: 'train'; id: number; unit: 'repairer' | 'lumberjack'; tier: number }
  | { k: 'market'; buy: boolean; bulk?: boolean }
  | { k: 'ability'; a: Ability; x?: number; y?: number; target?: number }
  | { k: 'buy'; line: ItemLine; tier: number }
  | { k: 'buycons'; c: Consumable }
  | { k: 'buywood'; bulk?: boolean }
  // el cazador admite (o no) que los colonos caídos se le unan como lobos
  | { k: 'wolves'; allow: boolean }
  | { k: 'sell'; slot: number }
  | { k: 'use'; slot: number; x?: number; y?: number }
  | { k: 'hut' }
  | { k: 'form'; f: 'angel' | 'wolf' }
  | { k: 'spec'; s: Spec }
  | { k: 'give'; to: string; gold: number; wood: number }
  | { k: 'lots'; id: number }
  | { k: 'eat'; id: number }
  | { k: 'mage' }
  | { k: 'buytrinket'; t: Trinket }
  | { k: 'beast' };

export interface HuntPlayerCommand {
  playerId: string;
  cmd: HuntCommand;
}

export type HuntEvent =
  | { e: 'hit'; x: number; y: number; dmg: number; gold: number; by: string }
  | { e: 'shot'; x: number; y: number; tx: number; ty: number; dmg: number; gold: boolean; fx?: string }
  | { e: 'built'; x: number; y: number; type: BuildingType; owner: string }
  | { e: 'upgraded'; x: number; y: number; level: number; name: string }
  | { e: 'destroyed'; x: number; y: number; type: BuildingType }
  | { e: 'death'; x: number; y: number; playerId: string; name: string; left: number; bounty: number }
  | { e: 'unitdeath'; x: number; y: number; kind: UnitKind }
  | { e: 'fx'; a: Ability | 'trap_fire' | 'ward' | 'scroll' | 'voodoo' | 'potion'; x: number; y: number; tx?: number; ty?: number; r?: number; side: Side }
  | { e: 'released' }
  | { e: 'shared' }
  | { e: 'exposed'; names: string[] }
  | { e: 'levelup'; playerId: string; level: number; x: number; y: number }
  | { e: 'form'; playerId: string; name: string; form: Form }
  | { e: 'steal'; x: number; y: number; gold: number }
  | { e: 'miss'; x: number; y: number }
  | { e: 'treeeaten'; x: number; y: number }
  | { e: 'mage'; x: number; y: number; playerId: string }
  | { e: 'bought'; priv: string; text: string }
  | { e: 'reject'; priv: string; reason: string };

const T = (sec: number): number => Math.round(sec * TICK_RATE);
const sec = (st: HuntState): number => st.tick / TICK_RATE;
export const huntMinute = (st: HuntState): number => Math.max(0, Math.floor((st.tick - st.releaseTick) / (60 * TICK_RATE)));

// ---------- creación ----------

// dirección de la acción en curso (golpe o reparación) para la animación
function actDir(st: HuntState, u: HuntUnit): number {
  if (u.actUntil <= st.tick) return 0;
  const dx = u.actX - u.x;
  const dy = u.actY - u.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 2 : 3;
  return dy < 0 ? 4 : 1;
}

function newUnit(st: HuntState, owner: string, kind: UnitKind, x: number, y: number, hp: number, tier = 0): HuntUnit {
  const u: HuntUnit = {
    id: st.nextId++,
    owner,
    kind,
    tier,
    x,
    y,
    hp,
    maxHp: hp,
    path: [],
    sx: 0,
    sy: 0,
    claimAt: 0,
    chillUntil: 0,
    roarUntil: 0,
    recallTo: 0,
    ready: {},
    anchorX: -1,
    anchorY: -1,
    actUntil: 0,
    actX: 0,
    actY: 0,
    goal: null,
    dest: null,
    order: { k: 'idle' },
    atkCd: 0,
    alive: true,
    stunUntil: 0,
    rootUntil: 0,
    silenceUntil: 0,
    invisUntil: 0,
    hasteUntil: 0,
    berserkUntil: 0,
    invulnUntil: 0,
    focus: 0,
    focusUntil: 0,
    channelEnd: 0,
    tree: -1,
    work: 0,
    repathAt: 0,
    missUntil: 0,
    immuneUntil: 0,
    slowUntil: 0,
    dotUntil: 0,
    dotDps: 0,
    armorDownUntil: 0,
    armorDown: 0,
    atkSlowUntil: 0,
    bloodlustUntil: 0,
    forceUntil: 0,
    speedMaxUntil: 0,
    occultUntil: 0,
    blinkFrom: null,
  };
  st.units.push(u);
  return u;
}

// `hunterIds`: uno o varios cazadores (cada jugador elige bando en el lobby)
export function createHunt(seed: number, roster: { id: string; name: string; color: string }[], hunterIds: string | string[]): HuntState {
  const hunters = new Set(Array.isArray(hunterIds) ? hunterIds : [hunterIds]);
  const hunterId = [...hunters][0] ?? '';
  const map = getHuntMap();
  const st: HuntState = {
    tick: 0,
    rng: seed | 0,
    gameId: seed | 0,
    nextId: 1,
    players: [],
    units: [],
    buildings: [],
    traps: [],
    eyes: [],
    wards: [],
    market: MARKET.start,
    hutLevel: 1,
    hunterId,
    releaseTick: T(PHASE.headStartSec),
    over: null,
    treeTaken: new Map(),
    deadTrees: new Map(),
    nightUntil: 0,
    shops: [],
  };
  let slot = 0;
  const elves = roster.filter((r) => !hunters.has(r.id)).length;
  let hslot = 0;
  for (const r of roster) {
    const hunter = hunters.has(r.id);
    st.players.push({
      id: r.id,
      name: r.name,
      color: r.color,
      side: hunter ? 'hunter' : 'elf',
      role: hunter ? 'hunter' : 'colonist',
      form: hunter ? 'hunter' : 'elf',
      alive: true,
      connected: true,
      gold: hunter ? 75 : ELF.startGold,
      wood: hunter ? 0 : ELF.startWood,
      cds: {},
      mana: hunter ? MANA.hunter.max : MANA.elf.max,
      level: 1,
      xp: 0,
      inv: new Array(INVENTORY_SLOTS).fill(null),
      spec: null,
      skinUsed: false,
      boots: -1,
      allowWolves: true,
      str: 0,
      agi: 0,
      chooseUntil: 0,
      respawnAt: 0,
      stats: { goldEarned: 0, damage: 0, built: 0, kills: 0 },
    });
    if (hunter) {
      // varios cazadores: en fila delante de la guarida
      const off = hslot === 0 ? 0 : (hslot % 2 ? 1 : -1) * Math.ceil(hslot / 2);
      newUnit(st, r.id, 'hunter', map.camp.x + 0.5 + off, map.camp.y + 2.5, HUNTER.hp);
      hslot++;
    } else {
      const a = (slot / Math.max(1, elves)) * Math.PI * 2;
      newUnit(st, r.id, 'elf', map.camp.x + 0.5 + Math.round(Math.cos(a) * 3), map.camp.y + 0.5 + Math.round(Math.sin(a) * 3), ELF.hp);
      slot++;
    }
  }
  return st;
}

// ---------- utilidades ----------

const playerOf = (st: HuntState, id: string) => st.players.find((p) => p.id === id);
export const mainUnit = (st: HuntState, id: string): HuntUnit | undefined =>
  st.units.find((u) => u.owner === id && u.alive && (u.kind === 'hunter' || u.kind === 'elf' || u.kind === 'angel' || u.kind === 'wolf'));
export const isNightAt = (st: HuntState): boolean => st.tick < st.nightUntil || isNight(st.tick / TICK_RATE);
const isTreeAlive = (st: HuntState, map: HuntMap, c: number): boolean => map.tiles[c] === 2 && !st.deadTrees.has(c);
const magicImmune = (st: HuntState, u: HuntUnit): boolean => {
  if (u.immuneUntil > st.tick) return true;
  const p = playerOf(st, u.owner);
  return !!p && p.inv.some((s) => s?.kind === 'trinket' && TRINKETS[s.t].immune);
};
export const huntHunterUnit = (st: HuntState): HuntUnit | undefined => st.units.find((u) => u.kind === 'hunter' && u.alive);
const sideOfOwner = (st: HuntState, owner: string): Side => playerOf(st, owner)?.side ?? 'elf';
const cell = (v: number) => Math.floor(v);

function pay(p: HuntPlayer, gold: number): void {
  p.gold = Math.min(GOLD_CAP, p.gold + gold);
  if (gold > 0) p.stats.goldEarned += gold;
}

// lo GANADO (no el comercio ni los reembolsos) se multiplica por RESOURCE_MULT
function earn(p: HuntPlayer, gold: number): void {
  pay(p, gold * RESOURCE_MULT);
}

function reject(ev: HuntEvent[], playerId: string, reason: string): void {
  ev.push({ e: 'reject', priv: playerId, reason });
}

export function huntBlockedGrid(st: HuntState, map: HuntMap): Uint8Array {
  const g = new Uint8Array(map.w * map.h);
  for (let i = 0; i < g.length; i++) g[i] = map.tiles[i] === TILE_FLOOR || st.deadTrees.has(i) ? 0 : 1;
  g[map.camp.y * map.w + map.camp.x] = 1; // la guarida ocupa su casilla
  for (const b of st.buildings) for (let j = 0; j < b.size; j++) for (let i = 0; i < b.size; i++) g[(b.cy + j) * map.w + b.cx + i] = 1;
  return g;
}

// distancia de un punto a un rectángulo de casillas (0 si está dentro)
function distToRect(x: number, y: number, rx: number, ry: number, rw: number, rh: number): number {
  const dx = Math.max(rx - x, 0, x - (rx + rw));
  const dy = Math.max(ry - y, 0, y - (ry + rh));
  return Math.hypot(dx, dy);
}
const touchesBuilding = (u: { x: number; y: number }, b: HuntBuilding): boolean => distToRect(u.x, u.y, b.cx, b.cy, b.size, b.size) <= 0.75;

const DIRS: [number, number, number][] = [
  [1, 0, 10],
  [-1, 0, 10],
  [0, 1, 10],
  [0, -1, 10],
  [1, 1, 14],
  [1, -1, 14],
  [-1, 1, 14],
  [-1, -1, 14],
];

// A* en la rejilla. Con `near` basta con quedar pegado (8-vecindad) al rectángulo
// destino. Si no hay camino, devuelve el camino a la casilla más cercana.
export function huntFindPath(
  g: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number,
  goal: { x: number; y: number; w: number; h: number; near: boolean },
): { path: [number, number][]; reached: boolean } {
  const n = w * h;
  const start = sy * w + sx;
  const dist = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const heapF: number[] = [];
  const heapI: number[] = [];
  const push = (f: number, i: number) => {
    let k = heapF.length;
    heapF.push(f);
    heapI.push(i);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p] <= heapF[k]) break;
      [heapF[p], heapF[k]] = [heapF[k], heapF[p]];
      [heapI[p], heapI[k]] = [heapI[k], heapI[p]];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heapI[0];
    const lf = heapF.pop()!;
    const li = heapI.pop()!;
    if (heapF.length > 0) {
      heapF[0] = lf;
      heapI[0] = li;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heapF.length && heapF[l] < heapF[m]) m = l;
        if (r < heapF.length && heapF[r] < heapF[m]) m = r;
        if (m === k) break;
        [heapF[m], heapF[k]] = [heapF[k], heapF[m]];
        [heapI[m], heapI[k]] = [heapI[k], heapI[m]];
        k = m;
      }
    }
    return top;
  };
  const gx = goal.x + (goal.w - 1) / 2;
  const gy = goal.y + (goal.h - 1) / 2;
  const hOf = (x: number, y: number) => {
    const dx = Math.max(0, Math.abs(x - gx) - (goal.w - 1) / 2);
    const dy = Math.max(0, Math.abs(y - gy) - (goal.h - 1) / 2);
    return 10 * Math.max(dx, dy) + 4 * Math.min(dx, dy);
  };
  const isGoal = (x: number, y: number) => {
    const inside = x >= goal.x && x < goal.x + goal.w && y >= goal.y && y < goal.y + goal.h;
    if (!goal.near) return inside;
    return !inside && x >= goal.x - 1 && x <= goal.x + goal.w && y >= goal.y - 1 && y <= goal.y + goal.h;
  };
  dist[start] = 0;
  push(hOf(sx, sy), start);
  let best = start;
  let bestH = hOf(sx, sy);
  let found = -1;
  let expanded = 0;
  while (heapF.length > 0 && expanded < 12000) {
    const i = pop();
    expanded++;
    const x = i % w;
    const y = (i - x) / w;
    if (isGoal(x, y)) {
      found = i;
      break;
    }
    const hh = hOf(x, y);
    if (hh < bestH) {
      bestH = hh;
      best = i;
    }
    for (const [dx, dy, c] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (g[j]) continue;
      if (dx !== 0 && dy !== 0 && (g[y * w + nx] || g[ny * w + x])) continue;
      const nd = dist[i] + c;
      if (dist[j] !== -1 && dist[j] <= nd) continue;
      dist[j] = nd;
      prev[j] = i;
      push(nd + hOf(nx, ny), j);
    }
  }
  const end = found !== -1 ? found : best;
  const path: [number, number][] = [];
  for (let i = end; i !== start && i !== -1; i = prev[i]) path.push([i % w, Math.floor(i / w)]);
  path.reverse();
  return { path, reached: found !== -1 || (goal.near ? isGoal(sx, sy) : sx === goal.x && sy === goal.y) };
}

// ¿Se puede ir en línea recta de A a B sin rozar nada? Muestrea el segmento con un
// pequeño margen a los lados (el «cuerpo» de la unidad) para no cortar esquinas.
function clearLine(g: Uint8Array, w: number, h: number, ax: number, ay: number, bx: number, by: number): boolean {
  const d = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(d / 0.2));
  const R = 0.3;
  for (let i = 1; i <= steps; i++) {
    const x = ax + ((bx - ax) * i) / steps;
    const y = ay + ((by - ay) * i) / steps;
    for (const [ox, oy] of [[0, 0], [R, R], [R, -R], [-R, R], [-R, -R]] as const) {
      const cx = Math.floor(x + ox);
      const cy = Math.floor(y + oy);
      if (cx < 0 || cy < 0 || cx >= w || cy >= h || g[cy * w + cx]) return false;
    }
  }
  return true;
}

// Alisa el camino de casillas: se salta las intermedias mientras haya línea
// recta, así la unidad camina en diagonales limpias y no en zigzag.
function smoothPath(g: Uint8Array, w: number, h: number, sx: number, sy: number, path: [number, number][]): [number, number][] {
  if (path.length <= 1) return path;
  const out: [number, number][] = [];
  let fx = sx;
  let fy = sy;
  let i = 0;
  while (i < path.length) {
    let j = path.length - 1;
    while (j > i && !clearLine(g, w, h, fx, fy, path[j][0] + 0.5, path[j][1] + 0.5)) j--;
    out.push(path[j]);
    fx = path[j][0] + 0.5;
    fy = path[j][1] + 0.5;
    i = j + 1;
  }
  return out;
}

function routeTo(st: HuntState, map: HuntMap, g: Uint8Array, u: HuntUnit, goal: NonNullable<HuntUnit['goal']>, dest: { x: number; y: number } | null = null): boolean {
  u.goal = goal;
  u.dest = dest;
  // el búho vuela: en línea recta, por encima de muros y árboles
  if (u.kind === 'owl') {
    const gx = dest ? dest.x : goal.x + goal.w / 2;
    const gy = dest ? dest.y : goal.y + goal.h / 2;
    u.dest = { x: gx, y: gy };
    u.path = [[cell(gx), cell(gy)]];
    u.repathAt = st.tick + T(1);
    return true;
  }
  const res = huntFindPath(g, map.w, map.h, cell(u.x), cell(u.y), goal);
  u.path = smoothPath(g, map.w, map.h, u.x, u.y, res.path);
  // destino en la misma casilla: ir directo al punto pinchado
  if (dest && u.path.length === 0 && res.reached) u.path = [[cell(dest.x), cell(dest.y)]];
  u.repathAt = st.tick + T(1);
  return res.reached;
}
const pointGoal = (x: number, y: number) => ({ x: cell(x), y: cell(y), w: 1, h: 1, near: false });
const buildingGoal = (b: HuntBuilding) => ({ x: b.cx, y: b.cy, w: b.size, h: b.size, near: true });

// ---------- números de cada cosa ----------

export function buildingDef(b: HuntBuilding): LevelDef {
  return levelDef(b.type, b.level, b.wallBranch, b.towerBranch);
}

export function techOf(st: HuntState, owner: string): number {
  let t = 0;
  for (const b of st.buildings) if (b.owner === owner && b.type === 'workshop') t = Math.max(t, b.level);
  return t;
}
export function maxWallOf(st: HuntState, owner: string): number {
  let t = 0;
  for (const b of st.buildings) if (b.owner === owner && b.type === 'wall') t = Math.max(t, b.level);
  return t;
}
export function shopNear(st: HuntState, x: number, y: number, side: Side): boolean {
  const map = getHuntMap();
  if (Math.hypot(x - (map.camp.x + 0.5), y - (map.camp.y + 0.5)) <= SHOP_RADIUS) return true;
  return st.shops.some((s) => s.until > st.tick && sideOfOwner(st, s.owner) === side && Math.hypot(s.x - x, s.y - y) <= 3);
}
export function houseOf(st: HuntState, owner: string): HuntBuilding | undefined {
  return st.buildings.find((b) => b.owner === owner && b.type === 'house');
}
export function reqError(st: HuntState, owner: string, req: Req | undefined): string | null {
  if (!req) return null;
  if (req.tech && techOf(st, owner) < req.tech) return `Requiere ${['', 'Taller', 'Ayuntamiento I', 'Ayuntamiento II', 'Ayuntamiento III', 'Fortaleza'][req.tech]}`;
  if (req.wall && maxWallOf(st, owner) < req.wall) return `Requiere una muralla de nivel ${req.wall}`;
  if (req.house && (houseOf(st, owner)?.level ?? 0) < req.house) return `Requiere la casa a nivel ${req.house}`;
  return null;
}
export function foodOf(st: HuntState, owner: string): { used: number; cap: number } {
  const house = houseOf(st, owner);
  const cap = Math.min(ELF.foodCeiling, ELF.baseFood + (house ? levelDef('house', house.level, null, 'main').food ?? 0 : 0));
  let used = 0;
  for (const u of st.units) {
    if (!u.alive || u.owner !== owner) continue;
    if (u.kind === 'repairer') used += REPAIRERS[u.tier].food;
    else if (u.kind === 'lumberjack') used += LUMBERJACKS[u.tier].food;
    else if (isSoldier(u.kind)) used += SOLDIERS[u.kind].food;
  }
  return { used, cap };
}

export interface FighterStats {
  maxHp: number;
  dmg: number;
  armor: number;
  regen: number;
  attackSec: number;
  speed: number;
}
export function itemSum(p: HuntPlayer, line: ItemLine): number {
  if (line === 'boots') return p.boots >= 0 ? ITEMS.boots.tiers[p.boots].value : 0;
  let sum = 0;
  for (const it of p.inv) if (it?.kind === 'item' && it.line === line) sum += ITEMS[line].tiers[it.tier].value;
  return sum;
}
function trinkets(p: HuntPlayer) {
  let str = p.str;
  let agi = p.agi;
  let block = 0;
  let speed = 0;
  let as = 0;
  let hp = 0;
  let regenPct = 0;
  let maxSpeed = false;
  for (const it of p.inv) {
    if (it?.kind !== 'trinket') continue;
    const t = TRINKETS[it.t];
    str += t.str ?? 0;
    agi += t.agi ?? 0;
    block += t.block ?? 0;
    speed = Math.max(speed, t.speed ?? 0);
    as += t.attackSpeed ?? 0;
    hp += t.hp ?? 0;
    regenPct += t.regenPct ?? 0;
    if (t.maxSpeed) maxSpeed = true;
  }
  return { str, agi, block, speed, as, hp, regenPct, maxSpeed };
}
export function fighterStats(st: HuntState, p: HuntPlayer, u: HuntUnit | undefined): FighterStats & { block: number } {
  if (u?.kind === 'beast') {
    return { maxHp: BEAST.hp, dmg: BEAST.dmg, armor: 4, regen: 0, attackSec: BEAST.attackSec, speed: BEAST.speed, block: 0 };
  }
  if (u && isSoldier(u.kind)) {
    const d = SOLDIERS[u.kind];
    const regen = d.nightRegen && !isNightAt(st) ? 0.5 : d.regen;
    return { maxHp: d.hp, dmg: d.dmg, armor: d.armor, regen, attackSec: d.cd, speed: d.speed * (u.chillUntil > st.tick ? 0.75 : 1), block: 0 };
  }
  if (u?.kind === 'mage') {
    return { maxHp: MAGE.hp, dmg: MAGE.dmg, armor: MAGE.armor, regen: MAGE.regen, attackSec: MAGE.cd, speed: MAGE.speed, block: 0 };
  }
  const L = p.level - 1;
  const tk = { ...trinkets(p) };
  // agilidad de las botas y talentos del troll (Ojo EX +1 a todo; hueco de botas
  // vacío +1 a todo)
  const bootsAgi = p.boots >= 0 ? (ITEMS.boots.tiers[p.boots].agi ?? 0) : 0;
  const talent = p.form === 'hunter' ? HUNTER.talentAttr + (p.boots < 0 ? HUNTER.emptyBootsAttr : 0) : 0;
  tk.agi += bootsAgi + talent;
  tk.str += talent;
  let as = HUNTER.asPerLevel * L + itemSum(p, 'gloves') + HUNTER.focusBase + tk.as + tk.agi * ATTR.asPerAgi + (u ? u.focus * HUNTER.focusPerHit : 0);
  if (u && u.berserkUntil > st.tick) as += 1;
  if (u && u.bloodlustUntil > st.tick) as += 0.5;
  if (u && u.atkSlowUntil > st.tick) as -= 0.8;
  as = tk.maxSpeed ? HUNTER.maxAttackSpeed : Math.min(HUNTER.maxAttackSpeed, as);
  let speed = HUNTER.speed + Math.max(itemSum(p, 'boots'), tk.speed);
  speed = Math.min(HUNTER.maxSpeed, speed);
  if (tk.maxSpeed || (u && u.speedMaxUntil > st.tick)) speed = HUNTER.maxSpeed;
  if (u) {
    if (u.invisUntil > st.tick) speed *= 1.5;
    if (u.berserkUntil > st.tick) speed *= 1.5;
    if (u.hasteUntil > st.tick) speed *= 2;
    if (u.bloodlustUntil > st.tick) speed *= 1.3;
    if (u.slowUntil > st.tick) speed *= 0.5;
  }
  const maxHp = HUNTER.hp + HUNTER.hpPerLevel * L + itemSum(p, 'life') + tk.str * ATTR.hpPerStr + tk.hp;
  return {
    maxHp,
    dmg: HUNTER.dmg + HUNTER.dmgPerLevel * L + itemSum(p, 'weapon') + tk.agi * ATTR.dmgPerAgi,
    armor: HUNTER.armor + HUNTER.armorPerLevel * L + itemSum(p, 'armor') + tk.agi * ATTR.armorPerAgi - (u && u.armorDownUntil > st.tick ? u.armorDown : 0),
    regen: HUNTER.regenPerLevel * L + itemSum(p, 'regen') + tk.str * ATTR.regenPerStr + maxHp * tk.regenPct,
    attackSec: HUNTER.attackSec / (1 + Math.max(-0.8, as)),
    speed,
    block: tk.block,
  };
}

function unitSpeed(st: HuntState, u: HuntUnit): number {
  return baseSpeed(st, u) * (u.chillUntil > st.tick ? 1 - HUNTER.frostSlow : 1);
}
function baseSpeed(st: HuntState, u: HuntUnit): number {
  const p = playerOf(st, u.owner);
  switch (u.kind) {
    case 'hunter':
    case 'wolf':
    case 'beast':
    case 'mage':
      return p ? fighterStats(st, p, u).speed : HUNTER.speed;
    case 'owl':
    case 'bladecar':
    case 'elfhunter':
    case 'breaker':
    case 'warder':
    case 'ctree':
    case 'giant':
    case 'raptor':
    case 'claw':
      return SOLDIERS[u.kind].speed;
    case 'elf': {
      if (st.tick < st.releaseTick) return PHASE.sprintSpeed;
      let v = ELF.speed;
      if (u.hasteUntil > st.tick) v = p?.spec === 'hasteex' ? 600 / 128 : v * 2.1;
      if (u.forceUntil > st.tick) v *= 2;
      return v;
    }
    case 'angel':
      return ANGEL.speed * (u.hasteUntil > st.tick ? 2 : 1) * (u.forceUntil > st.tick ? 2 : 1);
    default:
      return WORKER_SPEED * (u.forceUntil > st.tick ? 2 : 1);
  }
}

function syncFighterHp(st: HuntState, p: HuntPlayer, u: HuntUnit): void {
  const s = fighterStats(st, p, u);
  if (s.maxHp !== u.maxHp) {
    const gain = s.maxHp - u.maxHp;
    u.maxHp = s.maxHp;
    u.hp = Math.min(u.maxHp, Math.max(1, u.hp + Math.max(0, gain)));
  }
}

// ---------- visión ----------

export function visionSources(st: HuntState, side: Side, viewer: HuntPlayer | null): [number, number, number][] {
  const night = isNightAt(st);
  const src: [number, number, number][] = [];
  const shared = st.tick >= T(PHASE.sharedVisionSec);
  const mine = (owner: string) => !viewer || owner === viewer.id || side === 'hunter' || shared;
  for (const u of st.units) {
    if (!u.alive || sideOfOwner(st, u.owner) !== side || !mine(u.owner)) continue;
    let r = 4;
    if (u.kind === 'hunter' || u.kind === 'wolf' || u.kind === 'beast') r = night ? HUNTER.visionNight : HUNTER.visionDay;
    else if (u.kind === 'mage') r = 10;
    else if (isSoldier(u.kind)) r = u.kind === 'owl' ? toTilesRuntime(1500) : 9;
    else if (u.kind === 'elf') r = night ? ELF.visionNight : ELF.visionDay;
    else if (u.kind === 'angel') r = ANGEL.vision;
    src.push([u.x, u.y, r]);
  }
  if (side === 'elf') {
    for (const b of st.buildings) {
      if (!mine(b.owner) || b.packedUntil > st.tick) continue;
      const r = b.type === 'tower' || b.type === 'sight' ? (night ? 7 : 8) : night ? 4.7 : 7;
      src.push([b.cx + b.size / 2, b.cy + b.size / 2, r]);
    }
  } else {
    const map = getHuntMap();
    src.push([map.camp.x + 0.5, map.camp.y + 0.5, 8]);
  }
  for (const e of st.eyes) if (e.side === side && e.until > st.tick) src.push([e.x, e.y, e.r]);
  return src;
}

function inVision(src: [number, number, number][], x: number, y: number): boolean {
  for (const [sx, sy, r] of src) if ((sx - x) * (sx - x) + (sy - y) * (sy - y) <= r * r) return true;
  return false;
}

// ¿Ve el bando de colonos al cazador invisible? Solo si una Atalaya lo cubre.
function detected(st: HuntState, u: HuntUnit): boolean {
  if (u.invisUntil <= st.tick && u.occultUntil <= st.tick) return true;
  const side = sideOfOwner(st, u.owner);
  for (const e of st.eyes) if (e.detect && e.side !== side && e.until > st.tick && Math.hypot(e.x - u.x, e.y - u.y) <= e.r) return true;
  if (side === 'hunter') for (const o of st.units) if (o.alive && o.kind === 'owl' && Math.hypot(o.x - u.x, o.y - u.y) <= SOLDIER_SKILLS.owlSight) return true;
  for (const b of st.buildings) {
    if (b.type !== 'sight') continue;
    const r = buildingDef(b).range ?? 7;
    if (Math.hypot(b.cx + 0.5 - u.x, b.cy + 0.5 - u.y) <= r) return true;
  }
  return false;
}

// colonos a los que se les ve desde el bando del cazador por no tener casa
function exposedOwners(st: HuntState): Set<string> {
  const out = new Set<string>();
  if (st.tick < T(PHASE.exposeSec)) return out;
  for (const p of st.players) if (p.form === 'elf' && p.alive && !houseOf(st, p.id)) out.add(p.id);
  return out;
}

// ---------- combate ----------

function giveXp(st: HuntState, p: HuntPlayer, xp: number, ev: HuntEvent[]): void {
  if (p.side !== 'hunter') return;
  p.xp += xp;
  while (p.xp >= xpForLevel(p.level + 1)) {
    p.level += 1;
    const u = mainUnit(st, p.id);
    if (u) {
      syncFighterHp(st, p, u);
      u.hp = u.maxHp;
      ev.push({ e: 'levelup', playerId: p.id, level: p.level, x: u.x, y: u.y });
    }
  }
}

function razeBuilding(st: HuntState, b: HuntBuilding, ev: HuntEvent[], byEnemy: boolean): void {
  st.buildings = st.buildings.filter((o) => o !== b);
  ev.push({ e: 'destroyed', x: b.cx + b.size / 2, y: b.cy + b.size / 2, type: b.type });
  const owner = playerOf(st, b.owner);
  // la casa devuelve TODO lo invertido si la tumba el enemigo: se puede rehacer
  if (b.type === 'house' && byEnemy && owner && owner.alive) {
    owner.gold = Math.min(GOLD_CAP, owner.gold + b.investGold);
    owner.wood += b.investWood;
  }
  // los leñadores del árbol caído se quedan sin casa: siguen en su árbol
}

function killElfPlayer(st: HuntState, u: HuntUnit, killer: HuntPlayer | undefined, ev: HuntEvent[]): void {
  const p = playerOf(st, u.owner);
  u.alive = false;
  u.hp = 0;
  if (!p) return;
  const bounty = Math.min(GOLD_CAP, Math.floor(p.gold * ELF_KILL_GOLD_FRAC) + p.wood * ELF_KILL_GOLD_PER_WOOD);
  if (killer) {
    earn(killer, bounty);
    killer.stats.kills += 1;
    giveXp(st, killer, XP_FOR_ELF, ev);
  }
  p.gold = 0;
  p.wood = 0;
  p.alive = false;
  p.form = 'choosing';
  p.chooseUntil = st.tick + T(20);
  for (const b of st.buildings.filter((o) => o.owner === p.id)) razeBuilding(st, b, ev, false);
  for (const w of st.units) if (w.alive && w.owner === p.id) {
    w.alive = false;
    if (w.tree >= 0) st.treeTaken.delete(w.tree);
  }
  const left = st.players.filter((q) => q.form === 'elf' && q.alive).length;
  ev.push({ e: 'death', x: u.x, y: u.y, playerId: p.id, name: p.name, left, bounty });
}

function killUnit(st: HuntState, u: HuntUnit, killerOwner: string | null, ev: HuntEvent[]): void {
  const killer = killerOwner ? playerOf(st, killerOwner) : undefined;
  if (u.kind === 'elf') {
    const p = playerOf(st, u.owner);
    if (p && p.spec === 'skin' && !p.skinUsed) {
      p.skinUsed = true;
      u.hp = 1;
      u.invulnUntil = st.tick + T(2);
      return;
    }
    killElfPlayer(st, u, killer, ev);
    return;
  }
  if (u.kind === 'hunter') {
    const p = playerOf(st, u.owner);
    const ankh = p?.inv.findIndex((s) => s?.kind === 'cons' && s.c === 'ankh') ?? -1;
    if (p && ankh >= 0) {
      p.inv[ankh] = null;
      const map = getHuntMap();
      u.x = map.camp.x + 0.5;
      u.y = map.camp.y + 2.5;
      u.hp = u.maxHp;
      u.path = [];
      u.order = { k: 'idle' };
      ev.push({ e: 'fx', a: 'scroll', x: u.x, y: u.y, side: 'hunter' });
      return;
    }
    u.alive = false;
    u.hp = 0;
    if (p) p.alive = false;
    ev.push({ e: 'death', x: u.x, y: u.y, playerId: u.owner, name: p?.name ?? '', left: -1, bounty: 0 });
    return;
  }
  u.alive = false;
  u.hp = 0;
  if (u.tree >= 0) st.treeTaken.delete(u.tree);
  ev.push({ e: 'unitdeath', x: u.x, y: u.y, kind: u.kind });
  if (u.kind === 'beast') {
    if (killer) earn(killer, roleBounty(huntMinute(st)));
    (u as HuntUnit & { respawnAt?: number }).respawnAt = st.tick + T(BEAST.respawnSec);
    return;
  }
  if (u.kind === 'angel' || u.kind === 'wolf') {
    const p = playerOf(st, u.owner);
    if (p) p.respawnAt = st.tick + T(u.kind === 'angel' ? ANGEL.respawnSec : WOLF.respawnSec);
    if (killer) earn(killer, roleBounty(huntMinute(st)));
    if (killer) giveXp(st, killer, 100, ev);
  } else if (killer) {
    giveXp(st, killer, xpForKill(u.tier + 1), ev);
  }
}

// Golpe de un luchador del bando del cazador (cazador o lobo) a un objetivo.
// +3 de armadura cerca de un Paladín vivo (aura de concentración)
function paladinAura(st: HuntState, x: number, y: number): number {
  for (const o of st.units) {
    if (!o.alive || o.kind !== 'repairer' || o.tier !== REPAIRERS.length - 1) continue;
    if (Math.hypot(o.x - x, o.y - y) <= PALADIN.aura.r) return PALADIN.aura.armor;
  }
  return 0;
}
function weaponSplash(p: HuntPlayer): number {
  let r = 0;
  for (const it of p.inv) if (it?.kind === 'item' && it.line === 'weapon') r = Math.max(r, ITEMS.weapon.tiers[it.tier].splash ?? 0);
  return r;
}

function strike(st: HuntState, att: HuntUnit, p: HuntPlayer, target: { b?: HuntBuilding; u?: HuntUnit }, ev: HuntEvent[]): void {
  const s = fighterStats(st, p, att);
  const map = getHuntMap();
  void map;
  att.invisUntil = 0; // atacar descubre
  att.actUntil = st.tick + T(0.6);
  if (target.b) {
    att.actX = target.b.cx + target.b.size / 2;
    att.actY = target.b.cy + target.b.size / 2;
  } else if (target.u) {
    att.actX = target.u.x;
    att.actY = target.u.y;
  }
  if (st.tick < att.focusUntil || att.focus === 0) att.focus = Math.min(HUNTER.focusMax, att.focus + 1);
  att.focusUntil = st.tick + T(HUNTER.focusSec);
  // el hielo cercano congela la cadencia
  let slow = 0;
  for (const b of st.buildings) {
    if (b.type !== 'wall' || b.wallBranch !== 'ice') continue;
    if (distToRect(att.x, att.y, b.cx, b.cy, 1, 1) <= 1.5) slow = Math.max(slow, buildingDef(b).slowAura ?? 0);
  }
  // Como en el WC3: el freno del hielo se RESTA a la velocidad de ataque (no la
  // multiplica) y el total se recorta entre −80 % y +400 %. Así un troll recién
  // salido casi no puede pegar a una muralla de hielo alta, pero uno con guantes sí.
  const baseSec = att.kind === 'beast' ? BEAST.attackSec : HUNTER.attackSec;
  const bonus = baseSec / s.attackSec - 1;
  const total = Math.min(1 + HUNTER.maxAttackSpeed, Math.max(0.2, 1 + bonus - slow));
  att.atkCd = T(baseSec / total);
  const plunder = att.kind === 'beast' ? BEAST.plunder : 1;
  let raw = s.dmg;
  // cegado: el golpe se pierde
  if (att.missUntil > st.tick) {
    const tx = target.u ? target.u.x : target.b!.cx + target.b!.size / 2;
    const ty = target.u ? target.u.y : target.b!.cy + target.b!.size / 2;
    ev.push({ e: 'miss', x: tx, y: ty });
    return;
  }
  if (target.u) {
    const v = target.u;
    if (v.invulnUntil > st.tick) return;
    if (FIGHTER_KINDS.includes(v.kind)) return; // no se atacan entre ellos
    let dmg = raw * armorMult((v.kind === 'mage' ? MAGE.armor : isSoldier(v.kind) ? SOLDIERS[v.kind].armor - (v.armorDownUntil > st.tick ? v.armorDown : 0) : 0) + paladinAura(st, v.x, v.y));
    // piel dura del gigante: −2000 por golpe, pero nunca por debajo de 1000
    if (v.kind === 'giant' && dmg > SOLDIER_SKILLS.giantSkin.min) dmg = Math.max(SOLDIER_SKILLS.giantSkin.min, dmg - SOLDIER_SKILLS.giantSkin.reduce);
    dmg = Math.max(0, dmg);
    // orbe de escarcha del troll: el golpe ralentiza
    if (att.kind === 'hunter') v.chillUntil = st.tick + T(HUNTER.frostSec);
    v.hp -= dmg;
    const gold = Math.floor(Math.min(dmg, v.hp + dmg) * plunder) * RESOURCE_MULT;
    pay(p, gold);
    p.stats.damage += dmg;
    att.hp = Math.min(att.maxHp, att.hp + dmg * HUNTER.lifesteal);
    ev.push({ e: 'hit', x: v.x, y: v.y, dmg: Math.round(dmg), gold, by: p.id });
    if (v.hp <= 0) killUnit(st, v, p.id, ev);
    return;
  }
  const b = target.b!;
  if (b.invulnUntil > st.tick) {
    ev.push({ e: 'hit', x: b.cx + b.size / 2, y: b.cy + b.size / 2, dmg: 0, gold: 0, by: p.id });
    return;
  }
  if (b.packedUntil > st.tick) return;
  const def = buildingDef(b);
  // Glaciar: a veces el golpe no entra
  if (def.evasion && rand(st) < def.evasion) {
    ev.push({ e: 'miss', x: b.cx + b.size / 2, y: b.cy + b.size / 2 });
    return;
  }
  if (def.extraDamageTaken) raw += def.extraDamageTaken;
  if (def.flatReduce) raw = Math.max(1, raw - def.flatReduce);
  if (def.dmgTakenMult) raw *= def.dmgTakenMult;
  const dmg = Math.min(b.hp, raw * armorMult(def.armor + b.luckArmor + paladinAura(st, b.cx + b.size / 2, b.cy + b.size / 2)));
  b.hp -= dmg;
  // «Hacha del fin»: golpea al 100 % a los edificios enemigos alrededor
  const splash = att.kind === 'hunter' ? weaponSplash(p) : 0;
  if (splash > 0) {
    const bx = b.cx + b.size / 2;
    const by = b.cy + b.size / 2;
    for (const o of [...st.buildings]) {
      if (o === b || o.owner === p.id || distToRect(bx, by, o.cx, o.cy, o.size, o.size) > splash) continue;
      if (o.invulnUntil > st.tick || o.packedUntil > st.tick) continue;
      const od = buildingDef(o);
      const sd = Math.min(o.hp, s.dmg * armorMult(od.armor + o.luckArmor + paladinAura(st, o.cx + o.size / 2, o.cy + o.size / 2)));
      o.hp -= sd;
      const sg = Math.floor(sd * plunder) * RESOURCE_MULT;
      pay(p, sg);
      p.stats.damage += sd;
      if (o.hp <= 0.001) {
        razeBuilding(st, o, ev, true);
        giveXp(st, p, xpForKill(o.level), ev);
      }
    }
  }
  const gold = Math.floor(dmg * plunder) * RESOURCE_MULT;
  pay(p, gold);
  p.stats.damage += dmg;
  att.hp = Math.min(att.maxHp, att.hp + dmg * HUNTER.lifesteal);
  const owner = playerOf(st, b.owner);
  if (owner && def.goldPerHit && b.type === 'wall') earn(owner, def.goldPerHit);
  if (def.thorns) {
    att.hp -= def.thorns * armorMult(s.armor);
    if (att.hp <= 0) killUnit(st, att, b.owner, ev);
  }
  // Aleación: devuelve parte del golpe
  if (def.reflect && att.alive) {
    att.hp -= dmg * def.reflect;
    if (att.hp <= 0) killUnit(st, att, b.owner, ev);
  }
  // Cactus: al recibir daño, a veces estalla contra todo lo enemigo de alrededor
  if (def.burst && rand(st) < def.burst.chance) {
    const bx = b.cx + b.size / 2;
    const by = b.cy + b.size / 2;
    ev.push({ e: 'fx', a: 'fullforce', x: bx, y: by, r: def.burst.r, side: 'elf' });
    for (const o of st.units) {
      if (!o.alive || !FIGHTER_KINDS.includes(o.kind) || Math.hypot(o.x - bx, o.y - by) > def.burst.r) continue;
      const op = playerOf(st, o.owner);
      o.hp -= def.burst.dmg * (op ? armorMult(fighterStats(st, op, o).armor) : 1);
      if (o.hp <= 0) killUnit(st, o, b.owner, ev);
    }
  }
  ev.push({ e: 'hit', x: b.cx + b.size / 2, y: b.cy + b.size / 2, dmg: Math.round(dmg), gold, by: p.id });
  if (b.hp <= 0.001) {
    razeBuilding(st, b, ev, true);
    giveXp(st, p, xpForKill(b.level), ev);
  }
}

// ---------- comandos ----------

function canAct(st: HuntState, u: HuntUnit): boolean {
  return u.stunUntil <= st.tick;
}

function placeError(st: HuntState, map: HuntMap, g: Uint8Array, type: BuildingType, cx: number, cy: number): string | null {
  const size = BUILDINGS[type].size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = cx + i;
      const y = cy + j;
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) return 'Fuera del mapa';
      const c = y * map.w + x;
      if (map.noBuild[c]) return 'No puedes construir en la plaza del cazador';
      if (g[c]) return 'Ahí no se puede construir';
      // las unidades del bando del cazador estorban; las propias se apartan solas
      for (const u of st.units) {
        if (u.alive && (u.kind === 'hunter' || u.kind === 'wolf') && cell(u.x) === x && cell(u.y) === y) return 'Hay alguien en esa casilla';
      }
    }
  }
  return null;
}

function applyCommand(st: HuntState, map: HuntMap, playerId: string, cmd: HuntCommand, ev: HuntEvent[]): void {
  const p = playerOf(st, playerId);
  if (!p || st.over || !cmd || typeof cmd !== 'object') return;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  // elegir papel tras caer (no necesita unidad)
  if (cmd.k === 'wolves') {
    if (p.form !== 'hunter') return;
    p.allowWolves = cmd.allow === true;
    return;
  }
  if (cmd.k === 'form') {
    if (p.form !== 'choosing' || (cmd.f !== 'angel' && cmd.f !== 'wolf')) return;
    if (cmd.f === 'wolf' && !wolvesAllowed(st)) return reject(ev, playerId, 'El cazador no admite lobos');
    becomeRole(st, p, cmd.f, ev);
    return;
  }
  if (cmd.k === 'give') {
    const to = playerOf(st, cmd.to);
    if (!to || to === p || to.side !== p.side || !num(cmd.gold) || !num(cmd.wood)) return;
    const gold = Math.max(0, Math.min(p.gold, Math.floor(cmd.gold)));
    const wood = Math.max(0, Math.min(p.wood, Math.floor(cmd.wood)));
    p.gold -= gold;
    p.wood -= wood;
    to.gold = Math.min(GOLD_CAP, to.gold + gold);
    to.wood += wood;
    return;
  }
  if (cmd.k === 'market') {
    if (p.side !== 'elf') return;
    // en el original se comercia desde el Ayuntamiento (Town 1-3)
    if (techOf(st, playerId) < 2) return reject(ev, playerId, 'Necesitas un Ayuntamiento para comerciar');
    // lote de 200 = 20 lotes seguidos (el precio se mueve en cada uno)
    const lots = cmd.bulk ? 20 : 1;
    for (let i = 0; i < lots; i++) {
      if (cmd.buy) {
        const cost = st.market + MARKET.step;
        if (p.gold < cost) {
          if (i === 0) return reject(ev, playerId, 'No te alcanza el oro');
          break;
        }
        p.gold -= cost;
        p.wood += MARKET.lot;
        st.market = Math.min(MARKET.max, st.market + MARKET.step);
      } else {
        if (p.wood < MARKET.lot) {
          if (i === 0) return reject(ev, playerId, `Necesitas ${MARKET.lot} de madera`);
          break;
        }
        p.wood -= MARKET.lot;
        pay(p, st.market);
        st.market = Math.max(MARKET.min, st.market - MARKET.step);
      }
    }
    return;
  }
  // obreros: moverlos, mandarlos a reparar algo concreto o a un árbol
  if (cmd.k === 'worker' || cmd.k === 'sellunit') {
    const w = st.units.find((o) => o.id === cmd.id && o.alive && o.owner === playerId && (o.kind === 'repairer' || o.kind === 'lumberjack' || o.kind === 'beast' || o.kind === 'mage' || isSoldier(o.kind)));
    if (!w) return;
    const companion = w.kind === 'beast' || w.kind === 'mage' || isSoldier(w.kind);
    if (cmd.k === 'sellunit' && companion) return;
    const wg = huntBlockedGrid(st, map);
    const releaseTree = () => {
      if (w.tree >= 0 && st.treeTaken.get(w.tree) === w.id) st.treeTaken.delete(w.tree);
      w.tree = -1;
    };
    if (cmd.k === 'sellunit') {
      const def = (w.kind === 'repairer' ? REPAIRERS : LUMBERJACKS)[w.tier];
      releaseTree();
      w.alive = false;
      p.gold = Math.min(GOLD_CAP, p.gold + Math.floor(def.gold / 2));
      p.wood += Math.floor((def.wood ?? 0) / 2);
      ev.push({ e: 'bought', priv: playerId, text: `Vendido: ${def.name} (+${Math.floor(def.gold / 2)} de oro)` });
      return;
    }
    if (companion) {
      if (cmd.follow) {
        w.anchorX = -1;
        w.anchorY = -1;
        w.order = { k: 'idle' };
        w.path = [];
        return;
      }
      if (num(cmd.target)) {
        const mySide = sideOfOwner(st, w.owner);
        const tb = w.kind === 'beast' ? st.buildings.find((o) => o.id === cmd.target && sideOfOwner(st, o.owner) !== mySide) : undefined;
        const tu = st.units.find((o) => o.id === cmd.target && o.alive && sideOfOwner(st, o.owner) !== mySide);
        if (!tb && !tu) return;
        w.order = { k: 'attack', target: cmd.target };
        w.path = [];
        return;
      }
      if (!num(cmd.x) || !num(cmd.y) || cmd.x < 0 || cmd.y < 0 || cmd.x >= map.w || cmd.y >= map.h) return;
      w.anchorX = cmd.x;
      w.anchorY = cmd.y;
      w.order = { k: 'move' };
      routeTo(st, map, wg, w, pointGoal(cmd.x, cmd.y), { x: cmd.x, y: cmd.y });
      return;
    }
    if (num(cmd.target)) {
      const b = st.buildings.find((o) => o.id === cmd.target && sideOfOwner(st, o.owner) === 'elf');
      if (!b || w.kind !== 'repairer') return;
      w.work = b.id;
      w.anchorX = b.cx + b.size / 2;
      w.anchorY = b.cy + b.size / 2;
      w.order = { k: 'idle' };
      routeTo(st, map, wg, w, buildingGoal(b));
      return;
    }
    if (num(cmd.tree)) {
      if (w.kind !== 'lumberjack' || !isTreeAlive(st, map, cmd.tree)) return reject(ev, playerId, 'Ahí no hay un árbol vivo');
      const holder = st.treeTaken.get(cmd.tree);
      if (holder !== undefined && holder !== w.id) {
        const other = st.units.find((o) => o.id === holder && o.alive);
        if (other && other.owner !== playerId) return reject(ev, playerId, 'Ese árbol ya lo tala otro');
        if (other) other.tree = -1; // uno tuyo: le cede el árbol
      }
      releaseTree();
      w.tree = cmd.tree;
      st.treeTaken.set(cmd.tree, w.id);
      w.order = { k: 'idle' };
      const tx = cmd.tree % map.w;
      routeTo(st, map, wg, w, { x: tx, y: (cmd.tree - tx) / map.w, w: 1, h: 1, near: true });
      return;
    }
    if (!num(cmd.x) || !num(cmd.y) || cmd.x < 0 || cmd.y < 0 || cmd.x >= map.w || cmd.y >= map.h) return;
    releaseTree();
    w.work = 0;
    w.anchorX = cmd.x;
    w.anchorY = cmd.y;
    w.order = { k: 'move' };
    routeTo(st, map, wg, w, pointGoal(cmd.x, cmd.y), { x: cmd.x, y: cmd.y });
    return;
  }
  if (cmd.k === 'army') {
    const b = st.buildings.find((o) => o.id === cmd.id && o.owner === playerId && o.type === 'workshop');
    const def = SOLDIERS[cmd.kind];
    if (!b || !def || p.form !== 'elf') return;
    if (b.level < 5) return reject(ev, playerId, 'Solo la Fortaleza entrena el ejército');
    if (p.gold < def.gold) return reject(ev, playerId, 'No te alcanza el oro');
    if (p.wood < def.wood) return reject(ev, playerId, 'No te alcanza la madera');
    const f = foodOf(st, playerId);
    if (f.used + def.food > f.cap) return reject(ev, playerId, 'Te falta comida: mejora tu casa');
    p.gold -= def.gold;
    p.wood -= def.wood;
    const wg = huntBlockedGrid(st, map);
    let sx = b.cx + 0.5;
    let sy = b.cy + b.size + 0.5;
    outer: for (let r = 1; r <= 3; r++)
      for (let j = b.cy - r; j < b.cy + b.size + r; j++)
        for (let i = b.cx - r; i < b.cx + b.size + r; i++) {
          if (i < 0 || j < 0 || i >= map.w || j >= map.h || wg[j * map.w + i]) continue;
          sx = i + 0.5;
          sy = j + 0.5;
          break outer;
        }
    const s0 = newUnit(st, playerId, cmd.kind, sx, sy, def.hp);
    // como en el original, se queda donde la entrenas (clic derecho para moverla o que te siga)
    s0.anchorX = sx;
    s0.anchorY = sy;
    if (cmd.kind === 'owl') s0.invisUntil = Number.MAX_SAFE_INTEGER; // invisible siempre
    ev.push({ e: 'bought', priv: playerId, text: `⚔ ${def.name} listo` });
    return;
  }
  if (cmd.k === 'focus') {
    const b = st.buildings.find((o) => o.id === cmd.id && o.owner === playerId && o.type === 'tower');
    if (!b || !num(cmd.target)) return;
    b.focus = cmd.target;
    return;
  }
  if (cmd.k === 'upgrade' || cmd.k === 'demolish' || cmd.k === 'train') {
    const b = st.buildings.find((o) => o.id === cmd.id && o.owner === playerId);
    if (!b) return;
    if (cmd.k === 'upgrade') return upgradeBuilding(st, p, b, cmd.branch, ev);
    if (cmd.k === 'demolish') {
      if (b.hp < b.maxHp * 0.95) return reject(ev, playerId, 'Solo puedes venderlo con la vida casi entera');
      if (b.eyeUntil > st.tick) return reject(ev, playerId, 'El Ojo del cazador lo vigila: ahora no se puede vender');
      const hunterNear = st.units.some(
        (u) => u.alive && (u.kind === 'hunter' || u.kind === 'wolf') && distToRect(u.x, u.y, b.cx, b.cy, b.size, b.size) <= 9.4,
      );
      if (hunterNear) return reject(ev, playerId, 'Con el cazador cerca no se puede vender');
      // vender: se recupera la mitad de lo invertido
      const g2 = Math.floor(b.investGold / 2);
      const w2 = Math.floor(b.investWood / 2);
      razeBuilding(st, b, ev, false);
      p.gold = Math.min(GOLD_CAP, p.gold + g2);
      p.wood += w2;
      ev.push({ e: 'bought', priv: playerId, text: `Vendido: +${g2} de oro${w2 ? ` y +${w2} de madera` : ''}` });
      return;
    }
    return trainWorker(st, map, p, b, cmd.unit, cmd.tier, ev);
  }
  if (cmd.k === 'spec') {
    if (p.form !== 'elf' || p.spec || !SPECS[cmd.s]) return;
    p.spec = cmd.s;
    ev.push({ e: 'bought', priv: playerId, text: `📖 ${SPECS[cmd.s].name}` });
    return;
  }
  // muralla aleatoria: sortear armadura
  if (cmd.k === 'lots' || cmd.k === 'eat') {
    const b = st.buildings.find((o) => o.id === cmd.id && o.owner === playerId && o.type === 'wall');
    if (!b) return;
    const def = buildingDef(b);
    if (cmd.k === 'lots') {
      // sorteo ÚNICO de la aleatoria, a los 3 minutos: de −3 a +3 de armadura para siempre
      if (b.luckReady <= 0) return reject(ev, playerId, b.luckReady < 0 ? 'Ya sorteaste esta muralla' : 'Solo la muralla aleatoria sortea');
      if (b.luckReady > st.tick) return reject(ev, playerId, 'Aún no se puede sortear');
      b.luckArmor = WALL_LUCK_VALUES[Math.floor(rand(st) * WALL_LUCK_VALUES.length)];
      b.luckReady = -1;
      ev.push({ e: 'bought', priv: playerId, text: `🎲 Armadura ${b.luckArmor >= 0 ? '+' : ''}${b.luckArmor}` });
      return;
    }
    if (!def.eatsTree) return;
    if (b.eatUntil > st.tick) return reject(ev, playerId, 'Aún está digiriendo el anterior');
    let best = -1;
    let bestD = Infinity;
    for (let j = b.cy - 4; j <= b.cy + 4; j++)
      for (let i = b.cx - 4; i <= b.cx + 4; i++) {
        if (i < 0 || j < 0 || i >= map.w || j >= map.h) continue;
        const c = j * map.w + i;
        if (!isTreeAlive(st, map, c) || st.treeTaken.has(c)) continue;
        const d = Math.hypot(i - b.cx, j - b.cy);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    if (best < 0) return reject(ev, playerId, 'No hay ningún árbol libre a 4 casillas');
    st.deadTrees.set(best, st.tick + T(60));
    b.eatUntil = st.tick + T(30);
    b.eatRate = def.eatsTree / 30;
    ev.push({ e: 'treeeaten', x: (best % map.w) + 0.5, y: Math.floor(best / map.w) + 0.5 });
    return;
  }
  // 66 torres del misterio → Mago élfico
  if (cmd.k === 'mage') {
    if (p.form !== 'elf') return;
    const tops = st.buildings.filter((b) => b.owner === playerId && b.type === 'tower' && b.level >= levelsOf('tower'));
    if (tops.length < MAGE_FUSION_TOWERS) return reject(ev, playerId, `Necesitas ${MAGE_FUSION_TOWERS} torres del misterio`);
    const first = tops[0];
    for (const b of tops.slice(0, MAGE_FUSION_TOWERS)) razeBuilding(st, b, ev, false);
    const m = newUnit(st, playerId, 'mage', first.cx + 0.5, first.cy + 0.5, MAGE.hp);
    m.order = { k: 'follow' };
    ev.push({ e: 'mage', x: m.x, y: m.y, playerId });
    return;
  }

  const u = mainUnit(st, playerId);
  if (!u) return;
  const g = huntBlockedGrid(st, map);
  const inMap = (x: unknown, y: unknown) => num(x) && num(y) && x >= 0 && y >= 0 && x < map.w && y < map.h;
  const held = p.side === 'hunter' && u.kind === 'hunter' && st.tick < st.releaseTick;

  // la tienda de la guarida (cazador y lobos)
  if (cmd.k === 'buy' || cmd.k === 'buycons' || cmd.k === 'buywood' || cmd.k === 'sell' || cmd.k === 'hut' || cmd.k === 'buytrinket' || cmd.k === 'beast') {
    if (p.side !== 'hunter') return;
    const nearHut = shopNear(st, u.x, u.y, 'hunter');
    if (cmd.k === 'hut') {
      if (u.kind !== 'hunter') return;
      const next = HUT_LEVELS[st.hutLevel];
      if (!next) return reject(ev, playerId, 'La guarida ya está al máximo');
      if (p.gold < next.cost) return reject(ev, playerId, 'No te alcanza el oro');
      p.gold -= next.cost;
      st.hutLevel += 1;
      ev.push({ e: 'bought', priv: playerId, text: `🏚 Guarida nivel ${st.hutLevel}: +${next.income} oro/s` });
      return;
    }
    if (!nearHut) return reject(ev, playerId, 'Vuelve a tu guarida para comprar');
    if (cmd.k === 'beast') {
      if (u.kind !== 'hunter') return reject(ev, playerId, 'Solo el cazador puede llevar un rastreador');
      if (st.units.some((o) => o.kind === 'beast' && o.owner === playerId)) return reject(ev, playerId, 'Ya tienes un rastreador');
      if (p.wood < BEAST.wood) return reject(ev, playerId, `Necesitas ${BEAST.wood} de madera`);
      p.wood -= BEAST.wood;
      const b = newUnit(st, playerId, 'beast', map.camp.x + 0.5, map.camp.y + 3.5, BEAST.hp);
      b.order = { k: 'follow' };
      ev.push({ e: 'bought', priv: playerId, text: `${BEAST.name}` });
      return;
    }
    if (cmd.k === 'buytrinket') {
      const t = TRINKETS[cmd.t];
      if (!t) return;
      if (p.gold < t.gold || p.wood < t.wood) return reject(ev, playerId, 'No te alcanza');
      const free = p.inv.indexOf(null);
      if (free < 0) return reject(ev, playerId, 'Inventario lleno: vende algo');
      p.gold -= t.gold;
      p.wood -= t.wood;
      p.inv[free] = { kind: 'trinket', t: cmd.t };
      syncFighterHp(st, p, u);
      ev.push({ e: 'bought', priv: playerId, text: t.name });
      return;
    }
    if (cmd.k === 'buywood') {
      const cost = cmd.bulk ? WOOD_BULK.gold : WOOD_FOR_GOLD;
      if (p.gold < cost) return reject(ev, playerId, 'No te alcanza el oro');
      p.gold -= cost;
      p.wood += cmd.bulk ? WOOD_BULK.wood : 1;
      return;
    }
    if (cmd.k === 'sell') {
      if (!num(cmd.slot)) return;
      const it = p.inv[cmd.slot];
      if (!it) return;
      const price = it.kind === 'item' ? ITEMS[it.line].tiers[it.tier] : it.kind === 'trinket' ? TRINKETS[it.t] : CONSUMABLES[it.c];
      p.inv[cmd.slot] = null;
      p.gold = Math.min(GOLD_CAP, p.gold + Math.floor(price.gold / 2));
      p.wood += Math.floor(price.wood / 2);
      syncFighterHp(st, p, u);
      return;
    }
    if (cmd.k === 'buycons') {
      const c = CONSUMABLES[cmd.c];
      if (!c) return;
      if (p.gold < c.gold || p.wood < c.wood) return reject(ev, playerId, 'No te alcanza');
      // los libros se leen al comprarlos: no ocupan hueco
      if (cmd.c === 'bookstr' || cmd.c === 'bookagi') {
        p.gold -= c.gold;
        if (cmd.c === 'bookstr') p.str += 4000;
        else p.agi += 2000;
        syncFighterHp(st, p, u);
        ev.push({ e: 'bought', priv: playerId, text: c.name });
        return;
      }
      const free = p.inv.indexOf(null);
      if (free < 0) return reject(ev, playerId, 'Inventario lleno');
      p.gold -= c.gold;
      p.wood -= c.wood;
      p.inv[free] = { kind: 'cons', c: cmd.c, ...(cmd.c === 'voodoo' ? { uses: 2 } : {}) };
      ev.push({ e: 'bought', priv: playerId, text: `${c.name}` });
      return;
    }
    // objeto de una línea: se compra cualquier nivel; las copias se funden solas
    const line = ITEMS[cmd.line];
    if (!line || !num(cmd.tier) || cmd.tier < 0 || cmd.tier >= line.tiers.length) return;
    const tier = line.tiers[cmd.tier];
    if (p.gold < tier.gold || p.wood < tier.wood) return reject(ev, playerId, 'No te alcanza');
    // las botas van en su propio hueco (talento «inventario extra»)
    if (cmd.line === 'boots') {
      if (cmd.tier <= p.boots) return reject(ev, playerId, 'Ya llevas unas botas iguales o mejores');
      p.gold -= tier.gold;
      p.boots = cmd.tier;
      ev.push({ e: 'bought', priv: playerId, text: tier.name });
      return;
    }
    const copies = p.inv.filter((s) => s?.kind === 'item' && s.line === cmd.line && s.tier === cmd.tier).length;
    const next = line.tiers[cmd.tier + 1];
    const merges = next && next.merge > 0 && copies + 1 >= next.merge;
    if (p.inv.indexOf(null) < 0 && !merges) return reject(ev, playerId, 'Inventario lleno: vende algo');
    p.gold -= tier.gold;
    p.wood -= tier.wood;
    addItem(p, cmd.line, cmd.tier);
    syncFighterHp(st, p, u);
    ev.push({ e: 'bought', priv: playerId, text: `${tier.name}` });
    return;
  }

  if (cmd.k === 'use') {
    if (!num(cmd.slot)) return;
    const it = p.inv[cmd.slot];
    if (!it || it.kind !== 'cons' || it.c === 'ankh') return;
    if (u.silenceUntil > st.tick || !canAct(st, u)) return reject(ev, playerId, 'Ahora no puedes');
    if (it.c === 'scroll') {
      ev.push({ e: 'fx', a: 'scroll', x: u.x, y: u.y, side: p.side });
      u.x = map.camp.x + 0.5;
      u.y = map.camp.y + 2.5;
      u.path = [];
      u.order = { k: 'idle' };
    } else if (it.c === 'ward') {
      st.wards.push({ owner: playerId, x: num(cmd.x) ? cmd.x : u.x, y: num(cmd.y) ? cmd.y : u.y, until: st.tick + T(30) });
      ev.push({ e: 'fx', a: 'ward', x: u.x, y: u.y, side: p.side });
    } else if (it.c === 'potion') {
      u.immuneUntil = st.tick + T(15);
      ev.push({ e: 'fx', a: 'potion', x: u.x, y: u.y, side: p.side });
    } else if (it.c === 'speedscroll') {
      u.speedMaxUntil = st.tick + T(15);
    } else if (it.c === 'voodoo') {
      st.shops.push({ owner: playerId, x: num(cmd.x) ? cmd.x : u.x, y: num(cmd.y) ? cmd.y : u.y, until: st.tick + T(120) });
      ev.push({ e: 'fx', a: 'voodoo', x: u.x, y: u.y, side: p.side });
      if ((it.uses ?? 1) > 1) {
        it.uses = (it.uses ?? 1) - 1;
        return;
      }
    }
    p.inv[cmd.slot] = null;
    return;
  }

  if (cmd.k === 'ability') return castAbility(st, map, g, p, u, cmd, ev);

  // WASD: mientras haya una tecla pulsada manda la dirección y anula la orden
  if (cmd.k === 'steer') {
    const dx = Math.sign(Number(cmd.dx) || 0);
    const dy = Math.sign(Number(cmd.dy) || 0);
    // el cliente dice dónde estaba al cambiar de tecla. La red no tarda lo mismo
    // en llevar «pulsé» y «solté», así que sin esto al soltar el personaje
    // retrocede o da un tirón. Se acepta solo un ajuste pequeño, sin atravesar
    // nada y limitado por el tiempo (no sirve para correr más que nadie).
    if (num(cmd.x) && num(cmd.y) && !held && canAct(st, u) && u.rootUntil <= st.tick && u.channelEnd === 0 && (u.sx || u.sy)) {
      const d = Math.hypot(cmd.x - u.x, cmd.y - u.y);
      const budget = Math.min(0.9, (unitSpeed(st, u) / TICK_RATE) * (st.tick - u.claimAt) * 0.6);
      if (d > 0 && d <= budget && freeAt(map, g, cmd.x, cmd.y) && clearLine(g, map.w, map.h, u.x, u.y, cmd.x, cmd.y)) {
        u.x = cmd.x;
        u.y = cmd.y;
      }
      u.claimAt = st.tick;
    }
    u.sx = dx;
    u.sy = dy;
    if (dx || dy) {
      u.path = [];
      u.goal = null;
      u.dest = null;
      u.channelEnd = 0;
      if (u.order.k !== 'idle') u.order = { k: 'idle' };
    }
    return;
  }
  // cualquier otra orden de movimiento suelta el WASD
  if (cmd.k === 'move' || cmd.k === 'stop' || cmd.k === 'attack' || cmd.k === 'repair' || cmd.k === 'build') {
    u.sx = 0;
    u.sy = 0;
  }

  // a partir de aquí, órdenes de movimiento
  if (!canAct(st, u)) return;
  switch (cmd.k) {
    case 'move': {
      if (!inMap(cmd.x, cmd.y)) return;
      if (held) return reject(ev, playerId, 'Aún estás retenido en la guarida');
      u.channelEnd = 0;
      u.order = { k: 'move' };
      routeTo(st, map, g, u, pointGoal(cmd.x, cmd.y), { x: cmd.x, y: cmd.y });
      return;
    }
    case 'stop':
      u.dest = null;
      u.path = [];
      u.goal = null;
      u.order = { k: 'idle' };
      u.channelEnd = 0;
      return;
    case 'attack': {
      if (p.side !== 'hunter' || !num(cmd.target)) return;
      if (held) return reject(ev, playerId, 'Aún estás retenido en la guarida');
      const ok = st.buildings.some((b) => b.id === cmd.target) || st.units.some((o) => o.id === cmd.target && o.alive && sideOfOwner(st, o.owner) === 'elf');
      if (!ok) return;
      u.channelEnd = 0;
      u.order = { k: 'attack', target: cmd.target };
      u.path = [];
      u.goal = null;
      return;
    }
    case 'repair': {
      if ((u.kind !== 'angel' && u.kind !== 'elf') || !num(cmd.target)) return;
      const b = st.buildings.find((o) => o.id === cmd.target && sideOfOwner(st, o.owner) === 'elf');
      if (!b) return;
      u.order = { k: 'repair', target: b.id };
      routeTo(st, map, g, u, buildingGoal(b));
      return;
    }
    case 'build': {
      if (u.kind !== 'elf') return;
      const def = BUILDINGS[cmd.type];
      if (!def || !num(cmd.cx) || !num(cmd.cy) || !Number.isInteger(cmd.cx) || !Number.isInteger(cmd.cy)) return;
      const err = buildCheck(st, map, g, p, cmd.type, cmd.cx, cmd.cy);
      if (err) return reject(ev, playerId, err);
      u.order = { k: 'build', type: cmd.type, cx: cmd.cx, cy: cmd.cy };
      u.occultUntil = 0;
      routeTo(st, map, g, u, buildApproach(map, g, u, cmd.cx, cmd.cy, def.size));
      return;
    }
  }
}

// Desde dónde se construye. Si la obra toca una parcela (o es su puerta), el
// colono se coloca DENTRO: cerrar una puerta desde fuera te deja en la calle.
function buildApproach(map: HuntMap, g: Uint8Array, u: HuntUnit, cx: number, cy: number, size: number): NonNullable<HuntUnit['goal']> {
  const cand: [number, number, number][] = [];
  for (let j = cy - 1; j <= cy + size; j++)
    for (let i = cx - 1; i <= cx + size; i++) {
      if (i >= cx && i < cx + size && j >= cy && j < cy + size) continue;
      if (i < 0 || j < 0 || i >= map.w || j >= map.h || g[j * map.w + i]) continue;
      cand.push([i, j, map.plotOf[j * map.w + i]]);
    }
  const inside = cand.filter((c) => c[2] >= 0);
  const pool = inside.length > 0 ? inside : cand;
  if (pool.length === 0) return { x: cx, y: cy, w: size, h: size, near: true };
  pool.sort((a, b) => Math.hypot(a[0] + 0.5 - u.x, a[1] + 0.5 - u.y) - Math.hypot(b[0] + 0.5 - u.x, b[1] + 0.5 - u.y));
  return { x: pool[0][0], y: pool[0][1], w: 1, h: 1, near: false };
}

function buildCheck(st: HuntState, map: HuntMap, g: Uint8Array, p: HuntPlayer, type: BuildingType, cx: number, cy: number): string | null {
  const def = BUILDINGS[type];
  const have = st.buildings.filter((b) => b.owner === p.id && b.type === type).length;
  if (have >= def.limit) return def.limit === 1 ? `Solo puedes tener una ${def.name}` : `Máximo ${def.limit} de ${def.name}`;
  const lvl = levelDef(type, 1, null, 'main');
  const rq = reqError(st, p.id, lvl.req);
  if (rq) return rq;
  if (p.gold < lvl.gold) return 'No te alcanza el oro';
  if (p.wood < lvl.wood) return 'No te alcanza la madera';
  return placeError(st, map, g, type, cx, cy);
}

function addItem(p: HuntPlayer, line: ItemLine, tier: number): void {
  let t = tier;
  const free = p.inv.indexOf(null);
  if (free >= 0) p.inv[free] = { kind: 'item', line, tier: t };
  // fusión en cascada: N copias de un nivel → 1 del siguiente
  for (;;) {
    const next = ITEMS[line].tiers[t + 1];
    if (!next || next.merge <= 0) break;
    const slots = p.inv.map((s, i) => (s?.kind === 'item' && s.line === line && s.tier === t ? i : -1)).filter((i) => i >= 0);
    if (slots.length < next.merge) break;
    for (const i of slots.slice(0, next.merge)) p.inv[i] = null;
    t += 1;
    p.inv[p.inv.indexOf(null)] = { kind: 'item', line, tier: t };
  }
}

function upgradeBuilding(st: HuntState, p: HuntPlayer, b: HuntBuilding, branch: string | undefined, ev: HuntEvent[]): void {
  if (b.level >= levelsOf(b.type) || (b.type === 'wall' && b.level >= wallMaxLevel(b.wallBranch))) return reject(ev, p.id, 'Ya está al máximo');
  let wallBranch = b.wallBranch;
  let towerBranch = b.towerBranch;
  let lucky = false;
  if (b.type === 'wall' && b.level === 5) {
    if (!branch || !(branch in WALL_BRANCHES)) return reject(ev, p.id, 'Elige una especialidad para la muralla');
    if (WALL_BRANCHES[branch as WallBranch].hidden) return reject(ev, p.id, 'Esa muralla solo sale de la aleatoria');
    wallBranch = branch as WallBranch;
    // aleatoria: se convierte YA en el nivel 6 de una rama al azar (puede salir oro)
    if (wallBranch === 'random') {
      wallBranch = WALL_RANDOM_POOL[Math.floor(rand(st) * WALL_RANDOM_POOL.length)];
      lucky = true;
    }
  }
  if (b.type === 'tower' && b.level === 2 && branch === 'gold') towerBranch = 'gold';
  let step = 1;
  if (b.type === 'tower') {
    if (b.level === TOWER_GREEN_FINAL) return reject(ev, p.id, 'El Dragón verde es el final de su rama');
    const fork = TOWER_FORKS[b.level];
    if (fork) {
      const pick = fork.find((f) => f.branch === branch) ?? (b.level === 11 ? fork[0] : undefined);
      if (!pick) return reject(ev, p.id, `Elige: ${fork.map((f) => f.name).join(' o ')}`);
      step = pick.level - b.level;
    }
  }
  const next = levelDef(b.type, b.level + step, wallBranch, towerBranch);
  const rq = reqError(st, p.id, next.req);
  if (rq) return reject(ev, p.id, rq);
  if (p.gold < next.gold) return reject(ev, p.id, 'No te alcanza el oro');
  if (p.wood < next.wood) return reject(ev, p.id, 'No te alcanza la madera');
  p.gold -= next.gold;
  p.wood -= next.wood;
  const frac = b.hp / b.maxHp;
  b.level += step;
  b.wallBranch = wallBranch;
  b.towerBranch = towerBranch;
  if (lucky) {
    b.luckReady = st.tick + T(WALL_LUCK_SEC);
    ev.push({ e: 'bought', priv: p.id, text: `🎲 La aleatoria salió: ${WALL_BRANCHES[wallBranch!].name}` });
  }
  b.maxHp = next.hp;
  b.hp = Math.max(1, next.hp * frac);
  b.investGold += next.gold;
  b.investWood += next.wood;
  ev.push({ e: 'upgraded', x: b.cx + b.size / 2, y: b.cy + b.size / 2, level: b.level, name: next.name });
}

function trainWorker(st: HuntState, map: HuntMap, p: HuntPlayer, b: HuntBuilding, kind: 'repairer' | 'lumberjack', tier: number, ev: HuntEvent[]): void {
  if (p.form !== 'elf' || typeof tier !== 'number' || !Number.isInteger(tier)) return;
  const table = kind === 'repairer' ? REPAIRERS : LUMBERJACKS;
  const def = table[tier];
  if (!def) return;
  if (kind === 'repairer' && b.type !== 'workshop') return;
  if (kind === 'lumberjack' && b.type !== 'elftree') return;
  const rq = reqError(st, p.id, def.req);
  if (rq) return reject(ev, p.id, rq);
  if (p.gold < def.gold) return reject(ev, p.id, 'No te alcanza el oro');
  if (p.wood < (def.wood ?? 0)) return reject(ev, p.id, 'No te alcanza la madera');
  if (def.food > 0) {
    const f = foodOf(st, p.id);
    if (f.used + def.food > f.cap) return reject(ev, p.id, 'Te falta comida: mejora tu casa');
  }
  if (kind === 'repairer') {
    /* sin más límites */
  } else if (st.units.filter((u) => u.alive && u.owner === p.id && u.kind === 'lumberjack').length >= MAX_LUMBERJACKS) {
    return reject(ev, p.id, `Máximo ${MAX_LUMBERJACKS} leñadores`);
  }
  p.gold -= def.gold;
  p.wood -= def.wood ?? 0;
  // aparece junto al edificio, en la primera casilla libre
  const g = huntBlockedGrid(st, map);
  let sx = b.cx + 0.5;
  let sy = b.cy + b.size + 0.5;
  outer: for (let r = 1; r <= 3; r++) {
    for (let j = b.cy - r; j < b.cy + b.size + r; j++)
      for (let i = b.cx - r; i < b.cx + b.size + r; i++) {
        if (i < 0 || j < 0 || i >= map.w || j >= map.h || g[j * map.w + i]) continue;
        sx = i + 0.5;
        sy = j + 0.5;
        break outer;
      }
  }
  newUnit(st, p.id, kind, sx, sy, def.hp, tier);
  ev.push({ e: 'bought', priv: p.id, text: `${def.name}` });
}

// ¿algún cazador vivo admite lobos?
export function wolvesAllowed(st: HuntState): boolean {
  return st.players.some((q) => q.form === 'hunter' && q.alive && q.allowWolves !== false);
}

function becomeRole(st: HuntState, p: HuntPlayer, f: 'angel' | 'wolf', ev: HuntEvent[]): void {
  const map = getHuntMap();
  p.form = f;
  p.side = f === 'wolf' ? 'hunter' : 'elf';
  p.cds = {};
  p.mana = MANA[f].max;
  if (f === 'angel') {
    const u = newUnit(st, p.id, 'angel', map.angelSpawn.x + 0.5, map.angelSpawn.y + 0.5, ANGEL.hp);
    u.invulnUntil = st.tick + T(ANGEL.invulnOnSpawnSec);
  } else {
    p.gold = wolfStartGold(huntMinute(st));
    p.level = 1;
    p.xp = 0;
    p.inv = new Array(INVENTORY_SLOTS).fill(null);
    newUnit(st, p.id, 'wolf', map.camp.x + 1.5, map.camp.y + 2.5, HUNTER.hp);
  }
  ev.push({ e: 'form', playerId: p.id, name: p.name, form: f });
}

function castAbility(
  st: HuntState,
  map: HuntMap,
  g: Uint8Array,
  p: HuntPlayer,
  u: HuntUnit,
  cmd: Extract<HuntCommand, { k: 'ability' }>,
  ev: HuntEvent[],
): void {
  const a = cmd.a;
  const def = ABILITIES[a];
  const form = p.form as Form;
  const allowed = FORM_ABILITIES[form]?.includes(a) || (form === 'elf' && !!p.spec && SPEC_ABILITY[p.spec] === a);
  if (!def || !allowed) return;
  if ((p.cds[a] ?? 0) > st.tick) return reject(ev, p.id, `${def.name} aún se está recargando`);
  if ((def.mana ?? 0) > (p.mana ?? 0)) return reject(ev, p.id, `No tienes maná suficiente (${def.mana})`);
  if (u.silenceUntil > st.tick) return reject(ev, p.id, 'Estás silenciado');
  if (!canAct(st, u)) return;
  if (u.kind === 'hunter' && st.tick < st.releaseTick && a !== 'eye') return reject(ev, p.id, 'Aún estás retenido en la guarida');
  const tx = typeof cmd.x === 'number' && Number.isFinite(cmd.x) ? cmd.x : u.x;
  const ty = typeof cmd.y === 'number' && Number.isFinite(cmd.y) ? cmd.y : u.y;
  if (def.target === 'point' && Math.hypot(tx - u.x, ty - u.y) > (def.range ?? 0) + 0.5) return reject(ev, p.id, 'Demasiado lejos');
  const dur = T(def.dur ?? 0);
  // la magia de los colonos no afecta a quien sea inmune (escudo, poción, mercurio)
  const enemiesOfElves = (x: number, y: number, r: number) =>
    st.units.filter((o) => o.alive && FIGHTER_KINDS.includes(o.kind) && !magicImmune(st, o) && Math.hypot(o.x - x, o.y - y) <= r);
  switch (a) {
    case 'blink':
    case 'angelblink': {
      const cx = cell(tx);
      const cy = cell(ty);
      if (cx < 0 || cy < 0 || cx >= map.w || cy >= map.h || g[cy * map.w + cx]) return reject(ev, p.id, 'No puedes saltar ahí');
      ev.push({ e: 'fx', a, x: u.x, y: u.y, tx: cx + 0.5, ty: cy + 0.5, side: p.side });
      if (a === 'blink' && p.spec === 'blinkex') u.blinkFrom = { x: u.x, y: u.y, until: st.tick + T(10) };
      u.x = cx + 0.5;
      u.y = cy + 0.5;
      u.path = [];
      u.goal = null;
      break;
    }
    case 'blinkback': {
      if (!u.blinkFrom || u.blinkFrom.until < st.tick) return reject(ev, p.id, 'Solo justo después de un Salto');
      ev.push({ e: 'fx', a: 'blink', x: u.x, y: u.y, tx: u.blinkFrom.x, ty: u.blinkFrom.y, side: p.side });
      u.x = u.blinkFrom.x;
      u.y = u.blinkFrom.y;
      u.blinkFrom = null;
      u.path = [];
      p.cds.blink = 0;
      p.cds.haste = 0;
      break;
    }
    case 'angelhaste':
      u.hasteUntil = st.tick + dur;
      break;
    case 'blind':
      for (const o of enemiesOfElves(tx, ty, def.radius ?? 2.3)) o.missUntil = st.tick + dur;
      ev.push({ e: 'fx', a, x: tx, y: ty, r: def.radius, side: p.side });
      break;
    case 'moonlight':
      st.nightUntil = st.tick + dur;
      ev.push({ e: 'fx', a, x: u.x, y: u.y, r: 3, side: p.side });
      break;
    case 'fullforce': {
      const r = def.radius ?? 2.3;
      for (const o of st.units) if (o.alive && sideOfOwner(st, o.owner) === 'elf' && Math.hypot(o.x - tx, o.y - ty) <= r) o.forceUntil = st.tick + dur;
      for (const b of st.buildings)
        if (sideOfOwner(st, b.owner) === 'elf' && Math.hypot(b.cx + b.size / 2 - tx, b.cy + b.size / 2 - ty) <= r + b.size / 2) b.forceUntil = st.tick + dur;
      ev.push({ e: 'fx', a, x: tx, y: ty, r, side: p.side });
      break;
    }
    case 'pack': {
      const house = houseOf(st, p.id);
      if (!house) return reject(ev, p.id, 'No tienes casa que empaquetar');
      house.packedUntil = st.tick + dur;
      ev.push({ e: 'fx', a, x: house.cx + 1, y: house.cy + 1, side: p.side });
      break;
    }
    case 'retrofit': {
      const b = st.buildings.find((o) => o.id === cmd.target && o.owner === p.id && o.type === 'tower');
      if (!b) return reject(ev, p.id, 'Elige una torre tuya');
      if (b.retro >= 5) return reject(ev, p.id, 'Esa torre ya está remodelada al máximo');
      b.retro += 1;
      ev.push({ e: 'fx', a, x: b.cx + 0.5, y: b.cy + 0.5, side: p.side });
      break;
    }
    case 'ams':
    case 'wolfams': {
      u.immuneUntil = st.tick + dur;
      if (a === 'wolfams') for (const o of st.units) if (o.alive && o.kind === 'hunter' && Math.hypot(o.x - u.x, o.y - u.y) <= 4) o.immuneUntil = st.tick + dur;
      ev.push({ e: 'fx', a, x: u.x, y: u.y, side: p.side });
      break;
    }
    case 'detect': {
      const r = def.radius ?? 12;
      st.eyes.push({ side: p.side, detect: true, x: tx, y: ty, r, until: st.tick + dur });
      ev.push({ e: 'fx', a: 'eye', x: tx, y: ty, r, side: p.side });
      break;
    }
    case 'bloodlust':
      for (const o of st.units) if (o.alive && FIGHTER_KINDS.includes(o.kind) && Math.hypot(o.x - u.x, o.y - u.y) <= 3) o.bloodlustUntil = st.tick + dur;
      ev.push({ e: 'fx', a, x: u.x, y: u.y, r: 3, side: p.side });
      break;
    case 'occult': {
      const ally = st.units.find((o) => o.alive && sideOfOwner(st, o.owner) === 'elf' && Math.hypot(o.x - tx, o.y - ty) <= (def.radius ?? 1.2));
      if (!ally) return reject(ev, p.id, 'Apunta a un aliado');
      ally.occultUntil = st.tick + dur;
      ev.push({ e: 'fx', a, x: ally.x, y: ally.y, side: p.side });
      break;
    }
    case 'haste':
      // Prisa EX: velocidad máxima 5 s y recarga de 1 s
      u.hasteUntil = st.tick + (p.spec === 'hasteex' ? T(5) : dur);
      if (p.spec === 'hasteex') {
        p.cds.haste = st.tick + T(1);
        ev.push({ e: 'fx', a, x: u.x, y: u.y, side: p.side });
        return;
      }
      break;
    case 'run':
      u.hasteUntil = st.tick + dur;
      break;
    case 'roots':
      for (const o of enemiesOfElves(tx, ty, def.radius ?? 2)) o.rootUntil = st.tick + dur;
      ev.push({ e: 'fx', a, x: tx, y: ty, r: def.radius, side: p.side });
      break;
    case 'silence':
      for (const o of enemiesOfElves(tx, ty, def.radius ?? 2)) {
        o.silenceUntil = st.tick + dur;
        o.channelEnd = 0;
      }
      ev.push({ e: 'fx', a, x: tx, y: ty, r: def.radius, side: p.side });
      break;
    case 'stun': {
      const hit = enemiesOfElves(tx, ty, def.radius ?? 1.5);
      if (!hit.length) return reject(ev, p.id, 'No hay ningún enemigo ahí');
      for (const o of hit) o.stunUntil = st.tick + dur;
      ev.push({ e: 'fx', a, x: tx, y: ty, r: def.radius, side: p.side });
      break;
    }
    case 'moonguard':
    case 'holylight': {
      // el Guardián es para lo propio; la Luz sagrada vale para cualquier aliado
      const b = st.buildings.find((o) => o.id === cmd.target && (o.owner === p.id || (a === 'holylight' && sideOfOwner(st, o.owner) === 'elf')));
      if (!b) return reject(ev, p.id, a === 'holylight' ? 'Elige un edificio aliado' : 'Elige un edificio tuyo');
      if (distToRect(u.x, u.y, b.cx, b.cy, b.size, b.size) > (def.range ?? 3) + 0.5) return reject(ev, p.id, 'Demasiado lejos');
      if (a === 'moonguard') {
        // original (ZLx): 10 s sobre tu muralla de nivel máximo, 6 s sobre lo demás,
        // ×1,2 en la élfica; entre 5 y 15 s
        const top = Math.max(0, ...st.buildings.filter((o) => o.owner === p.id && o.type === 'wall').map((o) => o.level));
        let secs = b.type === 'wall' && b.level >= top ? 10 : 6;
        if (b.wallBranch === 'elf') secs *= 1.2;
        b.invulnUntil = st.tick + T(Math.max(5, Math.min(15, secs)));
      }
      else b.hp = Math.min(b.maxHp, b.hp + 10 + (b.maxHp - b.hp) * 0.35);
      ev.push({ e: 'fx', a, x: b.cx + b.size / 2, y: b.cy + b.size / 2, side: p.side });
      break;
    }
    case 'windwalk':
      u.invisUntil = st.tick + dur;
      break;
    case 'berserk':
      u.berserkUntil = st.tick + dur;
      break;
    case 'eye': {
      const r = def.radius ?? 14;
      st.eyes.push({ side: p.side, x: tx, y: ty, r, until: st.tick + dur });
      for (const b of st.buildings) if (Math.hypot(b.cx + 0.5 - tx, b.cy + 0.5 - ty) <= r) b.eyeUntil = st.tick + dur;
      ev.push({ e: 'fx', a, x: tx, y: ty, r, side: p.side });
      break;
    }
    case 'trap':
      st.traps.push({ id: st.nextId++, owner: p.id, x: tx, y: ty, until: st.tick + T(300) });
      break;
    case 'recall': {
      u.path = [];
      u.goal = null;
      u.order = { k: 'idle' };
      u.channelEnd = st.tick + dur;
      // «Transmisión»: si señalas a un aliado (otro troll o un lobo), vas con él
      u.recallTo = 0;
      if (Number.isFinite(cmd.x) && Number.isFinite(cmd.y)) {
        const ally = st.units.find(
          (o) => o !== u && o.alive && (o.kind === 'hunter' || o.kind === 'wolf') && sideOfOwner(st, o.owner) === 'hunter' && Math.hypot(o.x - cmd.x!, o.y - cmd.y!) <= 1.2,
        );
        if (ally) u.recallTo = ally.id;
      }
      break;
    }
    case 'steal': {
      if (Math.hypot(u.x - (map.camp.x + 0.5), u.y - (map.camp.y + 0.5)) > (def.range ?? 2.5) + 0.5) return reject(ev, p.id, 'Acércate a la guarida del cazador');
      const gold = goldUnit(huntMinute(st)) * RESOURCE_MULT;
      pay(p, gold);
      ev.push({ e: 'steal', x: u.x, y: u.y, gold });
      break;
    }
    case 'holyarmor':
      u.invulnUntil = st.tick + dur;
      break;
    case 'howl':
      for (const b of st.buildings) if (b.type === 'tower' && Math.hypot(b.cx + 0.5 - u.x, b.cy + 0.5 - u.y) <= (def.radius ?? 7)) b.howlUntil = st.tick + dur;
      ev.push({ e: 'fx', a, x: u.x, y: u.y, r: def.radius, side: p.side });
      break;
  }
  p.cds[a] = st.tick + T(def.cd);
  p.mana = (p.mana ?? 0) - (def.mana ?? 0);
}

// ---------- un tick ----------

// ¿cabe una unidad (radio STEER_R) en (x, y)?
const STEER_R = 0.3;
function freeAt(map: HuntMap, g: Uint8Array, x: number, y: number): boolean {
  for (const [ox, oy] of [[-STEER_R, -STEER_R], [STEER_R, -STEER_R], [-STEER_R, STEER_R], [STEER_R, STEER_R]]) {
    const cx = cell(x + ox);
    const cy = cell(y + oy);
    if (cx < 0 || cy < 0 || cx >= map.w || cy >= map.h || g[cy * map.w + cx]) return false;
  }
  return true;
}

// cuánto se mete un círculo de radio STEER_R en casillas bloqueadas (0 = libre)
function overlapAt(map: HuntMap, g: Uint8Array, x: number, y: number): number {
  let o = 0;
  for (let cy = Math.floor(y - STEER_R); cy <= Math.floor(y + STEER_R); cy++)
    for (let cx = Math.floor(x - STEER_R); cx <= Math.floor(x + STEER_R); cx++) {
      if (cx >= 0 && cy >= 0 && cx < map.w && cy < map.h && !g[cy * map.w + cx]) continue;
      const dx = Math.max(cx - x, 0, x - (cx + 1));
      const dy = Math.max(cy - y, 0, y - (cy + 1));
      o += Math.max(0, STEER_R - Math.hypot(dx, dy));
    }
  return o;
}

// Movimiento directo con WASD: avanza en la dirección y se desliza por las
// paredes. Si roza una esquina (p. ej. al entrar por una puerta de 1 casilla
// sin ir perfectamente centrado), se le empuja de lado hacia el hueco, como en
// cualquier juego de acción. Si por lo que sea ya está algo metido en algo
// bloqueado, solo puede moverse a donde esté MENOS metido (nunca atravesar).
export function steerStep(map: HuntMap, g: Uint8Array, x: number, y: number, sx: number, sy: number, dist: number): { x: number; y: number } {
  const k = sx && sy ? Math.SQRT1_2 : 1;
  const nx = x + sx * k * dist;
  const ny = y + sy * k * dist;
  const o0 = overlapAt(map, g, x, y);
  if (o0 > 0) {
    // atascado: aceptar el paso solo si reduce el solape (sale), probando ejes
    for (const [tx, ty] of [[nx, ny], [nx, y], [x, ny]] as const) if (overlapAt(map, g, tx, ty) < o0 - 1e-6) return { x: tx, y: ty };
    return { x, y };
  }
  if (freeAt(map, g, nx, ny)) return { x: nx, y: ny };
  if (sx && sy) {
    // diagonal contra una pared: deslizar por el eje que quede libre
    if (freeAt(map, g, nx, y)) return { x: nx, y };
    if (freeAt(map, g, x, ny)) return { x, y: ny };
  } else {
    // recto contra una esquina: buscar el hueco a cada lado (hasta media casilla)
    // y empujar hacia él, sin dejar de avanzar si ya cabe
    for (const d of [0.1, 0.2, 0.3, 0.4, 0.5]) {
      for (const side of [1, -1]) {
        const px = sy ? x + side * d : x;
        const py = sx ? y + side * d : y;
        if (!freeAt(map, g, px, py)) continue;
        if (!freeAt(map, g, px + sx * dist, py + sy * dist)) continue;
        // empuje lateral limitado a la distancia del paso
        const push = Math.min(d, dist);
        const ax = sy ? x + side * push : x;
        const ay = sx ? y + side * push : y;
        if (freeAt(map, g, ax, ay)) return { x: ax, y: ay };
      }
    }
  }
  // pegado a la pared: acercarse lo que quepa
  for (let f = 0.75; f > 0.05; f -= 0.25) {
    const fx = x + sx * k * dist * f;
    const fy = y + sy * k * dist * f;
    if (freeAt(map, g, fx, fy)) return { x: fx, y: fy };
  }
  return { x, y };
}

function moveUnit(st: HuntState, map: HuntMap, g: Uint8Array, u: HuntUnit): void {
  if (u.rootUntil > st.tick || u.stunUntil > st.tick || u.channelEnd > 0) return;
  let budget = unitSpeed(st, u) / TICK_RATE;
  if ((u.sx || u.sy) && u.path.length === 0) {
    const p = steerStep(map, g, u.x, u.y, u.sx, u.sy, budget);
    u.x = p.x;
    u.y = p.y;
    return;
  }
  while (budget > 0 && u.path.length > 0) {
    const [cx, cy] = u.path[0];
    if (g[cy * map.w + cx] && u.kind !== 'owl') {
      // alguien construyó en el camino: recalcular
      if (u.goal && st.tick >= u.repathAt) routeTo(st, map, g, u, u.goal, u.dest);
      else u.path = [];
      return;
    }
    // el último tramo de una orden de mover termina en el punto exacto pinchado
    const last = u.path.length === 1 && u.dest && cell(u.dest.x) === cx && cell(u.dest.y) === cy;
    const px = last ? u.dest!.x : cx + 0.5;
    const py = last ? u.dest!.y : cy + 0.5;
    const dx = px - u.x;
    const dy = py - u.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      u.x = px;
      u.y = py;
      budget -= d;
      u.path.shift();
    } else {
      u.x += (dx / d) * budget;
      u.y += (dy / d) * budget;
      budget = 0;
    }
  }
}

function stepFighter(st: HuntState, map: HuntMap, g: Uint8Array, u: HuntUnit, p: HuntPlayer, ev: HuntEvent[]): void {
  // regreso canalizado
  if (u.channelEnd > 0 && st.tick >= u.channelEnd) {
    u.channelEnd = 0;
    ev.push({ e: 'fx', a: 'recall', x: u.x, y: u.y, side: 'hunter' });
    const ally = u.recallTo ? st.units.find((o) => o.id === u.recallTo && o.alive) : undefined;
    u.recallTo = 0;
    if (ally) {
      u.x = ally.x;
      u.y = ally.y;
    } else {
      u.x = map.camp.x + 0.5;
      u.y = map.camp.y + 2.5;
    }
    u.path = [];
    u.order = { k: 'idle' };
  }
  if (u.atkCd > 0) u.atkCd -= 1;
  if (u.focus > 0 && st.tick > u.focusUntil) u.focus = 0;
  const released = u.kind !== 'hunter' || st.tick >= st.releaseTick;
  const busy = !released || u.channelEnd > 0 || u.stunUntil > st.tick || u.rootUntil > st.tick;
  if (!busy) {
    const hx = cell(u.x);
    const hy = cell(u.y);
    let tb: HuntBuilding | undefined;
    let tu: HuntUnit | undefined;
    if (u.order.k === 'attack') {
      const id = u.order.target;
      tb = st.buildings.find((b) => b.id === id);
      tu = tb ? undefined : st.units.find((o) => o.id === id && o.alive);
      if (!tb && !tu) u.order = { k: 'idle' };
    }
    // parado: golpea lo que tenga pegado (primero las unidades)
    if (u.order.k === 'idle' && u.path.length === 0) {
      tu = st.units.find(
        (o) => o.alive && sideOfOwner(st, o.owner) === 'elf' && o.invulnUntil <= st.tick && Math.hypot(o.x - u.x, o.y - u.y) <= 1.3,
      );
      if (!tu) {
        tb = st.buildings
          .filter((b) => touchesBuilding(u, b))
          .sort((a, b) => a.hp - b.hp || a.id - b.id)[0];
      }
    }
    // un colono que se cruza pegado al cazador cae aunque vaya a otra cosa
    if (!tu && u.order.k !== 'attack') {
      const passer = st.units.find(
        (o) => o.alive && (o.kind === 'elf' || o.kind === 'repairer' || o.kind === 'lumberjack') && o.invulnUntil <= st.tick && Math.hypot(o.x - u.x, o.y - u.y) < 0.9,
      );
      if (passer) {
        tu = passer;
        tb = undefined;
      }
    }
    if (tb || tu) {
      const touching = tb ? touchesBuilding(u, tb) : Math.hypot(tu!.x - u.x, tu!.y - u.y) <= 1.3;
      if (touching) {
        if (u.order.k === 'attack') u.path = [];
        if (u.atkCd <= 0) strike(st, u, p, tb ? { b: tb } : { u: tu }, ev);
      } else if (u.order.k === 'attack' && (u.path.length === 0 || st.tick >= u.repathAt)) {
        routeTo(st, map, g, u, tb ? buildingGoal(tb) : pointGoal(tu!.x, tu!.y));
      }
    }
    void hx;
    void hy;
    moveUnit(st, map, g, u);
  }
  // regeneración propia y de la guarida
  const s = fighterStats(st, p, u);
  let regen = s.regen;
  if (Math.hypot(u.x - (map.camp.x + 0.5), u.y - (map.camp.y + 0.5)) <= HUT_RADIUS + 1) regen += u.maxHp * HUT_REGEN;
  for (const w of st.wards) if (w.until > st.tick && sideOfOwner(st, w.owner) === 'hunter' && Math.hypot(w.x - u.x, w.y - u.y) <= 5) regen += u.maxHp * 0.01;
  u.hp = Math.min(u.maxHp, u.hp + regen / TICK_RATE);
}

// Rastreador (bando del cazador) y Mago élfico (bando de los colonos): van con su
// amo, atacan lo que ataca él o lo que tengan cerca, y vuelven si se alejan.
// habilidades del Rastreador (las lanza solo): antimagia si lo inmovilizan,
// olfato (descubre invisibles alrededor), red al colono más cercano y paso del
// viento cuando persigue algo lejano
function beastSkills(st: HuntState, u: HuntUnit, ev: HuntEvent[]): void {
  const B = BEAST;
  if ((u.stunUntil > st.tick || u.rootUntil > st.tick) && (u.ready.ams ?? 0) <= st.tick) {
    u.stunUntil = 0;
    u.rootUntil = 0;
    u.immuneUntil = st.tick + T(B.ams.dur);
    u.ready.ams = st.tick + T(B.ams.cd);
    ev.push({ e: 'fx', a: 'ams', x: u.x, y: u.y, side: 'hunter' });
  }
  if ((u.ready.detect ?? 0) <= st.tick) {
    st.eyes.push({ side: 'hunter', detect: true, x: u.x, y: u.y, r: B.detect.r, until: st.tick + T(B.detect.dur) });
    u.ready.detect = st.tick + T(B.detect.cd);
  }
  if ((u.ready.ensnare ?? 0) <= st.tick && u.stunUntil <= st.tick) {
    let prey: HuntUnit | undefined;
    let best = B.ensnare.range;
    for (const o of st.units) {
      if (!o.alive || sideOfOwner(st, o.owner) !== 'elf' || o.kind === 'angel' || o.invulnUntil > st.tick || !detected(st, o) || magicImmune(st, o)) continue;
      const d = Math.hypot(o.x - u.x, o.y - u.y);
      if (d <= best) {
        best = d;
        prey = o;
      }
    }
    if (prey) {
      prey.rootUntil = st.tick + T(B.ensnare.dur);
      u.ready.ensnare = st.tick + T(B.ensnare.cd);
      ev.push({ e: 'fx', a: 'roots', x: prey.x, y: prey.y, r: 0.8, side: 'hunter' });
    }
  }
}

// golpe/disparo de una unidad del ejército élfico al cazador, un lobo o el Rastreador
function soldierAttack(st: HuntState, u: HuntUnit, d: (typeof SOLDIERS)[SoldierKind], tu: HuntUnit, ev: HuntEvent[]): void {
  const fp = playerOf(st, tu.owner);
  const fs = fp ? fighterStats(st, fp, tu) : undefined;
  let raw = d.dmg * (u.roarUntil > st.tick ? 1 + SOLDIER_SKILLS.clawRoar.bonus : 1);
  let fx = 'mage';
  if (u.kind === 'bladecar' && rand(st) < SOLDIER_SKILLS.carCrit.chance) {
    raw *= SOLDIER_SKILLS.carCrit.mult;
    fx = 'chain';
  }
  // rompemagia: quema maná y hace daño por cada punto quemado
  if (u.kind === 'breaker' && fp) {
    const burn = Math.min(SOLDIER_SKILLS.breakerBurn, fp.mana ?? 0);
    fp.mana = (fp.mana ?? 0) - burn;
    raw += burn * 4;
  }
  let dmg = Math.max(0, raw - (fs?.block ?? 0)) * armorMult(fs?.armor ?? 0);
  if (tu.berserkUntil > st.tick) dmg *= 1.5;
  if (tu.invulnUntil > st.tick) dmg = 0;
  tu.hp -= dmg;
  if (u.kind === 'warder' && dmg > 0) {
    tu.dotUntil = st.tick + T(SOLDIER_SKILLS.warderPoison.dur);
    tu.dotDps = Math.max(tu.dotDps, SOLDIER_SKILLS.warderPoison.dps);
    tu.chillUntil = st.tick + T(SOLDIER_SKILLS.warderPoison.dur);
    fx = 'poison';
  }
  u.atkCd = T(d.cd);
  u.actUntil = st.tick + T(0.6);
  u.actX = tu.x;
  u.actY = tu.y;
  ev.push({ e: 'shot', x: u.x, y: u.y, tx: tu.x, ty: tu.y, dmg: Math.round(dmg), gold: false, fx });
  if (tu.hp <= 0) killUnit(st, tu, u.owner, ev);
  // cazadora elfa: la hoja lunar rebota a otro enemigo cercano (a la mitad)
  if (u.kind === 'elfhunter') {
    const next = st.units.find((o) => o !== tu && o.alive && FIGHTER_KINDS.includes(o.kind) && detected(st, o) && Math.hypot(o.x - tu.x, o.y - tu.y) <= toTilesRuntime(400));
    if (next) {
      const np = playerOf(st, next.owner);
      const nd = (d.dmg / 2) * armorMult(np ? fighterStats(st, np, next).armor : 0);
      next.hp -= nd;
      ev.push({ e: 'shot', x: tu.x, y: tu.y, tx: next.x, ty: next.y, dmg: Math.round(nd), gold: false, fx: 'mage' });
      if (next.hp <= 0) killUnit(st, next, u.owner, ev);
    }
  }
}

// habilidades del ejército (las lanzan solas): raíces del árbol, fuego feérico y
// ciclón del druida raptor, rugido del druida garra
function soldierSkills(st: HuntState, u: HuntUnit, ev: HuntEvent[]): void {
  const foe = (r: number) =>
    st.units
      .filter((o) => o.alive && FIGHTER_KINDS.includes(o.kind) && detected(st, o) && !magicImmune(st, o) && Math.hypot(o.x - u.x, o.y - u.y) <= r)
      .sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
  const K = SOLDIER_SKILLS;
  if (u.kind === 'ctree' && (u.ready.root ?? 0) <= st.tick) {
    const t = foe(K.ctreeRoot.range);
    if (t) {
      t.rootUntil = st.tick + T(K.ctreeRoot.dur);
      u.ready.root = st.tick + T(K.ctreeRoot.cd);
      ev.push({ e: 'fx', a: 'roots', x: t.x, y: t.y, r: 0.8, side: 'elf' });
    }
  }
  if (u.kind === 'raptor') {
    if ((u.ready.fire ?? 0) <= st.tick) {
      const t = foe(K.raptorFire.range);
      if (t) {
        t.armorDown = K.raptorFire.armor;
        t.armorDownUntil = st.tick + T(K.raptorFire.dur);
        u.ready.fire = st.tick + T(K.raptorFire.cd);
        ev.push({ e: 'fx', a: 'blind', x: t.x, y: t.y, r: 0.8, side: 'elf' });
      }
    }
    if ((u.ready.cyclone ?? 0) <= st.tick) {
      const t = foe(K.raptorCyclone.range);
      if (t) {
        t.stunUntil = st.tick + T(K.raptorCyclone.dur);
        u.ready.cyclone = st.tick + T(K.raptorCyclone.cd);
        ev.push({ e: 'fx', a: 'stun', x: t.x, y: t.y, r: 0.8, side: 'elf' });
      }
    }
  }
  if (u.kind === 'claw' && (u.ready.roar ?? 0) <= st.tick && foe(6)) {
    for (const o of st.units) if (o.alive && isSoldier(o.kind) && sideOfOwner(st, o.owner) === 'elf' && Math.hypot(o.x - u.x, o.y - u.y) <= K.clawRoar.r) o.roarUntil = st.tick + T(K.clawRoar.dur);
    u.ready.roar = st.tick + T(K.clawRoar.cd);
    ev.push({ e: 'fx', a: 'bloodlust', x: u.x, y: u.y, r: K.clawRoar.r, side: 'elf' });
  }
}

function stepCompanion(st: HuntState, map: HuntMap, g: Uint8Array, u: HuntUnit, ev: HuntEvent[]): void {
  const p = playerOf(st, u.owner);
  if (!p) return;
  if (u.atkCd > 0) u.atkCd -= 1;
  if (u.kind === 'beast') beastSkills(st, u, ev);
  if (u.stunUntil > st.tick) return;
  // movido con el ratón: primero llega (sin distraerse)
  if (u.order.k === 'move') {
    if (u.path.length > 0) {
      moveUnit(st, map, g, u);
      return;
    }
    u.order = { k: 'idle' };
  }
  const master = mainUnit(st, u.owner);
  // su «casa»: el punto donde lo dejaste o, si no, su amo
  const home = u.anchorX >= 0 ? { x: u.anchorX, y: u.anchorY } : master;
  const s = fighterStats(st, p, u);
  const mySide = sideOfOwner(st, u.owner);
  const sdef = isSoldier(u.kind) ? SOLDIERS[u.kind] : undefined;
  const range = u.kind === 'mage' ? MAGE.range : sdef ? sdef.range : 1.3;
  if (sdef) soldierSkills(st, u, ev);
  // objetivo: el de su amo (rastreador) o el enemigo más cercano a tiro
  let tu: HuntUnit | undefined;
  let tb: HuntBuilding | undefined;
  // orden propia de atacar algo; si no, lo que ataque su amo
  if (u.order.k === 'attack') {
    const id = u.order.target;
    tb = u.kind === 'beast' ? st.buildings.find((b) => b.id === id) : undefined;
    tu = tb ? undefined : st.units.find((o) => o.id === id && o.alive);
    if (!tb && !tu) u.order = { k: 'idle' };
  }
  if (!tu && !tb && u.kind === 'beast' && master?.order.k === 'attack') {
    const id = master.order.target;
    tb = st.buildings.find((b) => b.id === id);
    tu = tb ? undefined : st.units.find((o) => o.id === id && o.alive);
  }
  if (!tu && !tb) {
    let best = Infinity;
    for (const o of st.units) {
      if (!o.alive || sideOfOwner(st, o.owner) === mySide || o.invulnUntil > st.tick) continue;
      if (mySide === 'elf' && !detected(st, o)) continue;
      const d = Math.hypot(o.x - u.x, o.y - u.y);
      if (sdef && !sdef.dmg) continue; // el búho no ataca
      if (d < (u.kind === 'mage' ? range : sdef ? Math.max(range, 5) : 4) && d < best) {
        best = d;
        tu = o;
      }
    }
  }
  const tx = tu ? tu.x : tb ? tb.cx + tb.size / 2 : 0;
  const ty = tu ? tu.y : tb ? tb.cy + tb.size / 2 : 0;
  if (tu || tb) {
    const inRange = tb ? distToRect(u.x, u.y, tb.cx, tb.cy, tb.size, tb.size) <= 0.75 : Math.hypot(tx - u.x, ty - u.y) <= range;
    if (inRange) {
      u.path = [];
      if (u.atkCd <= 0) {
        if (u.kind === 'beast') strike(st, u, p, tb ? { b: tb } : { u: tu }, ev);
        else if (tu && sdef) soldierAttack(st, u, sdef, tu, ev);
        else if (tu) {
          // el Mago dispara como una torre
          const fp = playerOf(st, tu.owner);
          const dmg = fp ? MAGE.dmg * armorMult(fighterStats(st, fp, tu).armor) : MAGE.dmg;
          tu.hp -= dmg;
          u.atkCd = T(MAGE.cd);
          ev.push({ e: 'shot', x: u.x, y: u.y, tx: tu.x, ty: tu.y, dmg: Math.round(dmg), gold: false, fx: 'mage' });
          if (tu.hp <= 0) killUnit(st, tu, u.owner, ev);
        }
      }
    } else if (st.tick >= u.repathAt || u.path.length === 0) {
      routeTo(st, map, g, u, tb ? buildingGoal(tb) : pointGoal(tx, ty));
      if (u.kind === 'beast' && Math.hypot(tx - u.x, ty - u.y) > 5 && (u.ready.wind ?? 0) <= st.tick) {
        u.invisUntil = st.tick + T(BEAST.windwalk.dur);
        u.ready.wind = st.tick + T(BEAST.windwalk.cd);
      }
    }
  } else if (home && Math.hypot(home.x - u.x, home.y - u.y) > (u.anchorX >= 0 ? 0.6 : 2.5) && (st.tick >= u.repathAt || u.path.length === 0)) {
    routeTo(st, map, g, u, pointGoal(home.x, home.y));
  }
  // demasiado lejos de su casa (amo o punto): vuelve, salvo que persiga una orden tuya
  if (home && u.order.k !== 'attack' && Math.hypot(home.x - u.x, home.y - u.y) > BEAST.leash * 1.5 && st.tick >= u.repathAt) routeTo(st, map, g, u, pointGoal(home.x, home.y));
  moveUnit(st, map, g, u);
  u.hp = Math.min(u.maxHp, u.hp + s.regen / TICK_RATE);
  if (u.kind === 'beast' && Math.hypot(u.x - (map.camp.x + 0.5), u.y - (map.camp.y + 0.5)) <= HUT_RADIUS + 1) u.hp = Math.min(u.maxHp, u.hp + (u.maxHp * HUT_REGEN) / TICK_RATE);
}

// búsqueda en anchura desde la casilla del leñador: primer árbol vivo y libre
// que tenga una casilla transitable al lado
function reachableTree(st: HuntState, map: HuntMap, g: Uint8Array, x: number, y: number): number {
  const w = map.w;
  const start = Math.floor(y) * w + Math.floor(x);
  const seen = new Uint8Array(w * map.h);
  const q = new Int32Array(w * map.h);
  let qh = 0;
  let qt = 0;
  q[qt++] = start;
  seen[start] = 1;
  while (qh < qt) {
    const c = q[qh++];
    const cx = c % w;
    const cy = (c - cx) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= map.h) continue;
      const n = ny * w + nx;
      if (seen[n]) continue;
      seen[n] = 1;
      if (isTreeAlive(st, map, n) && !st.treeTaken.has(n)) return n;
      if (!g[n]) q[qt++] = n;
    }
  }
  return -1;
}

// Paladín: Luz sagrada al edificio aliado más dañado a su alcance y Armadura
// sagrada cuando le hacen daño (el aura de armadura va en paladinAura)
function paladinSkills(st: HuntState, u: HuntUnit): void {
  if ((u.ready.light ?? 0) <= st.tick) {
    let best: HuntBuilding | undefined;
    for (const b of st.buildings) {
      if (sideOfOwner(st, b.owner) !== 'elf' || b.hp >= b.maxHp - 0.5) continue;
      if (distToRect(u.x, u.y, b.cx, b.cy, b.size, b.size) > PALADIN.holyLight.range) continue;
      if (!best || b.maxHp - b.hp > best.maxHp - best.hp) best = b;
    }
    if (best) {
      best.hp = Math.min(best.maxHp, best.hp + PALADIN.holyLight.base + (best.maxHp - best.hp) * PALADIN.holyLight.missing);
      u.ready.light = st.tick + T(PALADIN.holyLight.cd);
    }
  }
  if (u.hp < u.maxHp * 0.5 && (u.ready.armor ?? 0) <= st.tick) {
    u.invulnUntil = st.tick + T(PALADIN.holyArmor.dur);
    u.ready.armor = st.tick + T(PALADIN.holyArmor.cd);
  }
}

function stepWorker(st: HuntState, map: HuntMap, g: Uint8Array, u: HuntUnit): void {
  const p = playerOf(st, u.owner);
  if (!p) return;
  if (u.stunUntil > st.tick) return;
  // movido con el ratón: primero llega; luego vuelve a trabajar desde ahí
  if (u.order.k === 'move') {
    if (u.path.length > 0) {
      moveUnit(st, map, g, u);
      return;
    }
    u.order = { k: 'idle' };
  }
  if (u.kind === 'lumberjack') {
    if (u.tree >= 0 && st.deadTrees.has(u.tree)) {
      st.treeTaken.delete(u.tree);
      u.tree = -1;
    }
    if (u.tree < 0 || st.treeTaken.get(u.tree) !== u.id) {
      // el árbol libre más cercano AL QUE SE PUEDA LLEGAR andando (el más
      // cercano en línea recta suele estar al otro lado de tu propia muralla)
      if (st.tick < u.repathAt) return;
      const best = reachableTree(st, map, g, u.x, u.y);
      if (best < 0) {
        u.repathAt = st.tick + T(2); // no hay ninguno: volver a mirar en 2 s
        return;
      }
      u.tree = best;
      st.treeTaken.set(best, u.id);
      const tx = best % map.w;
      routeTo(st, map, g, u, { x: tx, y: (best - tx) / map.w, w: 1, h: 1, near: true });
    }
    const tx = u.tree % map.w;
    const ty = (u.tree - tx) / map.w;
    if (distToRect(u.x, u.y, tx, ty, 1, 1) > 0.8) {
      if (u.path.length === 0 && st.tick >= u.repathAt && !routeTo(st, map, g, u, { x: tx, y: ty, w: 1, h: 1, near: true }) && u.path.length === 0) {
        // ya no se llega (le han cerrado el paso): soltarlo y buscar otro
        st.treeTaken.delete(u.tree);
        u.tree = -1;
        return;
      }
      moveUnit(st, map, g, u);
    } else {
      p.wood += ((LUMBERJACKS[u.tier].woodPerSec ?? 0) * RESOURCE_MULT) / TICK_RATE;
      u.actUntil = st.tick + 2;
      u.actX = tx + 0.5;
      u.actY = ty + 0.5;
    }
    return;
  }
  // reparador: al edificio propio más dañado (murallas primero)
  let target = u.work ? st.buildings.find((b) => b.id === u.work) : undefined;
  if (!target || target.hp >= target.maxHp - 0.01) {
    const anchored = u.anchorX >= 0;
    target = st.buildings
      .filter((b) => b.owner === u.owner && b.hp < b.maxHp - 0.01 && (!anchored || distToRect(u.anchorX, u.anchorY, b.cx, b.cy, b.size, b.size) <= 8))
      .sort((a, b) => (a.type === 'wall' ? 0 : 1) - (b.type === 'wall' ? 0 : 1) || a.hp / a.maxHp - b.hp / b.maxHp)[0];
    u.work = target?.id ?? 0;
    if (target) routeTo(st, map, g, u, buildingGoal(target));
  }
  if (u.tier === REPAIRERS.length - 1) paladinSkills(st, u);
  if (!target) return;
  if (touchesBuilding(u, target)) {
    const tier = REPAIRERS[u.tier];
    let rate = target.maxHp / (REPAIR_BASE_SEC * (tier.ratio ?? 4));
    const def = buildingDef(target);
    if (def.repairBonus) rate *= 1 + def.repairBonus;
    if (p.spec === 'repairex') rate *= 1.25;
    target.hp = Math.min(target.maxHp, target.hp + rate / TICK_RATE);
    u.actUntil = st.tick + 2;
    u.actX = target.cx + target.size / 2;
    u.actY = target.cy + target.size / 2;
  } else {
    if (u.path.length === 0 && st.tick >= u.repathAt) routeTo(st, map, g, u, buildingGoal(target));
    moveUnit(st, map, g, u);
  }
}

// maná máximo y recuperación del jugador (el troll y el lobo suman INT: +1 por nivel,
// los talentos y los objetos de «+todo»)
export function manaOf(st: HuntState, p: HuntPlayer): { max: number; regen: number } {
  const base = MANA[p.form as keyof typeof MANA];
  if (!base) return { max: 0, regen: 0 };
  let int = 0;
  if (p.form === 'hunter' || p.form === 'wolf') {
    int = p.level - 1 + (p.form === 'hunter' ? HUNTER.talentAttr + (p.boots < 0 ? HUNTER.emptyBootsAttr : 0) : 0);
    // solo los objetos de «+N a todos los atributos» dan inteligencia
    for (const it of p.inv) if (it?.kind === 'trinket' && (TRINKETS[it.t].str ?? 0) === (TRINKETS[it.t].agi ?? -1)) int += TRINKETS[it.t].str ?? 0;
  }
  return { max: base.max + int * MANA_PER_INT.max, regen: base.regen + int * MANA_PER_INT.regen };
}

export function stepHunt(st: HuntState, cmds: HuntPlayerCommand[]): HuntEvent[] {
  const ev: HuntEvent[] = [];
  if (st.over) {
    st.tick += 1;
    return ev;
  }
  const map = getHuntMap();
  for (const c of cmds) applyCommand(st, map, c.playerId, c.cmd, ev);
  if (st.tick === st.releaseTick) ev.push({ e: 'released' });
  if (st.tick === T(PHASE.sharedVisionSec)) ev.push({ e: 'shared' });
  if (st.tick === T(PHASE.exposeSec)) {
    const names = [...exposedOwners(st)].map((id) => playerOf(st, id)?.name ?? '');
    ev.push({ e: 'exposed', names });
  }

  let g = huntBlockedGrid(st, map);

  // colonos: orden de construir (llega y planta)
  for (const u of st.units) {
    if (!u.alive) continue;
    if (u.kind === 'elf' || u.kind === 'angel') {
      if (u.order.k === 'build') {
        const o = u.order;
        const size = BUILDINGS[o.type].size;
        // construye al llegar a su sitio (o si ya está pegado y no le queda camino)
        const arrived = u.path.length === 0 && distToRect(u.x, u.y, o.cx, o.cy, size, size) <= 1.6;
        if (arrived) {
          const p = playerOf(st, u.owner)!;
          const err = buildCheck(st, map, g, p, o.type, o.cx, o.cy);
          if (err) reject(ev, p.id, err);
          else {
            const lvl = levelDef(o.type, 1, null, 'main');
            p.gold -= lvl.gold;
            p.wood -= lvl.wood;
            p.stats.built += 1;
            st.buildings.push({
              id: st.nextId++,
              type: o.type,
              owner: p.id,
              cx: o.cx,
              cy: o.cy,
              size,
              level: 1,
              wallBranch: null,
              towerBranch: 'main',
              hp: lvl.hp,
              maxHp: lvl.hp,
              cd: 0,
              invulnUntil: 0,
              stunUntil: 0,
              howlUntil: 0,
              eyeUntil: 0,
              investGold: lvl.gold,
              investWood: lvl.wood,
              retro: 0,
              forceUntil: 0,
              packedUntil: 0,
              luckArmor: 0,
              luckReady: 0,
              eatUntil: 0,
              eatRate: 0,
            });
            ev.push({ e: 'built', x: o.cx + size / 2, y: o.cy + size / 2, type: o.type, owner: p.id });
            g = huntBlockedGrid(st, map);
            // quien se quedó dentro del edificio sale a la casilla libre más cercana
            for (const o2 of st.units) {
              if (!o2.alive || !g[cell(o2.y) * map.w + cell(o2.x)]) continue;
              let best: [number, number] | null = null;
              let bd = Infinity;
              for (let j = o.cy - 2; j < o.cy + size + 2; j++)
                for (let i = o.cx - 2; i < o.cx + size + 2; i++) {
                  if (i < 0 || j < 0 || i >= map.w || j >= map.h || g[j * map.w + i]) continue;
                  const d = Math.hypot(i + 0.5 - o2.x, j + 0.5 - o2.y);
                  if (d < bd) {
                    bd = d;
                    best = [i, j];
                  }
                }
              if (best) {
                o2.x = best[0] + 0.5;
                o2.y = best[1] + 0.5;
                o2.path = [];
              }
            }
          }
          u.order = { k: 'idle' };
          u.path = [];
        } else if (u.path.length === 0 && st.tick >= u.repathAt) {
          const reached = routeTo(st, map, g, u, buildApproach(map, g, u, o.cx, o.cy, size));
          if (!reached && u.path.length === 0) {
            reject(ev, u.owner, 'No puedes llegar a esa casilla');
            u.order = { k: 'idle' };
          }
        }
      }
      // el colono y el ángel también reparan (ratio 1: un edificio entero en 50 s)
      if (u.order.k === 'repair') {
        const id = u.order.target;
        const b = st.buildings.find((o) => o.id === id);
        const owner = playerOf(st, u.owner);
        if (!b || b.hp >= b.maxHp) u.order = { k: 'idle' };
        else if (touchesBuilding(u, b)) {
          let rate = b.maxHp / REPAIR_BASE_SEC;
          if (buildingDef(b).repairBonus) rate *= 1 + (buildingDef(b).repairBonus ?? 0);
          if (owner?.spec === 'repairex') rate *= 1.25;
          b.hp = Math.min(b.maxHp, b.hp + rate / TICK_RATE);
          u.actUntil = st.tick + 2;
          u.actX = b.cx + b.size / 2;
          u.actY = b.cy + b.size / 2;
        }
      }
      moveUnit(st, map, g, u);
      if (u.order.k === 'move' && u.path.length === 0) u.order = { k: 'idle' };
    }
  }

  // bando del cazador
  for (const u of st.units) {
    if (!u.alive || (u.kind !== 'hunter' && u.kind !== 'wolf')) continue;
    const p = playerOf(st, u.owner);
    if (!p) continue;
    stepFighter(st, map, g, u, p, ev);
    if (u.order.k === 'move' && u.path.length === 0) u.order = { k: 'idle' };
  }
  // compañeros con cabeza propia: el rastreador del cazador y el Mago élfico
  for (const u of st.units) if (u.alive && (u.kind === 'beast' || u.kind === 'mage' || isSoldier(u.kind))) stepCompanion(st, map, g, u, ev);

  // daño con el tiempo (quemadura, veneno) y comerse árboles
  for (const u of st.units) {
    if (!u.alive || u.dotUntil <= st.tick || u.invulnUntil > st.tick) continue;
    u.hp -= u.dotDps / TICK_RATE;
    if (u.hp <= 0) killUnit(st, u, null, ev);
  }
  for (const b of st.buildings) if (b.eatUntil > st.tick) b.hp = Math.min(b.maxHp, b.hp + b.eatRate / TICK_RATE);

  // trabajadores
  for (const u of st.units) if (u.alive && (u.kind === 'repairer' || u.kind === 'lumberjack')) stepWorker(st, map, g, u);

  // torres
  const foes = st.units.filter((u) => u.alive && FIGHTER_KINDS.includes(u.kind));
  const durability = st.players.some((q) => q.form === 'elf' && q.alive && q.spec === 'durability');
  const runic = st.buildings.filter((b) => b.type === 'tower' && buildingDef(b).auraHaste);
  const angels = st.units.filter((u) => u.alive && u.kind === 'angel');
  for (const b of st.buildings) {
    if (b.type !== 'tower' && !(b.type === 'wall' && b.wallBranch === 'tree')) continue;
    if (b.cd > 0) {
      b.cd -= 1;
      continue;
    }
    const def = buildingDef(b);
    if (!def.dmg || b.stunUntil > st.tick) continue;
    const range = (def.range ?? 4.7) * (1 + 0.2 * b.retro);
    let target: HuntUnit | undefined;
    let bestD = Infinity;
    if (b.focus) {
      const f = foes.find((o) => o.id === b.focus);
      if (f && detected(st, f) && Math.hypot(b.cx + 0.5 - f.x, b.cy + 0.5 - f.y) <= range) {
        target = f;
        bestD = -1;
      } else if (!st.units.some((o) => o.id === b.focus && o.alive)) b.focus = 0;
    }
    for (const f of target ? [] : foes) {
      if (!detected(st, f)) continue;
      const d = Math.hypot(b.cx + 0.5 - f.x, b.cy + 0.5 - f.y);
      if (d <= range && d < bestD) {
        bestD = d;
        target = f;
      }
    }
    if (!target) continue;
    const fp = playerOf(st, target.owner)!;
    let dmg = def.dmg * (b.howlUntil > st.tick ? 0.75 : 1);
    // aura del ángel: +10 % al daño de las torres cercanas
    if (angels.some((a) => Math.hypot(a.x - b.cx - 0.5, a.y - b.cy - 0.5) <= 7)) dmg *= 1.1;
    let fxName: string | undefined;
    if (def.chain && rand(st) < 0.25) {
      dmg *= 1.25;
      fxName = 'chain';
    }
    const fs = fighterStats(st, fp, target);
    dmg = Math.max(0, dmg - fs.block) * armorMult(fs.armor);
    if (target.berserkUntil > st.tick) dmg *= 1.5;
    if (target.invulnUntil > st.tick) dmg = 0;
    target.hp -= dmg;
    if (dmg > 0) {
      if (def.burn) {
        target.dotUntil = st.tick + T(3);
        target.dotDps = Math.max(target.dotDps * (target.dotUntil > st.tick ? 1 : 0), 512);
        target.atkSlowUntil = st.tick + T(3);
        fxName = 'burn';
      }
      if (def.poisonDps) {
        target.dotUntil = st.tick + T(3);
        target.dotDps = Math.max(target.dotDps, def.poisonDps);
        fxName = 'poison';
      }
      if (def.frost) {
        target.slowUntil = st.tick + T(5);
        fxName = 'frost';
      }
      if (def.corrupt) {
        target.armorDownUntil = st.tick + T(5);
        target.armorDown = def.corrupt;
        fxName = 'corrupt';
      }
    }
    // cadencia: remodelación, aura rúnica, aura de durabilidad y Plena fuerza
    let haste = 0.05 * b.retro + (durability ? 0.05 : 0);
    if (runic.some((r) => r !== b && Math.hypot(r.cx - b.cx, r.cy - b.cy) <= 7)) haste += 0.1;
    if (b.forceUntil > st.tick) haste += 1;
    b.cd = T((def.cd ?? 1) / (1 + haste));
    const owner = playerOf(st, b.owner);
    if (owner) {
      owner.stats.damage += dmg;
      if (def.goldPerHit) earn(owner, def.goldPerHit);
    }
    ev.push({ e: 'shot', x: b.cx + 0.5, y: b.cy + 0.5, tx: target.x, ty: target.y, dmg: Math.round(dmg), gold: !!def.goldPerHit, ...(fxName ? { fx: fxName } : {}) });
    if (target.hp <= 0) killUnit(st, target, b.owner, ev);
  }

  // trampas del cazador
  for (const t of st.traps) {
    if (t.until <= st.tick) continue;
    const hit = st.units.some((u) => u.alive && sideOfOwner(st, u.owner) === 'elf' && Math.hypot(u.x - t.x, u.y - t.y) <= 2);
    if (!hit) continue;
    const r = ABILITIES.trap.radius ?? 3.9;
    const until = st.tick + T(ABILITIES.trap.dur ?? 4);
    for (const u of st.units) if (u.alive && sideOfOwner(st, u.owner) === 'elf' && Math.hypot(u.x - t.x, u.y - t.y) <= r) u.stunUntil = until;
    for (const b of st.buildings) if (Math.hypot(b.cx + 0.5 - t.x, b.cy + 0.5 - t.y) <= r) b.stunUntil = until;
    t.until = st.tick;
    ev.push({ e: 'fx', a: 'trap_fire', x: t.x, y: t.y, r, side: 'hunter' });
  }
  st.traps = st.traps.filter((t) => t.until > st.tick);
  st.eyes = st.eyes.filter((e) => e.until > st.tick);
  st.wards = st.wards.filter((w) => w.until > st.tick);
  st.shops = st.shops.filter((x) => x.until > st.tick);

  // regeneración de las murallas élficas (por tick)
  for (const b of st.buildings) {
    const r = buildingDef(b).regen;
    if (r && b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + r / TICK_RATE);
  }

  // una vez por segundo: ingresos, reapariciones y elecciones pendientes
  // maná: se recupera poco a poco; la guarida recarga un 6 % por segundo
  {
    const map = getHuntMap();
    for (const p of st.players) {
      const mm = manaOf(st, p);
      if (!mm.max) continue;
      let regen = mm.regen;
      if (p.side === 'hunter') {
        const u = mainUnit(st, p.id);
        if (u && Math.hypot(u.x - (map.camp.x + 0.5), u.y - (map.camp.y + 0.5)) <= HUT_RADIUS + 1) regen += mm.max * HUT_MANA_REGEN;
      }
      p.mana = Math.min(mm.max, (p.mana ?? mm.max) + regen / TICK_RATE);
    }
  }
  if (st.tick % TICK_RATE === 0 && st.tick > 0) {
    // Fortuna (A0M1): cada cierto tiempo, oro para todos los aliados del dueño
    for (const b of st.buildings) {
      const w = b.type === 'wall' ? buildingDef(b).wealth : undefined;
      if (!w) continue;
      if (!b.wealthAt) b.wealthAt = st.tick + T(w);
      if (st.tick < b.wealthAt) continue;
      b.wealthAt = st.tick + T(w);
      const gold = Math.min(goldUnit(huntMinute(st)) * 20, 1_000_000);
      for (const q of st.players) if (q.side === 'elf' && q.form !== 'dead') earn(q, gold);
      ev.push({ e: 'fx', a: 'fullforce', x: b.cx + 0.5, y: b.cy + 0.5, r: 2, side: 'elf' });
    }
    for (const p of st.players) {
      if (p.form === 'elf' && p.alive) {
        for (const b of st.buildings) {
          if (b.owner !== p.id) continue;
          const inc = buildingDef(b).income;
          if (!inc) continue;
          earn(p, b.type === 'mine' && b.forceUntil > st.tick ? inc * 2 : inc);
        }
      }
      if (p.form === 'hunter' && p.alive && st.tick >= st.releaseTick) earn(p, HUT_LEVELS[st.hutLevel - 1].income);
      if (p.form === 'choosing' && st.tick >= p.chooseUntil) becomeRole(st, p, 'angel', ev);
      if ((p.form === 'angel' || p.form === 'wolf') && p.respawnAt > 0 && st.tick >= p.respawnAt && !mainUnit(st, p.id)) {
        p.respawnAt = 0;
        const old = st.units.filter((u) => u.owner === p.id && !u.alive && (u.kind === 'angel' || u.kind === 'wolf'));
        st.units = st.units.filter((u) => !old.includes(u));
        if (p.form === 'angel') {
          const u = newUnit(st, p.id, 'angel', map.angelSpawn.x + 0.5, map.angelSpawn.y + 0.5, ANGEL.hp);
          u.invulnUntil = st.tick + T(ANGEL.invulnOnSpawnSec);
        } else {
          const u = newUnit(st, p.id, 'wolf', map.camp.x + 1.5, map.camp.y + 2.5, HUNTER.hp);
          syncFighterHp(st, p, u);
          u.hp = u.maxHp;
        }
      }
    }
    // limpia los muertos que ya no hacen falta (trabajadores)
    // el rastreador caído vuelve a la guarida a los 20 s
    for (const u of st.units) {
      const r = (u as HuntUnit & { respawnAt?: number }).respawnAt ?? 0;
      if (u.kind === 'beast' && !u.alive && r > 0 && st.tick >= r && playerOf(st, u.owner)?.alive) {
        (u as HuntUnit & { respawnAt?: number }).respawnAt = 0;
        u.alive = true;
        u.hp = u.maxHp;
        u.x = map.camp.x + 0.5;
        u.y = map.camp.y + 3.5;
        u.path = [];
        u.order = { k: 'follow' };
      }
    }
    // los árboles comidos vuelven a crecer si no hay nadie encima
    for (const [c, at] of st.deadTrees) {
      if (st.tick < at) continue;
      const tx = c % map.w;
      const ty = (c - tx) / map.w;
      if (st.units.some((u) => u.alive && Math.hypot(u.x - tx - 0.5, u.y - ty - 0.5) < 0.9)) continue;
      st.deadTrees.delete(c);
    }
    st.units = st.units.filter((u) => u.alive || u.kind === 'hunter' || u.kind === 'elf' || u.kind === 'angel' || u.kind === 'wolf' || u.kind === 'beast');
  }

  // final
  // ganan los colonos cuando no queda ningún cazador vivo (los lobos no cuentan)
  if (!st.units.some((u) => u.kind === 'hunter' && u.alive)) st.over = { winner: 'colonist', reason: 'hunter_dead' };
  else if (!st.players.some((p) => p.form === 'elf' && p.alive)) st.over = { winner: 'hunter', reason: 'all_dead' };
  st.tick += 1;
  return ev;
}

// ---------- lo que ve cada uno ----------

export interface HuntSnapPlayer {
  id: string;
  form: string;
  alive: boolean;
  connected: boolean;
  gold: number; // −1: oculto (otro bando)
  level: number;
  // equipo del cazador o de un lobo, visible si su bando o tú lo veis (como al
  // seleccionar al troll en el original)
  gear?: { inv: (InvSlot | null)[]; boots: number; stats: { dmg: number; armor: number; attackSec: number; speed: number; regen: number }; hp: number; maxHp: number };
}

export interface HuntSnapMe {
  form: string;
  side: Side;
  gold: number;
  wood: number;
  food: [number, number];
  tech: number;
  house: number;
  wall: number;
  level: number;
  xp: number;
  xpPrev: number;
  xpNext: number;
  cds: Partial<Record<Ability, number>>; // segundos restantes
  inv: (InvSlot | null)[];
  spec: Spec | null;
  stats: { dmg: number; armor: number; attackSec: number; speed: number; regen: number };
  boots: number;
  attrs: [number, number]; // fuerza y agilidad totales
  blinkBack: number; // segundos que quedan para «Volver» (0 = no)
  beast: number; // 0 sin rastreador · 1 vivo · 2 caído
  mageReady: number; // torres del misterio que tiene (para la fusión)
  choose: number; // segundos para elegir papel (0 = no toca)
  respawn: number;
  dest: [number, number] | null;
  speed: number; // casillas/s reales de tu unidad (para predecir el WASD)
  allowWolves: boolean; // cazador: ¿admite lobos?
  mana: [number, number]; // actual y máximo
  steer: [number, number]; // dirección de WASD que el servidor ya aplicó
  channel: number;
  hutLevel: number;
  hutNext: number; // coste de la siguiente mejora (0 = máx)
  hutIncome: number;
  income: number; // oro/s total
  woodRate: number; // madera/s
  nearShop: boolean;
}

// [id, tipo, jugador, x, y, vida, vida máx, flags, nivel/tier]
export type HuntSnapUnit = [number, number, number, number, number, number, number, number, number, number];
// [id, tipo, jugador, x, y, vida, vida máx, flags, nivel/rango, acción]  acción: 0 nada · 1 abajo · 2 izq · 3 der · 4 arriba
// [id, tipo, jugador, cx, cy, nivel, vida, vida máx, rama, flags, remodelaciones, armadura de la suerte, sorteo en (s)]
export type HuntSnapBuilding = [number, number, number, number, number, number, number, number, number, number, number, number, number, number];

export interface HuntSnap {
  tick: number;
  sec: number;
  releaseIn: number;
  sharedIn: number;
  exposeIn: number;
  night: boolean;
  minute: number;
  market: number;
  players: HuntSnapPlayer[];
  me: HuntSnapMe | null;
  units: HuntSnapUnit[];
  buildings: HuntSnapBuilding[];
  traps: [number, number][];
  eyes: [number, number, number][];
  deadTrees: number[];
  shops: [number, number][];
  vision: [number, number, number][];
  reveal: boolean;
  wolves: boolean; // ¿algún cazador admite lobos?
  over: null | { winner: 'hunter' | 'colonist'; reason: string };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const secsLeft = (ticks: number) => Math.max(0, Math.ceil(ticks / TICK_RATE));

export function viewOf(st: HuntState, viewerId: string | null): { all: boolean; side: Side | null; src: [number, number, number][] } {
  const viewer = viewerId ? playerOf(st, viewerId) : undefined;
  if (!viewer || st.over || viewer.form === 'choosing' || viewer.form === 'dead') return { all: true, side: viewer?.side ?? null, src: [] };
  return { all: false, side: viewer.side, src: visionSources(st, viewer.side, viewer) };
}

export function buildHuntSnap(st: HuntState, viewerId: string | null): HuntSnap {
  const v = viewOf(st, viewerId);
  const viewer = viewerId ? playerOf(st, viewerId) : undefined;
  const idx = new Map(st.players.map((p, i) => [p.id, i]));
  const exposed = v.side === 'hunter' ? exposedOwners(st) : new Set<string>();
  const sees = (x: number, y: number) => v.all || inVision(v.src, x, y);
  let me: HuntSnapMe | null = null;
  if (viewer) {
    const u = mainUnit(st, viewer.id);
    const house = houseOf(st, viewer.id);
    const fs = fighterStats(st, viewer, u);
    let income = 0;
    if (viewer.form === 'elf') {
      for (const b of st.buildings) {
        if (b.owner !== viewer.id) continue;
        const inc = buildingDef(b).income ?? 0;
        income += b.type === 'mine' && b.forceUntil > st.tick ? inc * 2 : inc;
      }
    } else if (viewer.form === 'hunter') income = HUT_LEVELS[st.hutLevel - 1].income;
    income *= RESOURCE_MULT;
    let woodRate = 0;
    for (const w of st.units) if (w.alive && w.owner === viewer.id && w.kind === 'lumberjack') woodRate += (LUMBERJACKS[w.tier].woodPerSec ?? 0) * RESOURCE_MULT;
    const cds: Partial<Record<Ability, number>> = {};
    for (const [a, t] of Object.entries(viewer.cds)) if ((t ?? 0) > st.tick) cds[a as Ability] = secsLeft((t ?? 0) - st.tick);
    const map = getHuntMap();
    me = {
      form: viewer.form,
      side: viewer.side,
      gold: Math.floor(viewer.gold),
      wood: Math.floor(viewer.wood),
      food: (() => {
        const f = foodOf(st, viewer.id);
        return [f.used, f.cap] as [number, number];
      })(),
      tech: techOf(st, viewer.id),
      house: house?.level ?? 0,
      wall: maxWallOf(st, viewer.id),
      level: viewer.level,
      xp: viewer.xp,
      xpPrev: xpForLevel(viewer.level),
      xpNext: xpForLevel(viewer.level + 1),
      cds,
      inv: viewer.inv,
      spec: viewer.spec,
      stats: { dmg: Math.round(fs.dmg), armor: Math.round(fs.armor), attackSec: r2(fs.attackSec), speed: r2(fs.speed), regen: r2(fs.regen) },
      choose: viewer.form === 'choosing' ? secsLeft(viewer.chooseUntil - st.tick) : 0,
      respawn: viewer.respawnAt > 0 ? secsLeft(viewer.respawnAt - st.tick) : 0,
      dest: u && u.path.length > 0 ? u.path[u.path.length - 1] : null,
      speed: u ? Math.round(unitSpeed(st, u) * 1000) / 1000 : 0,
      allowWolves: viewer.allowWolves !== false,
      mana: [Math.floor(viewer.mana ?? 0), manaOf(st, viewer).max],
      steer: u ? [u.sx, u.sy] : [0, 0],
      channel: u && u.channelEnd > 0 ? secsLeft(u.channelEnd - st.tick) : 0,
      hutLevel: st.hutLevel,
      hutNext: HUT_LEVELS[st.hutLevel]?.cost ?? 0,
      hutIncome: HUT_LEVELS[st.hutLevel - 1].income * RESOURCE_MULT,
      income,
      woodRate: r2(woodRate),
      nearShop: !!u && shopNear(st, u.x, u.y, viewer.side),
      boots: viewer.boots,
      attrs: (() => {
        const tk = trinkets(viewer);
        return [tk.str, tk.agi] as [number, number];
      })(),
      blinkBack: u?.blinkFrom && u.blinkFrom.until > st.tick ? secsLeft(u.blinkFrom.until - st.tick) : 0,
      beast: (() => {
        const b = st.units.find((o) => o.kind === 'beast' && o.owner === viewer.id);
        return b ? (b.alive ? 1 : 2) : 0;
      })(),
      mageReady: st.buildings.filter((b) => b.owner === viewer.id && b.type === 'tower' && b.level >= levelsOf('tower')).length,
    };
  }
  const flagsOf = (u: HuntUnit) =>
    (u.invisUntil > st.tick || u.occultUntil > st.tick ? 1 : 0) |
    (u.missUntil > st.tick ? 256 : 0) |
    (magicImmune(st, u) ? 512 : 0) |
    (u.slowUntil > st.tick ? 1024 : 0) |
    (u.dotUntil > st.tick ? 2048 : 0) |
    (u.bloodlustUntil > st.tick || u.forceUntil > st.tick ? 4096 : 0) |
    (u.stunUntil > st.tick ? 2 : 0) |
    (u.rootUntil > st.tick ? 4 : 0) |
    (u.hasteUntil > st.tick ? 8 : 0) |
    (u.invulnUntil > st.tick ? 16 : 0) |
    (u.berserkUntil > st.tick ? 32 : 0) |
    (u.silenceUntil > st.tick ? 64 : 0) |
    (u.channelEnd > 0 ? 128 : 0);
  // aliado a efectos de visión: los del cazador siempre; los colonos, solo desde
  // que comparten visión (antes cada uno ve únicamente lo suyo)
  const shared = st.tick >= T(PHASE.sharedVisionSec);
  const sameSide = (o: string) =>
    !viewer || v.all || o === viewer.id || (sideOfOwner(st, o) === v.side && (v.side === 'hunter' || shared));
  const units: HuntSnapUnit[] = [];
  for (const u of st.units) {
    if (!u.alive) continue;
    const ownSide = sameSide(u.owner);
    let visible = ownSide || sees(u.x, u.y) || exposed.has(u.owner);
    // el cazador invisible solo lo ve el bando de colonos si una Atalaya lo detecta
    if (!ownSide && (FIGHTER_KINDS.includes(u.kind) || u.kind === 'elf' || u.kind === 'owl') && !detected(st, u)) visible = false;
    if (!visible) continue;
    units.push([u.id, UNIT_KIND_ORDER.indexOf(u.kind), idx.get(u.owner) ?? 0, r2(u.x), r2(u.y), Math.ceil(u.hp), Math.round(u.maxHp), flagsOf(u), u.kind === 'hunter' || u.kind === 'wolf' ? (playerOf(st, u.owner)?.level ?? 1) : u.tier, actDir(st, u)]);
  }
  const buildings: HuntSnapBuilding[] = [];
  for (const b of st.buildings) {
    if (!(sameSide(b.owner) || sees(b.cx + b.size / 2, b.cy + b.size / 2))) continue;
    // la casa empaquetada no existe para el otro bando
    if (b.packedUntil > st.tick && !sameSide(b.owner)) continue;
    const branch = b.type === 'wall' ? (b.wallBranch ? 1 + WALL_BRANCH_ORDER.indexOf(b.wallBranch) : 0) : b.towerBranch === 'gold' ? 1 : 0;
    const flags =
      (b.invulnUntil > st.tick ? 1 : 0) |
      (b.stunUntil > st.tick ? 2 : 0) |
      (b.howlUntil > st.tick ? 4 : 0) |
      (b.eyeUntil > st.tick ? 8 : 0) |
      (b.packedUntil > st.tick ? 16 : 0) |
      (b.forceUntil > st.tick ? 32 : 0) |
      (b.eatUntil > st.tick ? 64 : 0);
    buildings.push([b.id, ['house', 'wall', 'tower', 'workshop', 'elftree', 'mine', 'sight'].indexOf(b.type), idx.get(b.owner) ?? 0, b.cx, b.cy, b.level, Math.ceil(b.hp), Math.round(b.maxHp), branch, flags, b.retro, b.luckArmor, b.luckReady > 0 ? secsLeft(b.luckReady - st.tick) : -1, sameSide(b.owner) ? (b.focus ?? 0) : 0]);
  }
  return {
    tick: st.tick,
    sec: Math.floor(st.tick / TICK_RATE),
    releaseIn: secsLeft(st.releaseTick - st.tick),
    sharedIn: secsLeft(T(PHASE.sharedVisionSec) - st.tick),
    exposeIn: secsLeft(T(PHASE.exposeSec) - st.tick),
    night: isNightAt(st),
    minute: huntMinute(st),
    market: st.market,
    players: st.players.map((p) => {
      const out: HuntSnapPlayer = {
        id: p.id,
        form: p.form,
        alive: p.alive,
        connected: p.connected,
        gold: !viewer || v.all || p.side === viewer.side ? Math.floor(p.gold) : -1,
        level: p.level,
      };
      if (p.form === 'hunter' || p.form === 'wolf') {
        const pu = mainUnit(st, p.id);
        if (pu && pu.alive && units.some((x) => x[0] === pu.id)) {
          const fs = fighterStats(st, p, pu);
          out.gear = {
            inv: p.inv,
            boots: p.boots,
            stats: { dmg: Math.round(fs.dmg), armor: Math.round(fs.armor), attackSec: r2(fs.attackSec), speed: r2(fs.speed), regen: r2(fs.regen) },
            hp: Math.ceil(pu.hp),
            maxHp: Math.round(pu.maxHp),
          };
        }
      }
      return out;
    }),
    me,
    units,
    buildings,
    traps: v.side === 'hunter' || v.all ? st.traps.map((t) => [r2(t.x), r2(t.y)]) : [],
    deadTrees: [...st.deadTrees.keys()],
    shops: st.shops.filter((x) => v.all || sideOfOwner(st, x.owner) === v.side).map((x) => [r2(x.x), r2(x.y)]),
    eyes: st.eyes.filter((e) => v.all || e.side === v.side).map((e) => [r2(e.x), r2(e.y), e.r]),
    vision: v.src.map(([x, y, r]) => [r2(x), r2(y), r2(r)]),
    reveal: v.all,
    wolves: wolvesAllowed(st),
    over: st.over,
  };
}

export function filterHuntEvents(st: HuntState, viewerId: string | null, events: HuntEvent[]): HuntEvent[] {
  const v = viewOf(st, viewerId);
  return events.filter((ev) => {
    if ('priv' in ev) return ev.priv === viewerId;
    if (ev.e === 'death' || ev.e === 'released' || ev.e === 'shared' || ev.e === 'exposed' || ev.e === 'form') return true;
    if (ev.e === 'levelup') return v.all || v.side === 'hunter' || inVision(v.src, ev.x, ev.y);
    if (ev.e === 'fx') {
      // las habilidades del otro bando solo se ven si caen en tu visión (la trampa no se ve hasta que salta)
      if (v.all || ev.side === v.side) return true;
      if (ev.a === 'trap') return false;
      return inVision(v.src, ev.x, ev.y) || (ev.tx !== undefined && inVision(v.src, ev.tx, ev.ty ?? 0));
    }
    if (v.all) return true;
    if (ev.e === 'built' || ev.e === 'upgraded') return v.side === 'elf' || inVision(v.src, ev.x, ev.y);
    return inVision(v.src, ev.x, ev.y) || ('tx' in ev && inVision(v.src, ev.tx, ev.ty));
  });
}
