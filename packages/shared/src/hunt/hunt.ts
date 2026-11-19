// CACERÍA · modo ASIMÉTRICO (prototipo): un CAZADOR contra los COLONOS.
//
// Por qué existe: los otros modos acaban siendo «batir el récord» contra oleadas
// que ya te sabes. Aquí el rival es una persona y cada partida sale distinta.
//
//   · Todos nacen en el campamento del cazador. Los colonos salen ya; el cazador
//     queda retenido RELEASE_SEC segundos. En ese tiempo cada colono corre a una
//     base, cierra la entrada con una Muralla y monta su economía.
//   · El COLONO muere de un golpe. No pelea: construye. Tesorería (oro por
//     segundo, cada nivel lo duplica), Muralla (cierra la base), Torres (disparan
//     al cazador) y Taller (obreros que reparan la muralla).
//   · El CAZADOR empieza débil. Cada golpe le da tanto oro como daño hace, y con
//     ese oro compra arma, vida y botas en su campamento.
//   · Gana el cazador si no queda ningún colono vivo; ganan los colonos si matan
//     al cazador o aguantan hasta que se acaba el tiempo.
//
// Es una sim APARTE de la de tower defense (no comparte GameState): lo único que
// tienen en común es la sala. No hay replays ni guardado todavía, así que no
// necesita ser bit a bit determinista; aun así no usa Date ni Math.random.
//
// Todo el balance está en HUNT y en las cuatro funciones de curva de abajo.
import { TICK_RATE } from '../constants.js';
import { rand } from '../rng.js';

export const HUNT = {
  W: 60,
  H: 40,
  RELEASE_SEC: 30,
  TIME_LIMIT_SEC: 12 * 60,
  MIN_PLAYERS: 1, // con uno solo, el cazador lo lleva el bot (ver huntBotCommands)
  hunter: {
    hp: 500,
    dmg: 5,
    speed: 3.0, // celdas/s
    attackSec: 1.4, // golpea despacio: la Muralla tiene que dar tiempo a reaccionar
    vision: 9,
    goldPerSec: 1,
    campRegen: 0.08, // fracción de vida máx por segundo junto a la guarida
    campRadius: 3.5,
    revealSec: 8,
    revealCd: 60,
    recallChannel: 3,
    recallCd: 40,
    bootsSpeed: 0.5,
  },
  colonist: {
    speed: 2.8,
    vision: 9,
    startGold: 30,
    buildRange: 6,
    blinkRange: 7.5,
    blinkCd: 32,
  },
  towerRange: 4.7,
  towerSec: 1.0,
  buildingVision: 4,
  towerVision: 6,
  noBuildCampRadius: 5, // nadie construye pegado a la guarida
  workerMax: 5,
  workerBaseCost: 8,
  workerRepair: 2, // vida/s por obrero con el Taller a nivel 1
  workerTierMult: 3, // cada nivel del Taller lo multiplica
  feedCapMult: 2, // una Muralla da como mucho 2× su vida máx en oro…
  feedWindowSec: 60, // …cada minuto (si no, pegarle a una roca sería oro infinito)
  killBountyFrac: 0.1, // el cazador se lleva el 10 % del oro del colono que mata
  shopMaxTier: 12,
} as const;

// ---------- mapa ----------

export interface HuntBase {
  x: number;
  y: number;
  w: number;
  h: number;
  door: { x: number; y: number };
}

export interface HuntMap {
  w: number;
  h: number;
  tiles: number[]; // 0 suelo · 1 roca · 2 árbol (los dos bloquean)
  camp: { x: number; y: number };
  bases: HuntBase[];
}

let cachedMap: HuntMap | null = null;

// El mapa es fijo: seis bases cerradas con UNA entrada de una casilla, tres
// arriba y tres abajo, y la guarida del cazador en el centro.
export function getHuntMap(): HuntMap {
  if (cachedMap) return cachedMap;
  const w = HUNT.W;
  const h = HUNT.H;
  const tiles = new Array<number>(w * h).fill(0);
  const set = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h) tiles[y * w + x] = v;
  };
  for (let x = 0; x < w; x++) {
    set(x, 0, 1);
    set(x, h - 1, 1);
  }
  for (let y = 0; y < h; y++) {
    set(0, y, 1);
    set(w - 1, y, 1);
  }
  const camp = { x: 30, y: 20 };
  const bases: HuntBase[] = [];
  const BW = 9;
  const BH = 7;
  for (const top of [true, false]) {
    for (const x0 of [5, 25, 46]) {
      const y0 = top ? 2 : h - 2 - BH;
      for (let x = x0; x < x0 + BW; x++) {
        set(x, y0, 1);
        set(x, y0 + BH - 1, 1);
      }
      for (let y = y0; y < y0 + BH; y++) {
        set(x0, y, 1);
        set(x0 + BW - 1, y, 1);
      }
      const door = { x: x0 + 4, y: top ? y0 + BH - 1 : y0 };
      set(door.x, door.y, 0);
      bases.push({ x: x0, y: y0, w: BW, h: BH, door });
    }
  }
  // maleza: grupitos de roca y árboles para que haya esquinas donde esconderse
  const st = { rng: 0x1a2b3c4d };
  const nearBase = (x: number, y: number) =>
    bases.some((b) => x >= b.x - 3 && x < b.x + b.w + 3 && y >= b.y - 3 && y < b.y + b.h + 3);
  for (let n = 0; n < 70; n++) {
    const cx = 2 + Math.floor(rand(st) * (w - 4));
    const cy = 2 + Math.floor(rand(st) * (h - 4));
    const kind = rand(st) < 0.6 ? 2 : 1;
    const size = 2 + Math.floor(rand(st) * 4);
    let x = cx;
    let y = cy;
    for (let i = 0; i < size; i++) {
      if (Math.hypot(x - camp.x, y - camp.y) > 7 && !nearBase(x, y) && x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        set(x, y, kind);
      }
      if (rand(st) < 0.5) x += rand(st) < 0.5 ? 1 : -1;
      else y += rand(st) < 0.5 ? 1 : -1;
    }
  }
  // todo suelo debe ser alcanzable desde la guarida: lo que quede aislado se rellena
  const seen = new Uint8Array(w * h);
  const queue = [camp.y * w + camp.x];
  seen[queue[0]] = 1;
  while (queue.length > 0) {
    const i = queue.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const j = (y + dy) * w + (x + dx);
      if (tiles[j] === 0 && !seen[j]) {
        seen[j] = 1;
        queue.push(j);
      }
    }
  }
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === 0 && !seen[i]) tiles[i] = 1;
  cachedMap = { w, h, tiles, camp, bases };
  return cachedMap;
}

// ---------- edificios y curvas ----------

export type HuntBuildingType = 'treasury' | 'wall' | 'tower' | 'workshop';
export const HUNT_BUILDING_ORDER: HuntBuildingType[] = ['treasury', 'wall', 'tower', 'workshop'];

export interface HuntBuildingDef {
  type: HuntBuildingType;
  name: string;
  desc: string;
  icon: string;
  cost: number;
  limit: number;
  maxLevel: number;
  hotkey: string;
}

export const HUNT_BUILDINGS: Record<HuntBuildingType, HuntBuildingDef> = {
  treasury: {
    type: 'treasury',
    name: 'Tesorería',
    desc: 'Da oro cada segundo. Cada nivel lo duplica, pero no puede superar el nivel de tu mejor Muralla en más de 1.',
    icon: '💰',
    cost: 0,
    limit: 1,
    maxLevel: 12,
    hotkey: '1',
  },
  wall: {
    type: 'wall',
    name: 'Muralla',
    desc: 'Cierra la entrada de tu base. No ataca, pero aguanta: cada nivel duplica su vida.',
    icon: '🧱',
    cost: 4,
    limit: 2,
    maxLevel: 14,
    hotkey: '2',
  },
  tower: {
    type: 'tower',
    name: 'Torre',
    desc: 'Dispara al cazador si se acerca. Cada nivel duplica su daño. Tiene poca vida.',
    icon: '🏹',
    cost: 4,
    limit: 12,
    maxLevel: 12,
    hotkey: '3',
  },
  workshop: {
    type: 'workshop',
    name: 'Taller',
    desc: 'Contrata obreros que reparan solos tu edificio más dañado. Mejorarlo triplica lo que repara cada uno.',
    icon: '🔨',
    cost: 16,
    limit: 1,
    maxLevel: 4,
    hotkey: '4',
  },
};

export function huntMaxHp(type: HuntBuildingType, level: number): number {
  switch (type) {
    case 'wall':
      return 30 * 2 ** (level - 1);
    case 'tower':
      return Math.round(12 * 1.6 ** (level - 1));
    case 'treasury':
      return Math.round(30 * 1.8 ** (level - 1));
    case 'workshop':
      return 64 * 4 ** (level - 1);
  }
}

// Coste de subir de `level` a `level + 1` (0 si ya está al máximo).
export function huntUpgradeCost(type: HuntBuildingType, level: number): number {
  if (level >= HUNT_BUILDINGS[type].maxLevel) return 0;
  switch (type) {
    case 'wall':
      return 8 * 2 ** (level - 1);
    case 'tower':
      return 16 * 2 ** (level - 1);
    case 'treasury':
      return 50 * 2 ** (level - 1);
    case 'workshop':
      return [96, 512, 1500][level - 1] ?? 0;
  }
}

export const huntTowerDamage = (level: number): number => 2 ** (level - 1);
export const huntTreasuryIncome = (level: number): number => 2 ** (level - 1);
export const huntWorkerCost = (owned: number): number => HUNT.workerBaseCost * 2 ** owned;
export const huntWorkerPower = (workshopLevel: number): number =>
  HUNT.workerRepair * HUNT.workerTierMult ** (workshopLevel - 1);

// Tienda del cazador. Cada objeto SUSTITUYE al nivel anterior (no se acumulan).
export type HuntItem = 'weapon' | 'vitality' | 'boots';
export const HUNT_ITEM_ORDER: HuntItem[] = ['weapon', 'vitality', 'boots'];
export const HUNT_ITEMS: Record<HuntItem, { name: string; icon: string; maxTier: number; desc: string }> = {
  weapon: { name: 'Garras', icon: '🗡️', maxTier: HUNT.shopMaxTier, desc: 'Más daño por golpe (y más oro: cobras lo que pegas).' },
  vitality: { name: 'Pellejo', icon: '❤️', maxTier: HUNT.shopMaxTier, desc: 'Más vida máxima.' },
  boots: { name: 'Zarpas ligeras', icon: '🥾', maxTier: 2, desc: 'Más velocidad de movimiento.' },
};
// Coste del SIGUIENTE nivel (tier actual → tier + 1); 0 si ya está al máximo.
export function huntItemCost(item: HuntItem, tier: number): number {
  if (tier >= HUNT_ITEMS[item].maxTier) return 0;
  if (item === 'boots') return tier === 0 ? 100 : 800;
  return 100 * 2 ** tier;
}
export const huntWeaponBonus = (tier: number): number => (tier <= 0 ? 0 : 2 ** tier);
export const huntVitalityBonus = (tier: number): number => (tier <= 0 ? 0 : 250 * 2 ** (tier - 1));

// ---------- estado ----------

export type HuntRole = 'hunter' | 'colonist';

export interface HuntPlayer {
  id: string;
  name: string;
  color: string;
  role: HuntRole;
  gold: number;
  alive: boolean;
  connected: boolean;
  workers: number;
  blinkReady: number; // tick a partir del cual puede volver a saltar
  revealReady: number;
  revealUntil: number;
  recallReady: number;
  channelEnd: number; // tick en que termina la canalización del regreso (0 = no canaliza)
  weapon: number;
  vitality: number;
  boots: number;
  goldEarned: number;
  damage: number;
  built: number;
}

export interface HuntUnit {
  id: number;
  owner: string;
  role: HuntRole;
  x: number; // en celdas; el centro de la celda (3,4) es (3.5, 4.5)
  y: number;
  hp: number;
  maxHp: number;
  path: [number, number][]; // celdas pendientes
  dest: [number, number] | null;
  target: number; // id de edificio o unidad que persigue para atacar (0 = nada)
  atkCd: number; // ticks
  alive: boolean;
}

export interface HuntBuilding {
  id: number;
  type: HuntBuildingType;
  owner: string;
  cx: number;
  cy: number;
  level: number;
  hp: number;
  maxHp: number;
  cd: number; // ticks hasta el próximo disparo (torres)
  feed: number; // oro que ha dado al cazador en la ventana actual (antiabuso)
  feedReset: number; // tick en que se reinicia la ventana
}

export interface HuntState {
  tick: number;
  rng: number;
  nextId: number;
  players: HuntPlayer[];
  units: HuntUnit[];
  buildings: HuntBuilding[];
  releaseTick: number;
  endTick: number;
  over: null | { winner: HuntRole; reason: 'hunter_dead' | 'all_dead' | 'time' };
}

export type HuntCommand =
  | { k: 'move'; x: number; y: number }
  | { k: 'attack'; target: number }
  | { k: 'stop' }
  | { k: 'build'; type: HuntBuildingType; cx: number; cy: number }
  | { k: 'upgrade'; id: number }
  | { k: 'demolish'; id: number }
  | { k: 'worker' }
  | { k: 'blink'; x: number; y: number }
  | { k: 'buy'; item: HuntItem }
  | { k: 'reveal' }
  | { k: 'recall' };

export interface HuntPlayerCommand {
  playerId: string;
  cmd: HuntCommand;
}

// `priv`: solo lo recibe ese jugador. `x`/`y`: si vienen, el evento solo llega a
// quien VE ese punto (un +oro flotante delataría dónde está el cazador).
export type HuntEvent =
  | { e: 'hit'; x: number; y: number; dmg: number; gold: number }
  | { e: 'shot'; x: number; y: number; tx: number; ty: number; dmg: number }
  | { e: 'built'; x: number; y: number; type: HuntBuildingType }
  | { e: 'upgraded'; x: number; y: number; level: number }
  | { e: 'destroyed'; x: number; y: number; type: HuntBuildingType }
  | { e: 'death'; x: number; y: number; playerId: string; name: string; left: number }
  | { e: 'blink'; x: number; y: number; tx: number; ty: number }
  | { e: 'recall'; x: number; y: number }
  | { e: 'reveal' }
  | { e: 'released' }
  | { e: 'bought'; priv: string; item: HuntItem; tier: number }
  | { e: 'reject'; priv: string; reason: string };

const T = (sec: number): number => Math.round(sec * TICK_RATE);

export function createHunt(
  seed: number,
  roster: { id: string; name: string; color: string }[],
  hunterId: string,
): HuntState {
  const map = getHuntMap();
  const state: HuntState = {
    tick: 0,
    rng: seed | 0,
    nextId: 1,
    players: [],
    units: [],
    buildings: [],
    releaseTick: T(HUNT.RELEASE_SEC),
    endTick: T(HUNT.TIME_LIMIT_SEC),
    over: null,
  };
  let slot = 0;
  const colonists = roster.filter((r) => r.id !== hunterId).length;
  for (const r of roster) {
    const role: HuntRole = r.id === hunterId ? 'hunter' : 'colonist';
    state.players.push({
      id: r.id,
      name: r.name,
      color: r.color,
      role,
      gold: role === 'colonist' ? HUNT.colonist.startGold : 0,
      alive: true,
      connected: true,
      workers: 0,
      blinkReady: 0,
      revealReady: 0,
      revealUntil: 0,
      recallReady: 0,
      channelEnd: 0,
      weapon: 0,
      vitality: 0,
      boots: 0,
      goldEarned: 0,
      damage: 0,
      built: 0,
    });
    let x = map.camp.x + 0.5;
    let y = map.camp.y + 1.5;
    if (role === 'colonist') {
      // en corro alrededor de la guarida, mirando hacia fuera
      const a = (slot / Math.max(1, colonists)) * Math.PI * 2;
      x = map.camp.x + 0.5 + Math.round(Math.cos(a) * 3);
      y = map.camp.y + 0.5 + Math.round(Math.sin(a) * 3);
      slot++;
    }
    const hp = role === 'hunter' ? HUNT.hunter.hp : 1;
    state.units.push({
      id: state.nextId++,
      owner: r.id,
      role,
      x,
      y,
      hp,
      maxHp: hp,
      path: [],
      dest: null,
      target: 0,
      atkCd: 0,
      alive: true,
    });
  }
  return state;
}

// ---------- rejilla y rutas ----------

const cellOf = (v: number): number => Math.floor(v);

function blockedGrid(state: HuntState, map: HuntMap): Uint8Array {
  const g = new Uint8Array(map.w * map.h);
  for (let i = 0; i < g.length; i++) g[i] = map.tiles[i] === 0 ? 0 : 1;
  // la guarida es un edificio neutral que ocupa su casilla
  g[map.camp.y * map.w + map.camp.x] = 1;
  for (const b of state.buildings) g[b.cy * map.w + b.cx] = 1;
  return g;
}

// ¿Se tocan dos celdas? Vecinas en 8 direcciones; en diagonal no vale colarse por
// una esquina si los dos lados están tapados.
function adjacent(g: Uint8Array, w: number, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  if (dx > 1 || dy > 1) return false;
  if (dx === 1 && dy === 1) return !(g[ay * w + bx] && g[by * w + ax]);
  return true;
}

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

// A* sobre la rejilla. `near`: basta con llegar a una celda que TOQUE el destino
// (para atacar un edificio, que ocupa la suya). Si no hay camino devuelve la ruta
// hasta la celda alcanzable más cercana, con `reached: false`.
function findPath(
  g: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  near: boolean,
): { path: [number, number][]; reached: boolean } {
  const n = w * h;
  const start = sy * w + sx;
  const dist = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const heap: number[] = []; // pares (f, idx) aplanados
  const push = (f: number, i: number) => {
    let k = heap.length;
    heap.push(f, i);
    while (k > 0) {
      const p = ((k / 2 - 1) >> 1) * 2;
      if (heap[p] <= heap[k]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      [heap[p + 1], heap[k + 1]] = [heap[k + 1], heap[p + 1]];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heap[1];
    const li = heap.pop()!;
    const lf = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = lf;
      heap[1] = li;
      let k = 0;
      for (;;) {
        const l = k * 2 + 2;
        const r = l + 2;
        let m = k;
        if (l < heap.length && heap[l] < heap[m]) m = l;
        if (r < heap.length && heap[r] < heap[m]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        [heap[m + 1], heap[k + 1]] = [heap[k + 1], heap[m + 1]];
        k = m;
      }
    }
    return top;
  };
  const hOf = (x: number, y: number): number => {
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    return 10 * Math.max(dx, dy) + 4 * Math.min(dx, dy);
  };
  const isGoal = (x: number, y: number): boolean =>
    near ? adjacent(g, w, x, y, tx, ty) && !(x === tx && y === ty) : x === tx && y === ty;
  dist[start] = 0;
  push(hOf(sx, sy), start);
  let best = start;
  let bestH = hOf(sx, sy);
  let goal = -1;
  while (heap.length > 0) {
    const i = pop();
    const x = i % w;
    const y = (i - x) / w;
    if (isGoal(x, y)) {
      goal = i;
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
      if (dx !== 0 && dy !== 0 && (g[y * w + nx] || g[ny * w + x])) continue; // sin cortar esquinas
      const nd = dist[i] + c;
      if (dist[j] !== -1 && dist[j] <= nd) continue;
      dist[j] = nd;
      prev[j] = i;
      push(nd + hOf(nx, ny), j);
    }
  }
  const end = goal !== -1 ? goal : best;
  const path: [number, number][] = [];
  for (let i = end; i !== start && i !== -1; i = prev[i]) path.push([i % w, Math.floor(i / w)]);
  path.reverse();
  return { path, reached: goal !== -1 };
}

function orderMove(state: HuntState, map: HuntMap, g: Uint8Array, u: HuntUnit, tx: number, ty: number, near: boolean): boolean {
  const res = findPath(g, map.w, map.h, cellOf(u.x), cellOf(u.y), tx, ty, near);
  u.path = res.path;
  u.dest = [tx, ty];
  return res.reached;
}

// ---------- ayudas de juego ----------

const playerOf = (state: HuntState, id: string): HuntPlayer | undefined => state.players.find((p) => p.id === id);
const unitOf = (state: HuntState, playerId: string): HuntUnit | undefined =>
  state.units.find((u) => u.owner === playerId && u.alive);
export const huntHunterUnit = (state: HuntState): HuntUnit | undefined => state.units.find((u) => u.role === 'hunter');

export function huntHunterDamage(p: HuntPlayer): number {
  return HUNT.hunter.dmg + huntWeaponBonus(p.weapon);
}
export function huntHunterSpeed(p: HuntPlayer): number {
  return HUNT.hunter.speed + p.boots * HUNT.hunter.bootsSpeed;
}

function reject(events: HuntEvent[], playerId: string, reason: string): void {
  events.push({ e: 'reject', priv: playerId, reason });
}

function razeBuilding(state: HuntState, b: HuntBuilding, events: HuntEvent[]): void {
  state.buildings = state.buildings.filter((o) => o !== b);
  events.push({ e: 'destroyed', x: b.cx + 0.5, y: b.cy + 0.5, type: b.type });
}

function killColonist(state: HuntState, u: HuntUnit, events: HuntEvent[]): void {
  u.alive = false;
  u.hp = 0;
  u.path = [];
  const p = playerOf(state, u.owner);
  const hunter = state.players.find((q) => q.role === 'hunter');
  if (p) {
    p.alive = false;
    if (hunter) {
      const bounty = Math.floor(p.gold * HUNT.killBountyFrac);
      hunter.gold += bounty;
      hunter.goldEarned += bounty;
    }
    p.gold = 0;
    p.workers = 0;
    for (const b of state.buildings.filter((o) => o.owner === p.id)) razeBuilding(state, b, events);
  }
  const left = state.players.filter((q) => q.role === 'colonist' && q.alive).length;
  events.push({ e: 'death', x: u.x, y: u.y, playerId: u.owner, name: p?.name ?? '?', left });
}

// ---------- comandos ----------

function applyHuntCommands(state: HuntState, map: HuntMap, cmds: HuntPlayerCommand[], events: HuntEvent[]): void {
  for (const { playerId, cmd } of cmds) {
    const p = playerOf(state, playerId);
    if (!p || !p.alive || state.over || !cmd || typeof cmd !== 'object') continue;
    const u = unitOf(state, playerId);
    if (!u) continue;
    const g = blockedGrid(state, map);
    const inMap = (x: unknown, y: unknown): boolean =>
      typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < map.w && y < map.h;
    const held = p.role === 'hunter' && state.tick < state.releaseTick;

    switch (cmd.k) {
      case 'move': {
        if (!inMap(cmd.x, cmd.y)) break;
        if (held) {
          reject(events, playerId, 'Aún estás retenido en la guarida');
          break;
        }
        p.channelEnd = 0;
        u.target = 0;
        orderMove(state, map, g, u, cellOf(cmd.x), cellOf(cmd.y), false);
        break;
      }
      case 'stop': {
        u.path = [];
        u.dest = null;
        u.target = 0;
        p.channelEnd = 0;
        break;
      }
      case 'attack': {
        if (p.role !== 'hunter' || typeof cmd.target !== 'number') break;
        if (held) {
          reject(events, playerId, 'Aún estás retenido en la guarida');
          break;
        }
        const b = state.buildings.find((o) => o.id === cmd.target);
        const t = b ? null : state.units.find((o) => o.id === cmd.target && o.alive && o.role === 'colonist');
        if (!b && !t) break;
        p.channelEnd = 0;
        u.target = cmd.target;
        u.path = [];
        break;
      }
      case 'build': {
        if (p.role !== 'colonist') break;
        const def = HUNT_BUILDINGS[cmd.type];
        if (!def || !inMap(cmd.cx, cmd.cy) || !Number.isInteger(cmd.cx) || !Number.isInteger(cmd.cy)) break;
        if (g[cmd.cy * map.w + cmd.cx]) {
          reject(events, playerId, 'Ahí no se puede construir');
          break;
        }
        if (Math.hypot(cmd.cx + 0.5 - u.x, cmd.cy + 0.5 - u.y) > HUNT.colonist.buildRange) {
          reject(events, playerId, 'Demasiado lejos: acércate para construir');
          break;
        }
        if (Math.hypot(cmd.cx - map.camp.x, cmd.cy - map.camp.y) < HUNT.noBuildCampRadius) {
          reject(events, playerId, 'No puedes construir junto a la guarida del cazador');
          break;
        }
        if (state.units.some((o) => o.alive && cellOf(o.x) === cmd.cx && cellOf(o.y) === cmd.cy)) {
          reject(events, playerId, 'Hay alguien en esa casilla');
          break;
        }
        const have = state.buildings.filter((o) => o.owner === playerId && o.type === cmd.type).length;
        if (have >= def.limit) {
          reject(events, playerId, def.limit === 1 ? `Solo puedes tener una ${def.name}` : `Máximo ${def.limit} de ${def.name}`);
          break;
        }
        if (p.gold < def.cost) {
          reject(events, playerId, 'No te alcanza el oro');
          break;
        }
        p.gold -= def.cost;
        p.built += 1;
        const hp = huntMaxHp(cmd.type, 1);
        state.buildings.push({
          id: state.nextId++,
          type: cmd.type,
          owner: playerId,
          cx: cmd.cx,
          cy: cmd.cy,
          level: 1,
          hp,
          maxHp: hp,
          cd: 0,
          feed: 0,
          feedReset: 0,
        });
        events.push({ e: 'built', x: cmd.cx + 0.5, y: cmd.cy + 0.5, type: cmd.type });
        break;
      }
      case 'upgrade': {
        const b = state.buildings.find((o) => o.id === cmd.id && o.owner === playerId);
        if (!b) break;
        const cost = huntUpgradeCost(b.type, b.level);
        if (cost <= 0) {
          reject(events, playerId, 'Ya está al máximo');
          break;
        }
        if (b.type === 'treasury') {
          const wall = Math.max(0, ...state.buildings.filter((o) => o.owner === playerId && o.type === 'wall').map((o) => o.level));
          if (b.level > wall) {
            reject(events, playerId, `Sube antes tu Muralla al nivel ${b.level}`);
            break;
          }
        }
        if (p.gold < cost) {
          reject(events, playerId, 'No te alcanza el oro');
          break;
        }
        p.gold -= cost;
        const frac = b.hp / b.maxHp;
        b.level += 1;
        b.maxHp = huntMaxHp(b.type, b.level);
        // conserva el daño recibido en proporción: mejorar no es una cura gratis
        b.hp = Math.max(1, Math.round(b.maxHp * frac));
        events.push({ e: 'upgraded', x: b.cx + 0.5, y: b.cy + 0.5, level: b.level });
        break;
      }
      case 'demolish': {
        const b = state.buildings.find((o) => o.id === cmd.id && o.owner === playerId);
        if (!b) break;
        if (b.type === 'workshop') p.workers = 0;
        razeBuilding(state, b, events);
        break;
      }
      case 'worker': {
        if (p.role !== 'colonist') break;
        if (!state.buildings.some((o) => o.owner === playerId && o.type === 'workshop')) {
          reject(events, playerId, 'Necesitas un Taller');
          break;
        }
        if (p.workers >= HUNT.workerMax) {
          reject(events, playerId, 'Ya tienes todos los obreros');
          break;
        }
        const cost = huntWorkerCost(p.workers);
        if (p.gold < cost) {
          reject(events, playerId, 'No te alcanza el oro');
          break;
        }
        p.gold -= cost;
        p.workers += 1;
        break;
      }
      case 'blink': {
        if (p.role !== 'colonist' || !inMap(cmd.x, cmd.y)) break;
        if (state.tick < p.blinkReady) {
          reject(events, playerId, 'El salto aún se está recargando');
          break;
        }
        const tx = cellOf(cmd.x);
        const ty = cellOf(cmd.y);
        if (g[ty * map.w + tx]) {
          reject(events, playerId, 'No puedes saltar ahí');
          break;
        }
        if (Math.hypot(tx + 0.5 - u.x, ty + 0.5 - u.y) > HUNT.colonist.blinkRange) {
          reject(events, playerId, 'Demasiado lejos para saltar');
          break;
        }
        events.push({ e: 'blink', x: u.x, y: u.y, tx: tx + 0.5, ty: ty + 0.5 });
        u.x = tx + 0.5;
        u.y = ty + 0.5;
        u.path = [];
        u.dest = null;
        p.blinkReady = state.tick + T(HUNT.colonist.blinkCd);
        break;
      }
      case 'buy': {
        if (p.role !== 'hunter') break;
        const item = cmd.item;
        if (!HUNT_ITEMS[item]) break;
        if (Math.hypot(u.x - (map.camp.x + 0.5), u.y - (map.camp.y + 0.5)) > HUNT.hunter.campRadius) {
          reject(events, playerId, 'Vuelve a tu guarida para comprar');
          break;
        }
        const cost = huntItemCost(item, p[item]);
        if (cost <= 0) {
          reject(events, playerId, 'Ya está al máximo');
          break;
        }
        if (p.gold < cost) {
          reject(events, playerId, 'No te alcanza el oro');
          break;
        }
        p.gold -= cost;
        if (item === 'vitality') {
          const before = huntVitalityBonus(p.vitality);
          p.vitality += 1;
          const gain = huntVitalityBonus(p.vitality) - before;
          u.maxHp += gain;
          u.hp += gain;
        } else {
          p[item] += 1;
        }
        events.push({ e: 'bought', priv: playerId, item, tier: p[item] });
        break;
      }
      case 'reveal': {
        if (p.role !== 'hunter') break;
        if (state.tick < p.revealReady) {
          reject(events, playerId, 'El rastreo aún se está recargando');
          break;
        }
        p.revealUntil = state.tick + T(HUNT.hunter.revealSec);
        p.revealReady = state.tick + T(HUNT.hunter.revealCd);
        events.push({ e: 'reveal' });
        break;
      }
      case 'recall': {
        if (p.role !== 'hunter' || held) break;
        if (state.tick < p.recallReady) {
          reject(events, playerId, 'El regreso aún se está recargando');
          break;
        }
        u.path = [];
        u.dest = null;
        u.target = 0;
        p.channelEnd = state.tick + T(HUNT.hunter.recallChannel);
        break;
      }
    }
  }
}

// ---------- un tick ----------

function moveUnit(state: HuntState, map: HuntMap, g: Uint8Array, u: HuntUnit, speed: number): void {
  let budget = speed / TICK_RATE;
  while (budget > 0 && u.path.length > 0) {
    const [cx, cy] = u.path[0];
    if (g[cy * map.w + cx]) {
      // alguien construyó en el camino: recalcular hacia el mismo destino
      if (u.dest) orderMove(state, map, g, u, u.dest[0], u.dest[1], u.target !== 0);
      else u.path = [];
      if (u.path.length === 0 || g[u.path[0][1] * map.w + u.path[0][0]]) {
        u.path = [];
        return;
      }
      continue;
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

function hunterStrike(
  state: HuntState,
  hunter: HuntUnit,
  hp: HuntPlayer,
  target: { b?: HuntBuilding; u?: HuntUnit },
  events: HuntEvent[],
): void {
  const dmg = huntHunterDamage(hp);
  hunter.atkCd = T(HUNT.hunter.attackSec);
  if (target.u) {
    events.push({ e: 'hit', x: target.u.x, y: target.u.y, dmg, gold: 0 });
    killColonist(state, target.u, events);
    hp.damage += 1;
    return;
  }
  const b = target.b!;
  const dealt = Math.min(dmg, b.hp);
  b.hp -= dealt;
  // antiabuso: una Muralla solo paga hasta `feedCapMult`× su vida por ventana
  if (state.tick >= b.feedReset) {
    b.feed = 0;
    b.feedReset = state.tick + T(HUNT.feedWindowSec);
  }
  let gold = dealt;
  if (b.type === 'wall') gold = Math.max(0, Math.min(dealt, b.maxHp * HUNT.feedCapMult - b.feed));
  b.feed += gold;
  hp.gold += gold;
  hp.goldEarned += gold;
  hp.damage += dealt;
  events.push({ e: 'hit', x: b.cx + 0.5, y: b.cy + 0.5, dmg: dealt, gold });
  if (b.hp <= 0) {
    const owner = playerOf(state, b.owner);
    if (owner && b.type === 'workshop') owner.workers = 0;
    razeBuilding(state, b, events);
  }
}

export function stepHunt(state: HuntState, cmds: HuntPlayerCommand[]): HuntEvent[] {
  const events: HuntEvent[] = [];
  if (state.over) {
    state.tick += 1;
    return events;
  }
  const map = getHuntMap();
  applyHuntCommands(state, map, cmds, events);
  if (state.tick === state.releaseTick) events.push({ e: 'released' });

  const g = blockedGrid(state, map);
  const hunter = huntHunterUnit(state);
  const hunterP = state.players.find((p) => p.role === 'hunter');

  // --- cazador: regreso canalizado, persecución y golpes ---
  if (hunter && hunterP && hunter.alive) {
    if (hunterP.channelEnd > 0 && state.tick >= hunterP.channelEnd) {
      hunterP.channelEnd = 0;
      hunterP.recallReady = state.tick + T(HUNT.hunter.recallCd);
      events.push({ e: 'recall', x: hunter.x, y: hunter.y });
      hunter.x = map.camp.x + 0.5;
      hunter.y = map.camp.y + 1.5;
      hunter.path = [];
      hunter.dest = null;
      hunter.target = 0;
    }
    if (hunter.atkCd > 0) hunter.atkCd -= 1;
    const hx = cellOf(hunter.x);
    const hy = cellOf(hunter.y);
    const released = state.tick >= state.releaseTick;
    if (released && hunterP.channelEnd === 0) {
      let tb = hunter.target ? state.buildings.find((b) => b.id === hunter.target) : undefined;
      let tu = hunter.target && !tb ? state.units.find((u) => u.id === hunter.target && u.alive) : undefined;
      if (hunter.target && !tb && !tu) hunter.target = 0;
      // sin orden y parado: golpea lo que tenga pegado (primero colonos)
      if (!hunter.target && hunter.path.length === 0) {
        tu = state.units.find((u) => u.alive && u.role === 'colonist' && adjacent(g, map.w, hx, hy, cellOf(u.x), cellOf(u.y)));
        if (!tu) {
          tb = state.buildings
            .filter((b) => adjacent(g, map.w, hx, hy, b.cx, b.cy))
            .sort((a, b) => a.hp - b.hp || a.id - b.id)[0];
        }
      }
      // un colono que se cruza pegado al cazador cae aunque este vaya a otra cosa
      if (!tu) {
        const passer = state.units.find(
          (u) => u.alive && u.role === 'colonist' && Math.hypot(u.x - hunter.x, u.y - hunter.y) < 0.9,
        );
        if (passer) {
          tu = passer;
          tb = undefined;
        }
      }
      if (tb || tu) {
        const tx = tb ? tb.cx : cellOf(tu!.x);
        const ty = tb ? tb.cy : cellOf(tu!.y);
        const touching = tu ? Math.hypot(tu.x - hunter.x, tu.y - hunter.y) < 1.5 && adjacent(g, map.w, hx, hy, tx, ty) : adjacent(g, map.w, hx, hy, tx, ty);
        if (touching) {
          if (hunter.target) hunter.path = [];
          if (hunter.atkCd <= 0) hunterStrike(state, hunter, hunterP, tb ? { b: tb } : { u: tu }, events);
        } else if (hunter.target && (hunter.path.length === 0 || state.tick % 5 === 0)) {
          orderMove(state, map, g, hunter, tx, ty, tb !== undefined);
        }
      }
    }
    if (released && hunterP.channelEnd === 0) moveUnit(state, map, g, hunter, huntHunterSpeed(hunterP));
    // se cura junto a su guarida
    if (Math.hypot(hunter.x - (map.camp.x + 0.5), hunter.y - (map.camp.y + 0.5)) <= HUNT.hunter.campRadius && hunter.hp < hunter.maxHp) {
      hunter.hp = Math.min(hunter.maxHp, hunter.hp + (hunter.maxHp * HUNT.hunter.campRegen) / TICK_RATE);
    }
  }

  // --- colonos ---
  for (const u of state.units) {
    if (u.role === 'colonist' && u.alive) moveUnit(state, map, g, u, HUNT.colonist.speed);
  }

  // --- torres ---
  if (hunter && hunter.alive) {
    for (const b of state.buildings) {
      if (b.type !== 'tower') continue;
      if (b.cd > 0) {
        b.cd -= 1;
        continue;
      }
      if (Math.hypot(b.cx + 0.5 - hunter.x, b.cy + 0.5 - hunter.y) > HUNT.towerRange) continue;
      const dmg = huntTowerDamage(b.level);
      hunter.hp -= dmg;
      b.cd = T(HUNT.towerSec);
      const owner = playerOf(state, b.owner);
      if (owner) owner.damage += dmg;
      events.push({ e: 'shot', x: b.cx + 0.5, y: b.cy + 0.5, tx: hunter.x, ty: hunter.y, dmg });
      if (hunter.hp <= 0) break;
    }
  }

  // --- una vez por segundo: ingresos y reparaciones ---
  if (state.tick % TICK_RATE === 0 && state.tick > 0) {
    for (const p of state.players) {
      if (!p.alive) continue;
      if (p.role === 'hunter') {
        if (state.tick >= state.releaseTick) {
          p.gold += HUNT.hunter.goldPerSec;
          p.goldEarned += HUNT.hunter.goldPerSec;
        }
        continue;
      }
      const mine = state.buildings.filter((b) => b.owner === p.id);
      const treasury = mine.find((b) => b.type === 'treasury');
      if (treasury) {
        const inc = huntTreasuryIncome(treasury.level);
        p.gold += inc;
        p.goldEarned += inc;
      }
      const shop = mine.find((b) => b.type === 'workshop');
      if (shop && p.workers > 0) {
        let budget = p.workers * huntWorkerPower(shop.level);
        const hurt = mine
          .filter((b) => b.hp < b.maxHp)
          .sort((a, b) => (a.type === 'wall' ? 0 : 1) - (b.type === 'wall' ? 0 : 1) || a.hp / a.maxHp - b.hp / b.maxHp);
        for (const b of hurt) {
          if (budget <= 0) break;
          const heal = Math.min(budget, b.maxHp - b.hp);
          b.hp += heal;
          budget -= heal;
        }
      }
    }
  }

  // --- final ---
  if (hunter && hunter.hp <= 0) {
    hunter.alive = false;
    if (hunterP) hunterP.alive = false;
    state.over = { winner: 'colonist', reason: 'hunter_dead' };
  } else if (!state.players.some((p) => p.role === 'colonist' && p.alive)) {
    state.over = { winner: 'hunter', reason: 'all_dead' };
  } else if (state.tick >= state.endTick) {
    state.over = { winner: 'colonist', reason: 'time' };
  }
  state.tick += 1;
  return events;
}

// ---------- lo que ve cada uno ----------

export interface HuntSnapPlayer {
  id: string;
  alive: boolean;
  connected: boolean;
  gold: number; // -1 = oculto (el oro del otro bando no se ve)
}

export interface HuntSnapMe {
  gold: number;
  workers: number;
  blinkCd: number; // segundos
  revealCd: number;
  recallCd: number;
  channel: number; // segundos que faltan del regreso (0 = no canaliza)
  weapon: number;
  vitality: number;
  boots: number;
  dmg: number;
  income: number; // oro/s actual
  dest: [number, number] | null;
  target: number;
}

// [id, 0 cazador / 1 colono, índice de jugador, x, y, vida, vida máx]
export type HuntSnapUnit = [number, number, number, number, number, number, number];
// [id, índice de tipo, índice de jugador, cx, cy, nivel, vida, vida máx]
export type HuntSnapBuilding = [number, number, number, number, number, number, number, number];

export interface HuntSnap {
  tick: number;
  releaseIn: number; // segundos hasta que sueltan al cazador (0 = ya suelto)
  timeLeft: number;
  players: HuntSnapPlayer[];
  me: HuntSnapMe | null;
  units: HuntSnapUnit[];
  buildings: HuntSnapBuilding[];
  vision: [number, number, number][]; // [x, y, radio] de lo que da visión a este jugador
  reveal: boolean; // ve el mapa entero (rastreo del cazador, espectador o fin)
  over: null | { winner: HuntRole; reason: string };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const secs = (ticks: number): number => Math.max(0, Math.ceil(ticks / TICK_RATE));

// `viewerId` null = espectador: lo ve todo.
export function huntVision(state: HuntState, viewerId: string | null): { all: boolean; src: [number, number, number][] } {
  const viewer = viewerId ? playerOf(state, viewerId) : undefined;
  if (!viewer || !viewer.alive || state.over) return { all: true, src: [] };
  const src: [number, number, number][] = [];
  if (viewer.role === 'hunter') {
    if (state.tick < viewer.revealUntil) return { all: true, src: [] };
    const u = huntHunterUnit(state);
    if (u) src.push([u.x, u.y, HUNT.hunter.vision]);
    return { all: false, src };
  }
  for (const u of state.units) if (u.alive && u.role === 'colonist') src.push([u.x, u.y, HUNT.colonist.vision]);
  for (const b of state.buildings) {
    src.push([b.cx + 0.5, b.cy + 0.5, b.type === 'tower' ? HUNT.towerVision : HUNT.buildingVision]);
  }
  return { all: false, src };
}

function sees(v: { all: boolean; src: [number, number, number][] }, x: number, y: number): boolean {
  if (v.all) return true;
  for (const [sx, sy, r] of v.src) if (Math.hypot(sx - x, sy - y) <= r) return true;
  return false;
}

export function buildHuntSnap(state: HuntState, viewerId: string | null): HuntSnap {
  const v = huntVision(state, viewerId);
  const viewer = viewerId ? playerOf(state, viewerId) : undefined;
  const idx = new Map(state.players.map((p, i) => [p.id, i]));
  const sameSide = (p: HuntPlayer): boolean => !viewer || state.over !== null || viewer.role === p.role;
  let me: HuntSnapMe | null = null;
  if (viewer) {
    const u = state.units.find((o) => o.owner === viewer.id);
    const treasury = state.buildings.find((b) => b.owner === viewer.id && b.type === 'treasury');
    me = {
      gold: Math.floor(viewer.gold),
      workers: viewer.workers,
      blinkCd: secs(viewer.blinkReady - state.tick),
      revealCd: secs(viewer.revealReady - state.tick),
      recallCd: secs(viewer.recallReady - state.tick),
      channel: viewer.channelEnd > 0 ? secs(viewer.channelEnd - state.tick) : 0,
      weapon: viewer.weapon,
      vitality: viewer.vitality,
      boots: viewer.boots,
      dmg: huntHunterDamage(viewer),
      income: viewer.role === 'hunter' ? HUNT.hunter.goldPerSec : treasury ? huntTreasuryIncome(treasury.level) : 0,
      dest: u && u.path.length > 0 ? u.path[u.path.length - 1] : null,
      target: u?.target ?? 0,
    };
  }
  return {
    tick: state.tick,
    releaseIn: secs(state.releaseTick - state.tick),
    timeLeft: secs(state.endTick - state.tick),
    players: state.players.map((p) => ({
      id: p.id,
      alive: p.alive,
      connected: p.connected,
      gold: sameSide(p) ? Math.floor(p.gold) : -1,
    })),
    me,
    units: state.units
      .filter((u) => u.alive && (viewer?.id === u.owner || (viewer && viewer.role === u.role) || sees(v, u.x, u.y)))
      .map((u) => [u.id, u.role === 'hunter' ? 0 : 1, idx.get(u.owner) ?? 0, r2(u.x), r2(u.y), Math.ceil(u.hp), u.maxHp]),
    buildings: state.buildings
      .filter((b) => (viewer && viewer.role === 'colonist' && viewer.alive) || sees(v, b.cx + 0.5, b.cy + 0.5))
      .map((b) => [
        b.id,
        HUNT_BUILDING_ORDER.indexOf(b.type),
        idx.get(b.owner) ?? 0,
        b.cx,
        b.cy,
        b.level,
        Math.ceil(b.hp),
        b.maxHp,
      ]),
    vision: v.src.map(([x, y, r]) => [r2(x), r2(y), r]),
    reveal: v.all,
    over: state.over,
  };
}

export function filterHuntEvents(state: HuntState, viewerId: string | null, events: HuntEvent[]): HuntEvent[] {
  const v = huntVision(state, viewerId);
  return events.filter((ev) => {
    if ('priv' in ev) return ev.priv === viewerId;
    if (ev.e === 'death' || ev.e === 'reveal' || ev.e === 'released') return true;
    return sees(v, ev.x, ev.y) || ('tx' in ev && sees(v, ev.tx, ev.ty));
  });
}

// ---------- mensajes de sala ----------

export interface HuntInit {
  youAre: string;
  hunterId: string;
  players: { id: string; name: string; color: string; role: HuntRole }[];
}

export interface HuntResultPlayer {
  id: string;
  name: string;
  color: string;
  role: HuntRole;
  alive: boolean;
  goldEarned: number;
  damage: number;
  built: number;
}

export interface HuntResult {
  winner: HuntRole;
  reason: string;
  seconds: number;
  players: HuntResultPlayer[];
}

export function huntResult(state: HuntState): HuntResult {
  return {
    winner: state.over?.winner ?? 'colonist',
    reason: state.over?.reason ?? 'time',
    seconds: Math.round(state.tick / TICK_RATE),
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      role: p.role,
      alive: p.alive,
      goldEarned: Math.round(p.goldEarned),
      damage: Math.round(p.damage),
      built: p.built,
    })),
  };
}

// ---------- BOT cazador ----------
//
// Para jugar sin nadie más: el cazador lo lleva la máquina. Juega con lo que VE
// (misma niebla que un jugador) y recuerda los edificios que ya vio. Decide una
// vez por segundo:
//   1. malherido → vuelve a la guarida, se cura y compra;
//   2. con oro para la siguiente mejora de garras → va a comprarla;
//   3. un colono a la vista y alcanzable → a por él;
//   4. edificios conocidos → primero la Muralla más cercana (es la puerta), si no
//      lo que tenga más a mano;
//   5. no sabe nada → usa el rastreo o patrulla las bases.

export const HUNT_BOT_ID = 'bot';
export const HUNT_BOT = { id: HUNT_BOT_ID, name: 'Bestia', color: '#ff5a4e' };

export interface HuntBotMemory {
  known: Map<number, { cx: number; cy: number; type: HuntBuildingType }>;
  patrol: number;
  retreating: boolean;
}

export function createHuntBotMemory(): HuntBotMemory {
  return { known: new Map(), patrol: 0, retreating: false };
}

export function huntBotCommands(state: HuntState, mem: HuntBotMemory): HuntCommand[] {
  const p = playerOf(state, HUNT_BOT_ID);
  const u = huntHunterUnit(state);
  if (!p || !u || !u.alive || state.over || state.tick < state.releaseTick) return [];
  if (state.tick % TICK_RATE !== 0) return [];
  const map = getHuntMap();
  const out: HuntCommand[] = [];
  const v = huntVision(state, HUNT_BOT_ID);

  // memoria: apunta lo que ve y olvida lo que ya no está donde lo dejó
  for (const b of state.buildings) {
    if (sees(v, b.cx + 0.5, b.cy + 0.5)) mem.known.set(b.id, { cx: b.cx, cy: b.cy, type: b.type });
  }
  for (const [id, k] of mem.known) {
    if (!state.buildings.some((b) => b.id === id) && sees(v, k.cx + 0.5, k.cy + 0.5)) mem.known.delete(id);
  }

  if (p.channelEnd > 0) return out; // volviendo a la guarida: no tocar nada
  const campX = map.camp.x + 0.5;
  const campY = map.camp.y + 1.5;
  const atCamp = Math.hypot(u.x - (map.camp.x + 0.5), u.y - (map.camp.y + 0.5)) <= HUNT.hunter.campRadius;
  const frac = u.hp / u.maxHp;
  const goHome = (): void => {
    if (state.tick >= p.recallReady && Math.hypot(u.x - campX, u.y - campY) > 12) out.push({ k: 'recall' });
    else out.push({ k: 'move', x: campX, y: campY });
  };

  if (atCamp) {
    // compra todo lo que pueda: garras primero, pellejo para no ir de cristal
    let gold = p.gold;
    let w = p.weapon;
    let vit = p.vitality;
    let boots = p.boots;
    for (let i = 0; i < 6; i++) {
      const wc = huntItemCost('weapon', w);
      const vc = huntItemCost('vitality', vit);
      if (vit < w && vc > 0 && gold >= vc) {
        out.push({ k: 'buy', item: 'vitality' });
        gold -= vc;
        vit++;
      } else if (wc > 0 && gold >= wc) {
        out.push({ k: 'buy', item: 'weapon' });
        gold -= wc;
        w++;
      } else if (boots === 0 && gold >= huntItemCost('boots', 0) + 200) {
        out.push({ k: 'buy', item: 'boots' });
        gold -= huntItemCost('boots', 0);
        boots++;
      } else break;
    }
    if (frac >= 0.92) mem.retreating = false;
    if (mem.retreating || frac < 0.92) return out; // se queda curándose
  }
  if (frac < 0.35) mem.retreating = true;
  if (mem.retreating) {
    goHome();
    return out;
  }
  // ¿ya puede pagar la siguiente mejora? merece el paseo
  const nextWeapon = huntItemCost('weapon', p.weapon);
  if (!atCamp && nextWeapon > 0 && p.gold >= nextWeapon) {
    goHome();
    return out;
  }

  const g = blockedGrid(state, map);
  const hx = cellOf(u.x);
  const hy = cellOf(u.y);
  // 3 · colono a la vista y alcanzable
  const prey = state.units
    .filter((c) => c.alive && c.role === 'colonist' && sees(v, c.x, c.y))
    .sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y));
  for (const c of prey) {
    if (findPath(g, map.w, map.h, hx, hy, cellOf(c.x), cellOf(c.y), false).reached) {
      if (u.target !== c.id) out.push({ k: 'attack', target: c.id });
      return out;
    }
  }
  // 4 · edificios conocidos que pueda tocar: Murallas primero
  const dist = (k: { cx: number; cy: number }) => Math.hypot(k.cx + 0.5 - u.x, k.cy + 0.5 - u.y);
  const known = [...mem.known.entries()]
    .filter(([id]) => state.buildings.some((b) => b.id === id))
    .sort((a, b) => (a[1].type === 'wall' ? 0 : 1) - (b[1].type === 'wall' ? 0 : 1) || dist(a[1]) - dist(b[1]));
  if (known.some(([id]) => id === u.target)) return out; // ya está en ello
  for (const [id, k] of known) {
    if (findPath(g, map.w, map.h, hx, hy, k.cx, k.cy, true).reached) {
      out.push({ k: 'attack', target: id });
      return out;
    }
  }
  // 5 · a ciegas: rastreo si lo tiene, y si no, patrulla de base en base
  if (state.tick >= p.revealReady) {
    out.push({ k: 'reveal' });
    return out;
  }
  const base = map.bases[mem.patrol % map.bases.length];
  const front = { x: base.door.x + 0.5, y: base.door.y + (base.door.y > base.y ? 2.5 : -1.5) };
  if (Math.hypot(front.x - u.x, front.y - u.y) < 2) mem.patrol += 1;
  else if (u.path.length === 0) out.push({ k: 'move', x: front.x, y: front.y });
  return out;
}
