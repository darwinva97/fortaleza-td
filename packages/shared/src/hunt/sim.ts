// CACERÍA · la simulación (servidor). Ver defs.ts para los números y map.ts para
// el laberinto. No guarda replays: no hace falta que sea bit a bit determinista,
// pero no usa Date ni Math.random (todo sale de state.rng).
import { TICK_RATE } from '../constants.js';
import { rand } from '../rng.js';
import {
  ABILITIES,
  ANGEL,
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
  MARKET,
  MAX_LUMBERJACKS,
  PHASE,
  REPAIRERS,
  REPAIR_BASE_SEC,
  SHOP_RADIUS,
  SPECS,
  WALL_BRANCHES,
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
  type WallBranch,
} from './defs.js';
import { TILE_FLOOR, getHuntMap, type HuntMap } from './map.js';

// ---------- estado ----------

export type Side = 'hunter' | 'elf';
export type UnitKind = 'hunter' | 'elf' | 'angel' | 'wolf' | 'repairer' | 'lumberjack';
export const UNIT_KIND_ORDER: UnitKind[] = ['hunter', 'elf', 'angel', 'wolf', 'repairer', 'lumberjack'];

export type InvSlot = { kind: 'item'; line: ItemLine; tier: number } | { kind: 'cons'; c: Consumable };

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
  level: number;
  xp: number;
  inv: (InvSlot | null)[];
  spec: Spec | null;
  skinUsed: boolean;
  chooseUntil: number; // colono caído: tick límite para elegir ángel o lobo
  respawnAt: number; // ángel o lobo muertos: tick en que vuelven
  stats: { goldEarned: number; damage: number; built: number; kills: number };
}

export type Order =
  | { k: 'idle' }
  | { k: 'move' }
  | { k: 'attack'; target: number }
  | { k: 'build'; type: BuildingType; cx: number; cy: number }
  | { k: 'repair'; target: number };

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

export interface HuntState {
  tick: number;
  rng: number;
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
  over: null | { winner: 'hunter' | 'colonist'; reason: 'hunter_dead' | 'all_dead' };
  treeTaken: Map<number, number>; // casilla de árbol → id del leñador
}

export type HuntCommand =
  | { k: 'move'; x: number; y: number }
  | { k: 'attack'; target: number }
  | { k: 'repair'; target: number }
  | { k: 'stop' }
  | { k: 'build'; type: BuildingType; cx: number; cy: number }
  | { k: 'upgrade'; id: number; branch?: string }
  | { k: 'demolish'; id: number }
  | { k: 'train'; id: number; unit: 'repairer' | 'lumberjack'; tier: number }
  | { k: 'market'; buy: boolean }
  | { k: 'ability'; a: Ability; x?: number; y?: number; target?: number }
  | { k: 'buy'; line: ItemLine; tier: number }
  | { k: 'buycons'; c: Consumable }
  | { k: 'buywood' }
  | { k: 'sell'; slot: number }
  | { k: 'use'; slot: number; x?: number; y?: number }
  | { k: 'hut' }
  | { k: 'form'; f: 'angel' | 'wolf' }
  | { k: 'spec'; s: Spec }
  | { k: 'give'; to: string; gold: number; wood: number };

export interface HuntPlayerCommand {
  playerId: string;
  cmd: HuntCommand;
}

export type HuntEvent =
  | { e: 'hit'; x: number; y: number; dmg: number; gold: number; by: string }
  | { e: 'shot'; x: number; y: number; tx: number; ty: number; dmg: number; gold: boolean }
  | { e: 'built'; x: number; y: number; type: BuildingType; owner: string }
  | { e: 'upgraded'; x: number; y: number; level: number; name: string }
  | { e: 'destroyed'; x: number; y: number; type: BuildingType }
  | { e: 'death'; x: number; y: number; playerId: string; name: string; left: number; bounty: number }
  | { e: 'unitdeath'; x: number; y: number; kind: UnitKind }
  | { e: 'fx'; a: Ability | 'trap_fire' | 'ward' | 'scroll'; x: number; y: number; tx?: number; ty?: number; r?: number; side: Side }
  | { e: 'released' }
  | { e: 'shared' }
  | { e: 'exposed'; names: string[] }
  | { e: 'levelup'; playerId: string; level: number; x: number; y: number }
  | { e: 'form'; playerId: string; name: string; form: Form }
  | { e: 'steal'; x: number; y: number; gold: number }
  | { e: 'bought'; priv: string; text: string }
  | { e: 'reject'; priv: string; reason: string };

const T = (sec: number): number => Math.round(sec * TICK_RATE);
const sec = (st: HuntState): number => st.tick / TICK_RATE;
export const huntMinute = (st: HuntState): number => Math.max(0, Math.floor((st.tick - st.releaseTick) / (60 * TICK_RATE)));

// ---------- creación ----------

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
    goal: null,
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
  };
  st.units.push(u);
  return u;
}

export function createHunt(seed: number, roster: { id: string; name: string; color: string }[], hunterId: string): HuntState {
  const map = getHuntMap();
  const st: HuntState = {
    tick: 0,
    rng: seed | 0,
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
  };
  let slot = 0;
  const elves = roster.filter((r) => r.id !== hunterId).length;
  for (const r of roster) {
    const hunter = r.id === hunterId;
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
      level: 1,
      xp: 0,
      inv: new Array(INVENTORY_SLOTS).fill(null),
      spec: null,
      skinUsed: false,
      chooseUntil: 0,
      respawnAt: 0,
      stats: { goldEarned: 0, damage: 0, built: 0, kills: 0 },
    });
    if (hunter) {
      newUnit(st, r.id, 'hunter', map.camp.x + 0.5, map.camp.y + 2.5, HUNTER.hp);
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
export const huntHunterUnit = (st: HuntState): HuntUnit | undefined => st.units.find((u) => u.kind === 'hunter' && u.alive);
const sideOfOwner = (st: HuntState, owner: string): Side => playerOf(st, owner)?.side ?? 'elf';
const cell = (v: number) => Math.floor(v);

function pay(p: HuntPlayer, gold: number): void {
  p.gold = Math.min(GOLD_CAP, p.gold + gold);
  if (gold > 0) p.stats.goldEarned += gold;
}

function reject(ev: HuntEvent[], playerId: string, reason: string): void {
  ev.push({ e: 'reject', priv: playerId, reason });
}

export function huntBlockedGrid(st: HuntState, map: HuntMap): Uint8Array {
  const g = new Uint8Array(map.w * map.h);
  for (let i = 0; i < g.length; i++) g[i] = map.tiles[i] === TILE_FLOOR ? 0 : 1;
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

function routeTo(st: HuntState, map: HuntMap, g: Uint8Array, u: HuntUnit, goal: NonNullable<HuntUnit['goal']>): boolean {
  u.goal = goal;
  const res = huntFindPath(g, map.w, map.h, cell(u.x), cell(u.y), goal);
  u.path = res.path;
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
  for (const u of st.units) if (u.alive && u.owner === owner && u.kind === 'repairer') used += REPAIRERS[u.tier].food;
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
  let s = 0;
  let boots = 0;
  for (const it of p.inv) {
    if (!it || it.kind !== 'item' || it.line !== line) continue;
    const v = ITEMS[line].tiers[it.tier].value;
    if (line === 'boots') boots = Math.max(boots, v);
    else s += v;
  }
  return line === 'boots' ? boots : s;
}
export function fighterStats(st: HuntState, p: HuntPlayer, u: HuntUnit | undefined): FighterStats {
  const L = p.level - 1;
  let as = HUNTER.asPerLevel * L + itemSum(p, 'gloves') + HUNTER.focusBase + (u ? u.focus * HUNTER.focusPerHit : 0);
  if (u && u.berserkUntil > st.tick) as += 1;
  as = Math.min(HUNTER.maxAttackSpeed, as);
  let speed = HUNTER.speed + itemSum(p, 'boots');
  speed = Math.min(HUNTER.maxSpeed, speed);
  if (u) {
    if (u.invisUntil > st.tick) speed *= 1.5;
    if (u.berserkUntil > st.tick) speed *= 1.5;
    if (u.hasteUntil > st.tick) speed *= 2;
  }
  return {
    maxHp: HUNTER.hp + HUNTER.hpPerLevel * L + itemSum(p, 'life'),
    dmg: HUNTER.dmg + HUNTER.dmgPerLevel * L + itemSum(p, 'weapon'),
    armor: HUNTER.armor + HUNTER.armorPerLevel * L + itemSum(p, 'armor'),
    regen: HUNTER.regenPerLevel * L + itemSum(p, 'regen'),
    attackSec: HUNTER.attackSec / (1 + as),
    speed,
  };
}

function unitSpeed(st: HuntState, u: HuntUnit): number {
  const p = playerOf(st, u.owner);
  switch (u.kind) {
    case 'hunter':
    case 'wolf':
      return p ? fighterStats(st, p, u).speed : HUNTER.speed;
    case 'elf': {
      if (st.tick < st.releaseTick) return PHASE.sprintSpeed;
      return ELF.speed * (u.hasteUntil > st.tick ? 2.1 : 1);
    }
    case 'angel':
      return ANGEL.speed * (u.hasteUntil > st.tick ? 2 : 1);
    default:
      return WORKER_SPEED;
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
  const night = isNight(sec(st));
  const src: [number, number, number][] = [];
  const shared = st.tick >= T(PHASE.sharedVisionSec);
  const mine = (owner: string) => !viewer || owner === viewer.id || side === 'hunter' || shared;
  for (const u of st.units) {
    if (!u.alive || sideOfOwner(st, u.owner) !== side || !mine(u.owner)) continue;
    let r = 4;
    if (u.kind === 'hunter' || u.kind === 'wolf') r = night ? HUNTER.visionNight : HUNTER.visionDay;
    else if (u.kind === 'elf') r = night ? ELF.visionNight : ELF.visionDay;
    else if (u.kind === 'angel') r = ANGEL.vision;
    src.push([u.x, u.y, r]);
  }
  if (side === 'elf') {
    for (const b of st.buildings) {
      if (!mine(b.owner)) continue;
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
  if (u.invisUntil <= st.tick) return true;
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
    pay(killer, bounty);
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
  if (u.kind === 'angel' || u.kind === 'wolf') {
    const p = playerOf(st, u.owner);
    if (p) p.respawnAt = st.tick + T(u.kind === 'angel' ? ANGEL.respawnSec : WOLF.respawnSec);
    if (killer) pay(killer, roleBounty(huntMinute(st)));
    if (killer) giveXp(st, killer, 100, ev);
  } else if (killer) {
    giveXp(st, killer, xpForKill(u.tier + 1), ev);
  }
}

// Golpe de un luchador del bando del cazador (cazador o lobo) a un objetivo.
function strike(st: HuntState, att: HuntUnit, p: HuntPlayer, target: { b?: HuntBuilding; u?: HuntUnit }, ev: HuntEvent[]): void {
  const s = fighterStats(st, p, att);
  const map = getHuntMap();
  void map;
  att.invisUntil = 0; // atacar descubre
  if (st.tick < att.focusUntil || att.focus === 0) att.focus = Math.min(HUNTER.focusMax, att.focus + 1);
  att.focusUntil = st.tick + T(HUNTER.focusSec);
  // el hielo cercano congela la cadencia
  let slow = 0;
  for (const b of st.buildings) {
    if (b.type !== 'wall' || b.wallBranch !== 'ice') continue;
    if (distToRect(att.x, att.y, b.cx, b.cy, 1, 1) <= 1.5) slow = Math.max(slow, buildingDef(b).slowAura ?? 0);
  }
  att.atkCd = T(s.attackSec / Math.max(0.2, 1 - slow));
  let raw = s.dmg;
  if (target.u) {
    const v = target.u;
    if (v.invulnUntil > st.tick) return;
    const armor = v.kind === 'elf' || v.kind === 'angel' ? 0 : 0;
    let dmg = raw * armorMult(armor);
    if (v.kind === 'wolf' || v.kind === 'hunter') return; // no se atacan entre ellos
    dmg = Math.max(0, dmg);
    v.hp -= dmg;
    const gold = Math.floor(Math.min(dmg, v.hp + dmg));
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
  const def = buildingDef(b);
  if (def.flatReduce) raw = Math.max(1, raw - def.flatReduce);
  const dmg = Math.min(b.hp, raw * armorMult(def.armor));
  b.hp -= dmg;
  const gold = Math.floor(dmg);
  pay(p, gold);
  p.stats.damage += dmg;
  att.hp = Math.min(att.maxHp, att.hp + dmg * HUNTER.lifesteal);
  const owner = playerOf(st, b.owner);
  if (owner && def.goldPerHit && b.type === 'wall') pay(owner, def.goldPerHit);
  if (def.thorns) {
    att.hp -= def.thorns * armorMult(s.armor);
    if (att.hp <= 0) killUnit(st, att, b.owner, ev);
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
  if (cmd.k === 'form') {
    if (p.form !== 'choosing' || (cmd.f !== 'angel' && cmd.f !== 'wolf')) return;
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
    if (cmd.buy) {
      const cost = st.market + MARKET.step;
      if (p.gold < cost) return reject(ev, playerId, 'No te alcanza el oro');
      p.gold -= cost;
      p.wood += MARKET.lot;
      st.market = Math.min(MARKET.max, st.market + MARKET.step);
    } else {
      if (p.wood < MARKET.lot) return reject(ev, playerId, `Necesitas ${MARKET.lot} de madera`);
      p.wood -= MARKET.lot;
      pay(p, st.market);
      st.market = Math.max(MARKET.min, st.market - MARKET.step);
    }
    return;
  }
  if (cmd.k === 'upgrade' || cmd.k === 'demolish' || cmd.k === 'train') {
    const b = st.buildings.find((o) => o.id === cmd.id && o.owner === playerId);
    if (!b) return;
    if (cmd.k === 'upgrade') return upgradeBuilding(st, p, b, cmd.branch, ev);
    if (cmd.k === 'demolish') {
      if (b.hp < b.maxHp * 0.95) return reject(ev, playerId, 'Solo puedes derribarlo con la vida casi entera');
      if (b.eyeUntil > st.tick) return reject(ev, playerId, 'El Ojo del cazador lo vigila: ahora no se puede derribar');
      const hunterNear = st.units.some(
        (u) => u.alive && (u.kind === 'hunter' || u.kind === 'wolf') && distToRect(u.x, u.y, b.cx, b.cy, b.size, b.size) <= 9.4,
      );
      if (hunterNear) return reject(ev, playerId, 'Con el cazador cerca no se puede derribar');
      razeBuilding(st, b, ev, false);
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

  const u = mainUnit(st, playerId);
  if (!u) return;
  const g = huntBlockedGrid(st, map);
  const inMap = (x: unknown, y: unknown) => num(x) && num(y) && x >= 0 && y >= 0 && x < map.w && y < map.h;
  const held = p.side === 'hunter' && u.kind === 'hunter' && st.tick < st.releaseTick;

  // la tienda de la guarida (cazador y lobos)
  if (cmd.k === 'buy' || cmd.k === 'buycons' || cmd.k === 'buywood' || cmd.k === 'sell' || cmd.k === 'hut') {
    if (p.side !== 'hunter') return;
    const nearHut = Math.hypot(u.x - (map.camp.x + 0.5), u.y - (map.camp.y + 0.5)) <= SHOP_RADIUS;
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
    if (cmd.k === 'buywood') {
      if (p.gold < WOOD_FOR_GOLD) return reject(ev, playerId, 'No te alcanza el oro');
      p.gold -= WOOD_FOR_GOLD;
      p.wood += 1;
      return;
    }
    if (cmd.k === 'sell') {
      if (!num(cmd.slot)) return;
      const it = p.inv[cmd.slot];
      if (!it) return;
      const price = it.kind === 'item' ? ITEMS[it.line].tiers[it.tier] : CONSUMABLES[it.c];
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
      const free = p.inv.indexOf(null);
      if (free < 0) return reject(ev, playerId, 'Inventario lleno');
      p.gold -= c.gold;
      p.wood -= c.wood;
      p.inv[free] = { kind: 'cons', c: cmd.c };
      ev.push({ e: 'bought', priv: playerId, text: `${c.name}` });
      return;
    }
    // objeto de una línea: se compra cualquier nivel; las copias se funden solas
    const line = ITEMS[cmd.line];
    if (!line || !num(cmd.tier) || cmd.tier < 0 || cmd.tier >= line.tiers.length) return;
    const tier = line.tiers[cmd.tier];
    if (p.gold < tier.gold || p.wood < tier.wood) return reject(ev, playerId, 'No te alcanza');
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
    }
    p.inv[cmd.slot] = null;
    return;
  }

  if (cmd.k === 'ability') return castAbility(st, map, g, p, u, cmd, ev);

  // a partir de aquí, órdenes de movimiento
  if (!canAct(st, u)) return;
  switch (cmd.k) {
    case 'move': {
      if (!inMap(cmd.x, cmd.y)) return;
      if (held) return reject(ev, playerId, 'Aún estás retenido en la guarida');
      u.channelEnd = 0;
      u.order = { k: 'move' };
      routeTo(st, map, g, u, pointGoal(cmd.x, cmd.y));
      return;
    }
    case 'stop':
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
      if (u.kind !== 'angel' || !num(cmd.target)) return;
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
  if (b.level >= levelsOf(b.type)) return reject(ev, p.id, 'Ya está al máximo');
  let wallBranch = b.wallBranch;
  let towerBranch = b.towerBranch;
  if (b.type === 'wall' && b.level === 5) {
    if (!branch || !(branch in WALL_BRANCHES)) return reject(ev, p.id, 'Elige una especialidad para la muralla');
    wallBranch = branch as WallBranch;
  }
  if (b.type === 'tower' && b.level === 2 && branch === 'gold') towerBranch = 'gold';
  const next = levelDef(b.type, b.level + 1, wallBranch, towerBranch);
  const rq = reqError(st, p.id, next.req);
  if (rq) return reject(ev, p.id, rq);
  if (p.gold < next.gold) return reject(ev, p.id, 'No te alcanza el oro');
  if (p.wood < next.wood) return reject(ev, p.id, 'No te alcanza la madera');
  p.gold -= next.gold;
  p.wood -= next.wood;
  const frac = b.hp / b.maxHp;
  b.level += 1;
  b.wallBranch = wallBranch;
  b.towerBranch = towerBranch;
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
  if (kind === 'repairer') {
    const f = foodOf(st, p.id);
    if (f.used + def.food > f.cap) return reject(ev, p.id, 'Te falta comida: mejora tu casa');
  } else if (st.units.filter((u) => u.alive && u.owner === p.id && u.kind === 'lumberjack').length >= MAX_LUMBERJACKS) {
    return reject(ev, p.id, `Máximo ${MAX_LUMBERJACKS} leñadores`);
  }
  p.gold -= def.gold;
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

function becomeRole(st: HuntState, p: HuntPlayer, f: 'angel' | 'wolf', ev: HuntEvent[]): void {
  const map = getHuntMap();
  p.form = f;
  p.side = f === 'wolf' ? 'hunter' : 'elf';
  p.cds = {};
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
  const allowed = FORM_ABILITIES[form]?.includes(a) || (a === 'holylight' && p.spec === 'holylight' && form === 'elf');
  if (!def || !allowed) return;
  if ((p.cds[a] ?? 0) > st.tick) return reject(ev, p.id, `${def.name} aún se está recargando`);
  if (u.silenceUntil > st.tick) return reject(ev, p.id, 'Estás silenciado');
  if (!canAct(st, u)) return;
  if (u.kind === 'hunter' && st.tick < st.releaseTick && a !== 'eye') return reject(ev, p.id, 'Aún estás retenido en la guarida');
  const tx = typeof cmd.x === 'number' && Number.isFinite(cmd.x) ? cmd.x : u.x;
  const ty = typeof cmd.y === 'number' && Number.isFinite(cmd.y) ? cmd.y : u.y;
  if (def.target === 'point' && Math.hypot(tx - u.x, ty - u.y) > (def.range ?? 0) + 0.5) return reject(ev, p.id, 'Demasiado lejos');
  const dur = T(def.dur ?? 0);
  const enemiesOfElves = (x: number, y: number, r: number) =>
    st.units.filter((o) => o.alive && (o.kind === 'hunter' || o.kind === 'wolf') && Math.hypot(o.x - x, o.y - y) <= r);
  switch (a) {
    case 'blink':
    case 'angelblink': {
      const cx = cell(tx);
      const cy = cell(ty);
      if (cx < 0 || cy < 0 || cx >= map.w || cy >= map.h || g[cy * map.w + cx]) return reject(ev, p.id, 'No puedes saltar ahí');
      ev.push({ e: 'fx', a, x: u.x, y: u.y, tx: cx + 0.5, ty: cy + 0.5, side: p.side });
      u.x = cx + 0.5;
      u.y = cy + 0.5;
      u.path = [];
      u.goal = null;
      break;
    }
    case 'haste':
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
    case 'stun':
      for (const o of enemiesOfElves(tx, ty, def.radius ?? 1.5)) o.stunUntil = st.tick + dur;
      ev.push({ e: 'fx', a, x: tx, y: ty, r: def.radius, side: p.side });
      break;
    case 'moonguard':
    case 'holylight': {
      const b = st.buildings.find((o) => o.id === cmd.target && o.owner === p.id);
      if (!b) return reject(ev, p.id, 'Elige un edificio tuyo');
      if (distToRect(u.x, u.y, b.cx, b.cy, b.size, b.size) > (def.range ?? 3) + 0.5) return reject(ev, p.id, 'Demasiado lejos');
      if (a === 'moonguard') b.invulnUntil = st.tick + Math.round(dur * (b.wallBranch === 'elf' ? 1.2 : 1));
      else b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.25);
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
    case 'recall':
      u.path = [];
      u.goal = null;
      u.order = { k: 'idle' };
      u.channelEnd = st.tick + dur;
      break;
    case 'steal': {
      if (Math.hypot(u.x - (map.camp.x + 0.5), u.y - (map.camp.y + 0.5)) > (def.range ?? 2.5) + 0.5) return reject(ev, p.id, 'Acércate a la guarida del cazador');
      const gold = goldUnit(huntMinute(st));
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
}

// ---------- un tick ----------

function moveUnit(st: HuntState, map: HuntMap, g: Uint8Array, u: HuntUnit): void {
  if (u.rootUntil > st.tick || u.stunUntil > st.tick || u.channelEnd > 0) return;
  let budget = unitSpeed(st, u) / TICK_RATE;
  while (budget > 0 && u.path.length > 0) {
    const [cx, cy] = u.path[0];
    if (g[cy * map.w + cx]) {
      // alguien construyó en el camino: recalcular
      if (u.goal && st.tick >= u.repathAt) routeTo(st, map, g, u, u.goal);
      else u.path = [];
      return;
    }
    const dx = cx + 0.5 - u.x;
    const dy = cy + 0.5 - u.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      u.x = cx + 0.5;
      u.y = cy + 0.5;
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
    u.x = map.camp.x + 0.5;
    u.y = map.camp.y + 2.5;
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

function stepWorker(st: HuntState, map: HuntMap, g: Uint8Array, u: HuntUnit): void {
  const p = playerOf(st, u.owner);
  if (!p) return;
  if (u.stunUntil > st.tick) return;
  if (u.kind === 'lumberjack') {
    if (u.tree < 0 || st.treeTaken.get(u.tree) !== u.id) {
      // busca el árbol libre más cercano al que pueda llegar
      let best = -1;
      let bestD = Infinity;
      for (const t of map.trees) {
        if (st.treeTaken.has(t)) continue;
        const tx = t % map.w;
        const ty = (t - tx) / map.w;
        const d = Math.hypot(tx + 0.5 - u.x, ty + 0.5 - u.y);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best < 0) return;
      u.tree = best;
      st.treeTaken.set(best, u.id);
      const tx = best % map.w;
      routeTo(st, map, g, u, { x: tx, y: (best - tx) / map.w, w: 1, h: 1, near: true });
    }
    const tx = u.tree % map.w;
    const ty = (u.tree - tx) / map.w;
    if (distToRect(u.x, u.y, tx, ty, 1, 1) > 0.8) {
      if (u.path.length === 0 && st.tick >= u.repathAt) routeTo(st, map, g, u, { x: tx, y: ty, w: 1, h: 1, near: true });
      moveUnit(st, map, g, u);
    } else {
      p.wood += (LUMBERJACKS[u.tier].woodPerSec ?? 0) / TICK_RATE;
    }
    return;
  }
  // reparador: al edificio propio más dañado (murallas primero)
  let target = u.work ? st.buildings.find((b) => b.id === u.work) : undefined;
  if (!target || target.hp >= target.maxHp - 0.01) {
    target = st.buildings
      .filter((b) => b.owner === u.owner && b.hp < b.maxHp - 0.01)
      .sort((a, b) => (a.type === 'wall' ? 0 : 1) - (b.type === 'wall' ? 0 : 1) || a.hp / a.maxHp - b.hp / b.maxHp)[0];
    u.work = target?.id ?? 0;
    if (target) routeTo(st, map, g, u, buildingGoal(target));
  }
  if (!target) return;
  if (touchesBuilding(u, target)) {
    const tier = REPAIRERS[u.tier];
    let rate = target.maxHp / (REPAIR_BASE_SEC * (tier.ratio ?? 4));
    const def = buildingDef(target);
    if (def.repairBonus) rate *= 1 + def.repairBonus;
    if (p.spec === 'repair') rate *= 1.25;
    target.hp = Math.min(target.maxHp, target.hp + rate / TICK_RATE);
  } else {
    if (u.path.length === 0 && st.tick >= u.repathAt) routeTo(st, map, g, u, buildingGoal(target));
    moveUnit(st, map, g, u);
  }
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
      if (u.kind === 'angel' && u.order.k === 'repair') {
        const id = u.order.target;
        const b = st.buildings.find((o) => o.id === id);
        if (!b || b.hp >= b.maxHp) u.order = { k: 'idle' };
        else if (touchesBuilding(u, b)) b.hp = Math.min(b.maxHp, b.hp + b.maxHp / REPAIR_BASE_SEC / TICK_RATE);
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

  // trabajadores
  for (const u of st.units) if (u.alive && (u.kind === 'repairer' || u.kind === 'lumberjack')) stepWorker(st, map, g, u);

  // torres
  const foes = st.units.filter((u) => u.alive && (u.kind === 'hunter' || u.kind === 'wolf'));
  for (const b of st.buildings) {
    if (b.type !== 'tower') continue;
    if (b.cd > 0) {
      b.cd -= 1;
      continue;
    }
    const def = buildingDef(b);
    if (!def.dmg || b.stunUntil > st.tick) continue;
    const range = def.range ?? 4.7;
    let target: HuntUnit | undefined;
    let bestD = Infinity;
    for (const f of foes) {
      if (!detected(st, f)) continue;
      const d = Math.hypot(b.cx + 0.5 - f.x, b.cy + 0.5 - f.y);
      if (d <= range && d < bestD) {
        bestD = d;
        target = f;
      }
    }
    if (!target) continue;
    const fp = playerOf(st, target.owner)!;
    let dmg = def.dmg * (b.howlUntil > st.tick ? 0.5 : 1);
    dmg *= armorMult(fighterStats(st, fp, target).armor);
    if (target.berserkUntil > st.tick) dmg *= 1.5;
    if (target.invulnUntil > st.tick) dmg = 0;
    target.hp -= dmg;
    b.cd = T(def.cd ?? 1);
    const owner = playerOf(st, b.owner);
    if (owner) {
      owner.stats.damage += dmg;
      if (def.goldPerHit) pay(owner, def.goldPerHit);
    }
    ev.push({ e: 'shot', x: b.cx + 0.5, y: b.cy + 0.5, tx: target.x, ty: target.y, dmg: Math.round(dmg), gold: !!def.goldPerHit });
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

  // regeneración de las murallas élficas (por tick)
  for (const b of st.buildings) {
    const r = buildingDef(b).regen;
    if (r && b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + r / TICK_RATE);
  }

  // una vez por segundo: ingresos, reapariciones y elecciones pendientes
  if (st.tick % TICK_RATE === 0 && st.tick > 0) {
    for (const p of st.players) {
      if (p.form === 'elf' && p.alive) {
        for (const b of st.buildings) {
          if (b.owner !== p.id) continue;
          const inc = buildingDef(b).income;
          if (!inc) continue;
          pay(p, b.type === 'mine' && p.spec === 'mines' ? inc * 2 : inc);
        }
      }
      if (p.form === 'hunter' && p.alive && st.tick >= st.releaseTick) pay(p, HUT_LEVELS[st.hutLevel - 1].income);
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
    st.units = st.units.filter((u) => u.alive || u.kind === 'hunter' || u.kind === 'elf' || u.kind === 'angel' || u.kind === 'wolf');
  }

  // final
  const hunter = st.units.find((u) => u.kind === 'hunter');
  if (!hunter || !hunter.alive) st.over = { winner: 'colonist', reason: 'hunter_dead' };
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
  choose: number; // segundos para elegir papel (0 = no toca)
  respawn: number;
  dest: [number, number] | null;
  channel: number;
  hutLevel: number;
  hutNext: number; // coste de la siguiente mejora (0 = máx)
  hutIncome: number;
  income: number; // oro/s total
  woodRate: number; // madera/s
  nearShop: boolean;
}

// [id, tipo, jugador, x, y, vida, vida máx, flags, nivel/tier]
export type HuntSnapUnit = [number, number, number, number, number, number, number, number, number];
// [id, tipo, jugador, cx, cy, nivel, vida, vida máx, rama, flags]
export type HuntSnapBuilding = [number, number, number, number, number, number, number, number, number, number];

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
  vision: [number, number, number][];
  reveal: boolean;
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
        income += b.type === 'mine' && viewer.spec === 'mines' ? inc * 2 : inc;
      }
    } else if (viewer.form === 'hunter') income = HUT_LEVELS[st.hutLevel - 1].income;
    let woodRate = 0;
    for (const w of st.units) if (w.alive && w.owner === viewer.id && w.kind === 'lumberjack') woodRate += LUMBERJACKS[w.tier].woodPerSec ?? 0;
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
      channel: u && u.channelEnd > 0 ? secsLeft(u.channelEnd - st.tick) : 0,
      hutLevel: st.hutLevel,
      hutNext: HUT_LEVELS[st.hutLevel]?.cost ?? 0,
      hutIncome: HUT_LEVELS[st.hutLevel - 1].income,
      income,
      woodRate: r2(woodRate),
      nearShop: !!u && Math.hypot(u.x - (map.camp.x + 0.5), u.y - (map.camp.y + 0.5)) <= SHOP_RADIUS,
    };
  }
  const flagsOf = (u: HuntUnit) =>
    (u.invisUntil > st.tick ? 1 : 0) |
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
    if (!ownSide && (u.kind === 'hunter' || u.kind === 'wolf') && !detected(st, u)) visible = false;
    if (!visible) continue;
    units.push([u.id, UNIT_KIND_ORDER.indexOf(u.kind), idx.get(u.owner) ?? 0, r2(u.x), r2(u.y), Math.ceil(u.hp), Math.round(u.maxHp), flagsOf(u), u.kind === 'hunter' || u.kind === 'wolf' ? (playerOf(st, u.owner)?.level ?? 1) : u.tier]);
  }
  const buildings: HuntSnapBuilding[] = [];
  for (const b of st.buildings) {
    if (!(sameSide(b.owner) || sees(b.cx + b.size / 2, b.cy + b.size / 2))) continue;
    const branch = b.type === 'wall' ? (b.wallBranch ? 1 + ['rock', 'elf', 'ice', 'cement', 'coral', 'gold', 'ruin'].indexOf(b.wallBranch) : 0) : b.towerBranch === 'gold' ? 1 : 0;
    const flags = (b.invulnUntil > st.tick ? 1 : 0) | (b.stunUntil > st.tick ? 2 : 0) | (b.howlUntil > st.tick ? 4 : 0) | (b.eyeUntil > st.tick ? 8 : 0);
    buildings.push([b.id, ['house', 'wall', 'tower', 'workshop', 'elftree', 'mine', 'sight'].indexOf(b.type), idx.get(b.owner) ?? 0, b.cx, b.cy, b.level, Math.ceil(b.hp), Math.round(b.maxHp), branch, flags]);
  }
  return {
    tick: st.tick,
    sec: Math.floor(st.tick / TICK_RATE),
    releaseIn: secsLeft(st.releaseTick - st.tick),
    sharedIn: secsLeft(T(PHASE.sharedVisionSec) - st.tick),
    exposeIn: secsLeft(T(PHASE.exposeSec) - st.tick),
    night: isNight(st.tick / TICK_RATE),
    minute: huntMinute(st),
    market: st.market,
    players: st.players.map((p) => ({
      id: p.id,
      form: p.form,
      alive: p.alive,
      connected: p.connected,
      gold: !viewer || v.all || p.side === viewer.side ? Math.floor(p.gold) : -1,
      level: p.level,
    })),
    me,
    units,
    buildings,
    traps: v.side === 'hunter' || v.all ? st.traps.map((t) => [r2(t.x), r2(t.y)]) : [],
    eyes: st.eyes.filter((e) => v.all || e.side === v.side).map((e) => [r2(e.x), r2(e.y), e.r]),
    vision: v.src.map(([x, y, r]) => [r2(x), r2(y), r2(r)]),
    reveal: v.all,
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
