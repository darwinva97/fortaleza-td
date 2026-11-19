// CACERÍA · cliente del modo asimétrico.
//
// Pantalla propia: un canvas con el laberinto (cámara pegada a tu personaje),
// niebla de guerra, ciclo de día y noche y minimapa, más un HUD que cambia según
// tu papel: COLONO (construir, mejorar, contratar, mercado de madera), CAZADOR
// (habilidades, inventario de 6 huecos y tienda de la guarida), ÁNGEL o LOBO.
// Todo el arte sale del atlas pixel (hk:*), así que el estilo es uno solo.
//
// El servidor ya manda a cada uno SOLO lo que ve; aquí la niebla es dibujo.
import './hunt.css';
import {
  ABILITIES,
  BUILDINGS,
  BUILDING_ORDER,
  CONSUMABLES,
  FORM_ABILITIES,
  HUT_LEVELS,
  INVENTORY_SLOTS,
  ITEMS,
  ITEM_LINE_ORDER,
  LUMBERJACKS,
  MARKET,
  PHASE,
  REPAIRERS,
  BEAST,
  MAGE_FUSION_TOWERS,
  SPECS,
  SPEC_ABILITY,
  SPEC_ORDER,
  TRINKETS,
  TRINKET_ORDER,
  wallMaxLevel,
  type Trinket,
  TECH_NAMES,
  UNIT_KIND_ORDER,
  WALL_BRANCHES,
  WALL_BRANCH_ORDER,
  WOOD_FOR_GOLD,
  getHuntMap,
  levelDef,
  levelsOf,
  type Ability,
  type BuildingType,
  type Consumable,
  type HuntCommand,
  type HuntEvent,
  type HuntInit,
  type HuntResult,
  type HuntSnap,
  type HuntSnapBuilding,
  type HuntSnapUnit,
  type ItemLine,
  type LevelDef,
  type Req,
  type TowerBranch,
  type UnitKind,
  type WallBranch,
  RESOURCE_MULT,
} from '@td/shared';
import { net } from './net.js';
import { sfx, unlockAudio } from './audio.js';
import { drawPxIcon, pxIcon } from './px-icons.js';

const map = getHuntMap();
const TILE = 24; // px por casilla del suelo prerrenderizado

// ---------- estado local ----------
let init: HuntInit | null = null;
let prev: { snap: HuntSnap; at: number } | null = null;
let cur: { snap: HuntSnap; at: number } | null = null;
let active = false;
let built = false;
let placing: BuildingType | null = null;
let targeting: Ability | null = null;
let useSlot = -1; // consumible que se usa sobre un punto
let selected = 0; // edificio propio seleccionado
let shopOpen = false;
let zoom = 1;
let follow = true;
const cam = { x: map.camp.x + 0.5, y: map.camp.y + 0.5 };
const mouse = { x: 0, y: 0, sx: 0, sy: 0, in: false };
const keys = new Set<string>();
const ghosts = new Map<number, HuntSnapBuilding>(); // edificios que el cazador vio
const hashes: Record<string, string> = {};

interface Fx {
  kind: 'shot' | 'text' | 'ring' | 'slash' | 'beam' | 'burst';
  x: number;
  y: number;
  tx?: number;
  ty?: number;
  r?: number;
  text?: string;
  color: string;
  born: number;
  life: number;
}
let fx: Fx[] = [];
let nightLevel = 0;
// posiciones que se pintan (suavizadas) y predicción local del propio personaje:
// al pinchar, el personaje arranca YA hacia allí sin esperar al servidor
const disp = new Map<number, { x: number; y: number }>();
let predict: {
  tx: number;
  ty: number;
  t0: number;
  from: { x: number; y: number };
  serverAt: [number, number];
  offset: { x: number; y: number } | null; // adelanto que queda por absorber cuando el servidor ya obedece
  prevDest: string; // destino que tenía el servidor ANTES del clic
  blendT0: number;
} | null = null;
const PREDICT_BLEND_MS = 500; // 0 día · 1 noche, suavizado para que el cambio no sea un corte
interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}
const motes: Mote[] = [];

let root: HTMLElement;
let canvas: HTMLCanvasElement;
let g: CanvasRenderingContext2D;
let ground: HTMLCanvasElement | null = null;
let fog: HTMLCanvasElement | null = null;
let mini: HTMLCanvasElement;
let miniBase: HTMLCanvasElement | null = null;

// ---------- utilidades ----------
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const send = (cmd: HuntCommand): void => net.send({ type: 'hunt_cmd', cmd });
const fmt = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : String(Math.round(n));
const icon = (key: string, fallback = ''): string => pxIcon(key, fallback);
const meId = (): string => init?.youAre ?? '';
const meIdx = (): number => init?.players.findIndex((p) => p.id === meId()) ?? -1;
const me = () => cur?.snap.me ?? null;
const form = (): string => me()?.form ?? 'spectator';
const playerColor = (i: number): string => init?.players[i]?.color ?? '#ccc';
const BRANCHES_BY_IDX: (WallBranch | null)[] = [null, ...WALL_BRANCH_ORDER];

function buildingInfo(b: HuntSnapBuilding): { type: BuildingType; wall: WallBranch | null; tower: TowerBranch; def: LevelDef } {
  const type = BUILDING_ORDER[b[1]];
  const wall = type === 'wall' ? BRANCHES_BY_IDX[b[8]] : null;
  const tower: TowerBranch = type === 'tower' && b[8] === 1 ? 'gold' : 'main';
  return { type, wall, tower, def: levelDef(type, b[5], wall, tower) };
}
function buildingIcon(b: HuntSnapBuilding): string {
  const { type, wall, tower } = buildingInfo(b);
  if (type === 'wall') return wall ? WALL_BRANCHES[wall].icon : 'hk:wall';
  if (type === 'tower') return tower === 'gold' ? 'hk:tower-gold' : 'hk:tower';
  if (type === 'workshop') return b[5] >= 2 ? 'hk:townhall' : 'hk:workshop';
  return BUILDINGS[type].icon;
}
const UNIT_ICON: Record<UnitKind, string> = {
  hunter: 'hk:troll',
  elf: 'hk:elf',
  angel: 'hk:angel',
  wolf: 'hk:wolf',
  repairer: 'hk:repairer',
  lumberjack: 'hk:lumberjack',
  beast: 'hk:beast',
  mage: 'hk:mage',
};

function reqText(req: Req | undefined): string | null {
  const m = me();
  if (!req || !m) return null;
  if (req.tech && m.tech < req.tech) return `Requiere ${TECH_NAMES[req.tech]}`;
  if (req.wall && m.wall < req.wall) return `Requiere una muralla de nivel ${req.wall}`;
  if (req.house && m.house < req.house) return `Requiere la casa a nivel ${req.house}`;
  return null;
}
const costHtml = (gold: number, wood: number): string =>
  [gold > 0 ? `${icon('hk:gold', '🪙')}${fmt(gold)}` : '', wood > 0 ? `${icon('hk:wood', '🪵')}${fmt(wood)}` : '', !gold && !wood ? 'gratis' : '']
    .filter(Boolean)
    .join(' ');
const afford = (gold: number, wood: number): boolean => {
  const m = me();
  return !!m && m.gold >= gold && m.wood >= wood;
};

function toast(text: string, bad = false): void {
  const box = root.querySelector('.hk-toasts')!;
  const el = document.createElement('div');
  el.className = `hk-toast${bad ? ' bad' : ''}`;
  el.innerHTML = text;
  box.appendChild(el);
  setTimeout(() => el.remove(), 2800);
  while (box.children.length > 4) box.firstChild?.remove();
}

// ---------- suelo prerrenderizado ----------
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function drawGround(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = map.w * TILE;
  c.height = map.h * TILE;
  const k = c.getContext('2d')!;
  // pradera con manchas suaves
  k.fillStyle = '#1b3a24';
  k.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 1400; i++) {
    const x = hash(i, 7) * c.width;
    const y = hash(i, 13) * c.height;
    const r = 30 + hash(i, 29) * 120;
    const light = hash(i, 41) > 0.5;
    const grd = k.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, light ? 'rgba(96, 160, 80, 0.14)' : 'rgba(6, 24, 16, 0.22)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    k.fillStyle = grd;
    k.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 9000; i++) {
    k.fillStyle = hash(i, 307) > 0.5 ? 'rgba(160, 215, 120, 0.13)' : 'rgba(14, 40, 24, 0.35)';
    k.fillRect(hash(i, 101) * c.width, hash(i, 211) * c.height, 1.5, 3 + hash(i, 401) * 3);
  }
  // suelo de las parcelas: tierra batida con losetas
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const i = y * map.w + x;
      if (map.plotOf[i] < 0 || map.tiles[i] === 1) continue;
      const n = hash(x, y);
      k.fillStyle = `hsl(${32 + n * 8} ${24 + n * 6}% ${21 + n * 5}%)`;
      k.fillRect(x * TILE, y * TILE, TILE, TILE);
      k.fillStyle = 'rgba(255, 235, 200, 0.05)';
      k.fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, 2);
      k.fillStyle = 'rgba(0, 0, 0, 0.12)';
      k.fillRect(x * TILE, y * TILE + TILE - 1, TILE, 1);
    }
  }
  // plaza de la guarida: piedra rojiza y un círculo ritual
  const pz = map.plaza;
  for (let y = pz.y; y < pz.y + pz.h; y++)
    for (let x = pz.x; x < pz.x + pz.w; x++) {
      const n = hash(x + 3, y + 9);
      k.fillStyle = `hsl(14 ${18 + n * 8}% ${17 + n * 5}%)`;
      k.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  {
    const cx = (map.camp.x + 0.5) * TILE;
    const cy = (map.camp.y + 0.5) * TILE;
    k.strokeStyle = 'rgba(255, 120, 70, 0.28)';
    k.lineWidth = 3;
    for (const r of [3.2, 5.6]) {
      k.beginPath();
      k.arc(cx, cy, r * TILE, 0, Math.PI * 2);
      k.stroke();
    }
  }
  // roca: acantilado con cara superior clara y frente oscuro
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.tiles[y * map.w + x] !== 1) continue;
      const n = hash(x + 91, y + 17);
      const px = x * TILE;
      const py = y * TILE;
      const below = y + 1 < map.h && map.tiles[(y + 1) * map.w + x] !== 1;
      k.fillStyle = '#15181f';
      k.fillRect(px, py, TILE, TILE);
      const top = k.createLinearGradient(0, py, 0, py + TILE);
      top.addColorStop(0, `hsl(214 12% ${46 + n * 8}%)`);
      top.addColorStop(1, `hsl(214 12% ${33 + n * 6}%)`);
      k.fillStyle = top;
      k.beginPath();
      k.roundRect(px + 0.5, py, TILE - 1, below ? TILE - 7 : TILE, 4);
      k.fill();
      k.fillStyle = 'rgba(255, 255, 255, 0.09)';
      k.fillRect(px + 3, py + 2, TILE - 8, 2);
      if (below) {
        k.fillStyle = 'rgba(0, 0, 0, 0.35)';
        k.fillRect(px, py + TILE, TILE, 5);
      }
    }
  }
  return c;
}

function drawMiniBase(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = map.w * 2;
  c.height = map.h * 2;
  const k = c.getContext('2d')!;
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const i = y * map.w + x;
      const t = map.tiles[i];
      k.fillStyle = t === 1 ? '#596273' : t === 2 ? '#1f5a34' : map.noBuild[i] ? '#5a2f27' : map.plotOf[i] >= 0 ? '#5b4c39' : '#1e3a26';
      k.fillRect(x * 2, y * 2, 2, 2);
    }
  return c;
}

// ---------- DOM ----------
function build(): void {
  if (built) return;
  built = true;
  root = document.getElementById('screen-hunt')!;
  root.innerHTML = `
    <canvas id="hunt-canvas"></canvas>
    <div class="hk-top">
      <div class="hk-res" id="hk-res"></div>
      <div class="hk-clock" id="hk-clock"></div>
      <div class="hk-team" id="hk-team"></div>
    </div>
    <div class="hk-banner" id="hk-banner" hidden></div>
    <div class="hk-toasts"></div>
    <div class="hk-mini"><canvas id="hk-mini"></canvas></div>
    <div class="hk-card-wrap">
      <div class="hk-unitbar" id="hk-unitbar"></div>
      <div class="hk-card" id="hk-card"></div>
    </div>
    <div class="hk-panel" id="hk-panel" hidden></div>
    <div class="hk-shop" id="hk-shop" hidden></div>
    <div class="hk-modal" id="hk-modal" hidden></div>
    <div class="hk-tip" id="hk-tip" hidden></div>
    <div class="hk-end" id="hk-end" hidden></div>`;
  canvas = root.querySelector('#hunt-canvas')!;
  g = canvas.getContext('2d')!;
  mini = root.querySelector('#hk-mini')!;
  mini.width = map.w * 2;
  mini.height = map.h * 2;

  canvas.addEventListener('pointermove', (e) => {
    mouse.sx = e.clientX;
    mouse.sy = e.clientY;
    const w = toWorld(e.clientX, e.clientY);
    mouse.x = w.x;
    mouse.y = w.y;
    mouse.in = true;
  });
  canvas.addEventListener('pointerleave', () => (mouse.in = false));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    unlockAudio();
    const w = toWorld(e.clientX, e.clientY);
    onWorldClick(w.x, w.y, e.button === 2);
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom = Math.min(1.8, Math.max(0.35, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    },
    { passive: false },
  );
  mini.addEventListener('pointerdown', (e) => {
    const r = mini.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * map.w;
    const y = ((e.clientY - r.top) / r.height) * map.h;
    if (e.button === 2 && cur && form() !== 'spectator') send({ k: 'move', x, y });
    else {
      follow = false;
      cam.x = x;
      cam.y = y;
    }
  });
  mini.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', (e) => keys.delete(e.key));
  root.addEventListener('click', onUiClick);
  root.addEventListener('pointerover', onUiHover);
  root.addEventListener('pointerout', (e) => {
    if ((e.target as HTMLElement).closest('[data-tip]')) root.querySelector<HTMLElement>('#hk-tip')!.hidden = true;
  });
  requestAnimationFrame(frame);
}

function cellPx(): number {
  return 40 * zoom * (window.devicePixelRatio || 1);
}
function toWorld(clientX: number, clientY: number): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const s = cellPx();
  return { x: cam.x + ((clientX - r.left) * dpr - canvas.width / 2) / s, y: cam.y + ((clientY - r.top) * dpr - canvas.height / 2) / s };
}

// ---------- entrada ----------
function myUnit(): HuntSnapUnit | undefined {
  const i = meIdx();
  return cur?.snap.units.find((u) => u[2] === i && u[1] <= 3);
}
function myBuildings(): HuntSnapBuilding[] {
  const i = meIdx();
  return cur ? cur.snap.buildings.filter((b) => b[2] === i) : [];
}
const isEnemyUnit = (u: HuntSnapUnit): boolean => {
  const m = me();
  if (!m) return false;
  const enemyKinds = m.side === 'hunter' ? ['elf', 'angel', 'repairer', 'lumberjack'] : ['hunter', 'wolf'];
  return enemyKinds.includes(UNIT_KIND_ORDER[u[1]]);
};

function onWorldClick(x: number, y: number, right: boolean): void {
  if (!cur || !init || cur.snap.over) return;
  const m = me();
  if (!m || m.form === 'choosing') return;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (right) {
    if (placing || targeting || useSlot >= 0) {
      placing = null;
      targeting = null;
      useSlot = -1;
      return;
    }
    follow = true;
    // clic derecho «inteligente», como en el Dota: sobre algo de los tuyos que
    // esté dañado, ir a repararlo; sobre un enemigo, atacarlo; si no, moverse
    const bAt = cur.snap.buildings.find((o) => cx >= o[3] && cx < o[3] + bSize(o) && cy >= o[4] && cy < o[4] + bSize(o));
    const allyB = bAt && (m.side === 'elf' ? init!.players[bAt[2]] && cur.snap.players[bAt[2]] && ['elf', 'angel', 'choosing', 'dead'].includes(cur.snap.players[bAt[2]].form) : false);
    if (m.side === 'elf' && (m.form === 'elf' || m.form === 'angel') && bAt && allyB) {
      send({ k: 'repair', target: bAt[0] });
      ring(bAt[3] + bSize(bAt) / 2, bAt[4] + bSize(bAt) / 2, '#ffe9a8', 1);
      if (bAt[6] >= bAt[7]) toast('Ese edificio ya está entero');
      return;
    }
    if (m.side === 'hunter') {
      const enemy = cur.snap.units.find((u) => isEnemyUnit(u) && Math.hypot(u[3] - x, u[4] - y) < 0.8);
      if (enemy) {
        send({ k: 'attack', target: enemy[0] });
        ring(enemy[3], enemy[4], '#ff5a4e');
        return;
      }
      if (bAt) {
        send({ k: 'attack', target: bAt[0] });
        ring(bAt[3] + bSize(bAt) / 2, bAt[4] + bSize(bAt) / 2, '#ff5a4e');
        return;
      }
    }
    moveTo(x, y);
    return;
  }
  if (useSlot >= 0) {
    send({ k: 'use', slot: useSlot, x, y });
    useSlot = -1;
    return;
  }
  if (targeting) {
    const def = ABILITIES[targeting];
    if (def.target === 'building') {
      const b = myBuildings().find((o) => cx >= o[3] && cx < o[3] + bSize(o) && cy >= o[4] && cy < o[4] + bSize(o));
      if (!b) {
        toast('Elige un edificio tuyo', true);
        return;
      }
      send({ k: 'ability', a: targeting, target: b[0] });
    } else send({ k: 'ability', a: targeting, x, y });
    targeting = null;
    return;
  }
  if (placing) {
    send({ k: 'build', type: placing, cx: placeCell(x, placing).x, cy: placeCell(y, placing).y });
    ring(cx + 0.5, cy + 0.5, '#ffcd45');
    if (!keys.has('Shift')) placing = null;
    return;
  }
  // ¿clic sobre un edificio propio? → seleccionar
  const own = myBuildings().find((o) => cx >= o[3] && cx < o[3] + bSize(o) && cy >= o[4] && cy < o[4] + bSize(o));
  if (own && m.side === 'elf') {
    // Mayús+clic (o el ángel): ir a repararlo
    if (m.form === 'angel' || (keys.has('Shift') && own[6] < own[7])) {
      send({ k: 'repair', target: own[0] });
      ring(own[3] + bSize(own) / 2, own[4] + bSize(own) / 2, '#ffe9a8');
      if (m.form === 'angel') return;
    }
    selected = own[0];
    return;
  }
  if (m.side === 'elf' && m.form === 'angel') {
    const ally = cur.snap.buildings.find((o) => cx >= o[3] && cx < o[3] + bSize(o) && cy >= o[4] && cy < o[4] + bSize(o));
    if (ally) {
      send({ k: 'repair', target: ally[0] });
      ring(ally[3] + bSize(ally) / 2, ally[4] + bSize(ally) / 2, '#ffe9a8');
      return;
    }
  }
  if (m.side === 'hunter') {
    const enemy = cur.snap.units.find((u) => isEnemyUnit(u) && Math.hypot(u[3] - x, u[4] - y) < 0.8);
    if (enemy) {
      send({ k: 'attack', target: enemy[0] });
      ring(enemy[3], enemy[4], '#ff5a4e');
      follow = true;
      return;
    }
    const b = cur.snap.buildings.find((o) => cx >= o[3] && cx < o[3] + bSize(o) && cy >= o[4] && cy < o[4] + bSize(o));
    if (b) {
      send({ k: 'attack', target: b[0] });
      ring(b[3] + bSize(b) / 2, b[4] + bSize(b) / 2, '#ff5a4e');
      follow = true;
      return;
    }
  }
  selected = 0;
  follow = true;
  moveTo(x, y);
}

function moveTo(x: number, y: number): void {
  send({ k: 'move', x, y });
  ring(x, y, '#9be28a');
  const u = myUnit();
  if (u) {
    const d = disp.get(u[0]) ?? { x: u[3], y: u[4] };
    predict = { tx: x, ty: y, t0: performance.now(), from: { ...d }, serverAt: [u[3], u[4]], offset: null, blendT0: 0, prevDest: String(cur?.snap.me?.dest ?? '') };
  }
}

// velocidad propia aproximada (casillas/s) para la predicción
function mySpeed(): number {
  const m = me();
  if (!m) return 2;
  if (m.form === 'hunter' || m.form === 'wolf') return m.stats.speed;
  if (m.form === 'angel') return 280 / 128;
  return (cur?.snap.releaseIn ?? 0) > 0 ? 522 / 128 : 250 / 128;
}
const bSize = (b: HuntSnapBuilding): number => BUILDINGS[BUILDING_ORDER[b[1]]].size;
// los edificios 2×2 se centran en el cursor
const placeCell = (v: number, t: BuildingType): { x: number; y: number } => {
  const s = BUILDINGS[t].size;
  const c = s === 2 ? Math.round(v) - 1 : Math.floor(v);
  return { x: c, y: c };
};

function abilitiesOfMe(): Ability[] {
  const m = me();
  if (!m) return [];
  const list = [...(FORM_ABILITIES[m.form as keyof typeof FORM_ABILITIES] ?? [])];
  const extra = m.form === 'elf' && m.spec ? SPEC_ABILITY[m.spec] : undefined;
  if (extra) list.push(extra);
  return list;
}

function trigger(a: Ability): void {
  const def = ABILITIES[a];
  const m = me();
  if (!m) return;
  if ((m.cds[a] ?? 0) > 0) {
    toast(`${def.name}: ${m.cds[a]} s`, true);
    return;
  }
  placing = null;
  if (def.target === 'point' || def.target === 'building') targeting = targeting === a ? null : a;
  else send({ k: 'ability', a });
}

function onKey(e: KeyboardEvent): void {
  if (!active || !cur) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  keys.add(e.key);
  const k = e.key.toLowerCase();
  const m = me();
  if (k === 'escape') {
    placing = null;
    targeting = null;
    useSlot = -1;
    selected = 0;
    shopOpen = false;
    return;
  }
  if (k === ' ') {
    follow = true;
    e.preventDefault();
    return;
  }
  if (!m || cur.snap.over) return;
  // atajos de habilidades (por su tecla)
  for (const a of abilitiesOfMe()) {
    if (ABILITIES[a].key.toLowerCase() === k) {
      trigger(a);
      return;
    }
  }
  if (m.form === 'elf') {
    const t = BUILDING_ORDER.find((b) => BUILDINGS[b].hotkey === k);
    if (t) {
      placing = placing === t ? null : t;
      targeting = null;
      return;
    }
    if (k === 'u' && selected) upgradeSelected();
    if (k === 'delete' && selected) send({ k: 'demolish', id: selected });
  }
  if (m.side === 'hunter') {
    const n = Number(k);
    if (n >= 1 && n <= INVENTORY_SLOTS) useItem(n - 1);
    if (k === 'g') shopOpen = !shopOpen;
  }
  if (k === 's') send({ k: 'stop' });
}

function useItem(slot: number): void {
  const m = me();
  const it = m?.inv[slot];
  if (!it || it.kind !== 'cons') return;
  if (it.c === 'ward' || it.c === 'voodoo') useSlot = slot;
  else if (it.c !== 'ankh') send({ k: 'use', slot });
}

function upgradeSelected(branch?: string): void {
  if (selected) send({ k: 'upgrade', id: selected, ...(branch ? { branch } : {}) });
}

function onUiClick(e: Event): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el || !cur) return;
  unlockAudio();
  const a = el.dataset.act!;
  const v = el.dataset.v ?? '';
  const n = Number(el.dataset.n ?? 0);
  switch (a) {
    case 'place':
      placing = placing === v ? null : (v as BuildingType);
      targeting = null;
      break;
    case 'ability':
      trigger(v as Ability);
      break;
    case 'upgrade':
      upgradeSelected(v || undefined);
      break;
    case 'demolish':
      send({ k: 'demolish', id: selected });
      break;
    case 'train':
      send({ k: 'train', id: selected, unit: v as 'repairer' | 'lumberjack', tier: n });
      break;
    case 'market':
      send({ k: 'market', buy: v === 'buy' });
      break;
    case 'spec':
      send({ k: 'spec', s: v as (typeof SPEC_ORDER)[number] });
      root.querySelector<HTMLElement>('#hk-modal')!.hidden = true;
      break;
    case 'book':
      openBook();
      break;
    case 'form':
      send({ k: 'form', f: v as 'angel' | 'wolf' });
      break;
    case 'shop':
      shopOpen = !shopOpen;
      break;
    case 'buy':
      send({ k: 'buy', line: v as ItemLine, tier: n });
      break;
    case 'buycons':
      send({ k: 'buycons', c: v as Consumable });
      break;
    case 'buytrinket':
      send({ k: 'buytrinket', t: v as Trinket });
      break;
    case 'beast':
      send({ k: 'beast' });
      break;
    case 'mage':
      send({ k: 'mage' });
      break;
    case 'lots':
      send({ k: 'lots', id: selected });
      break;
    case 'eat':
      send({ k: 'eat', id: selected });
      break;
    case 'give': {
      const m2 = me();
      if (m2) send({ k: 'give', to: v, gold: Math.floor(m2.gold * (n / 100)), wood: 0 });
      break;
    }
    case 'buywood':
      send({ k: 'buywood' });
      break;
    case 'hut':
      send({ k: 'hut' });
      break;
    case 'slot':
      if ((e as MouseEvent).shiftKey && me()?.nearShop) send({ k: 'sell', slot: n });
      else useItem(n);
      break;
    case 'sell':
      send({ k: 'sell', slot: n });
      break;
    case 'close':
      if (v === 'panel') selected = 0;
      if (v === 'shop') shopOpen = false;
      if (v === 'modal') root.querySelector<HTMLElement>('#hk-modal')!.hidden = true;
      break;
    case 'focus':
      follow = true;
      break;
  }
  hashes.card = '';
  hashes.panel = '';
  hashes.shop = '';
}

function onUiHover(e: Event): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
  const tip = root.querySelector<HTMLElement>('#hk-tip')!;
  if (!el) return;
  tip.innerHTML = el.dataset.tip!;
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  tip.style.left = `${Math.min(window.innerWidth - 300, Math.max(8, r.left + r.width / 2 - 140))}px`;
  tip.style.bottom = `${window.innerHeight - r.top + 8}px`;
}

function openBook(): void {
  const modal = root.querySelector<HTMLElement>('#hk-modal')!;
  modal.innerHTML = `<div class="hk-modal-box">
    <div class="hk-modal-head"><span>${icon('hk:book', '📖')} Libro de especialidades</span><button data-act="close" data-v="modal">✕</button></div>
    <p class="hk-sub">Elige UNA para toda la partida. Las estrellas dicen lo recomendable que es para empezar.</p>
    <div class="hk-choices book">${SPEC_ORDER.map(
      (s) => `<button class="hk-choice" data-act="spec" data-v="${s}"><span class="ic">${icon(SPECS[s].icon)}</span><b>${SPECS[s].name}</b><span class="stars">${'★'.repeat(SPECS[s].stars)}${'☆'.repeat(3 - SPECS[s].stars)}</span><small>${SPECS[s].desc}</small></button>`,
    ).join('')}</div></div>`;
  modal.hidden = false;
}

// ---------- efectos ----------
function ring(x: number, y: number, color: string, r = 0.6): void {
  fx.push({ kind: 'ring', x, y, r, color, born: performance.now(), life: 450 });
}
function floatText(x: number, y: number, text: string, color: string): void {
  fx.push({ kind: 'text', x, y, text, color, born: performance.now(), life: 1000 });
}
const FX_COLOR: Partial<Record<string, string>> = {
  blind: '#6b6f80',
  moonlight: '#c9d8ff',
  fullforce: '#ff9b4e',
  pack: '#ffcd45',
  retrofit: '#ffe066',
  ams: '#9fd4ff',
  wolfams: '#9fd4ff',
  bloodlust: '#ff5a4e',
  occult: '#7fe0d0',
  voodoo: '#d08bff',
  potion: '#9fd4ff',
  roots: '#7bd88f',
  silence: '#b48cff',
  stun: '#ffe066',
  eye: '#ff7a5c',
  trap_fire: '#ff5a4e',
  moonguard: '#9fd4ff',
  holylight: '#fff3a8',
  howl: '#c9b6ff',
  ward: '#7bd88f',
  recall: '#ff9b4e',
  scroll: '#ff9b4e',
  blink: '#8fd3ff',
  angelblink: '#ffffff',
};

function onEvents(events: HuntEvent[]): void {
  const now = performance.now();
  for (const ev of events) {
    switch (ev.e) {
      case 'hit':
        fx.push({ kind: 'slash', x: ev.x, y: ev.y, color: '#ffe1dc', born: now, life: 220 });
        if (ev.by === meId() && ev.gold > 0) floatText(ev.x, ev.y - 0.4, `+${fmt(ev.gold)}`, '#ffcd45');
        else if (ev.dmg > 0) floatText(ev.x, ev.y - 0.4, `-${fmt(ev.dmg)}`, '#ff8f86');
        else floatText(ev.x, ev.y - 0.4, 'inmune', '#9fd4ff');
        sfx.shot(0);
        break;
      case 'shot':
        {
          const c: Record<string, string> = { chain: '#8fd3ff', burn: '#ff8a3d', poison: '#7bd88f', frost: '#bfe6ff', corrupt: '#b48cff', mage: '#e2c6ff' };
          fx.push({ kind: ev.fx === 'mage' ? 'beam' : 'shot', x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, color: (ev.fx && c[ev.fx]) || (ev.gold ? '#ffd54f' : '#fff0c0'), born: now, life: ev.fx ? 260 : 170 });
        }
        if (ev.dmg > 0) floatText(ev.tx, ev.ty - 1.2, `-${fmt(ev.dmg)}`, '#fff0c0');
        break;
      case 'built':
        ring(ev.x, ev.y, '#ffcd45', 0.9);
        sfx.place(0);
        break;
      case 'upgraded':
        ring(ev.x, ev.y, '#ffcd45', 1.1);
        floatText(ev.x, ev.y - 0.8, ev.name, '#ffcd45');
        sfx.upgrade(0);
        break;
      case 'destroyed':
        fx.push({ kind: 'burst', x: ev.x, y: ev.y, color: '#ff8a5c', born: now, life: 600 });
        for (const [id, b] of ghosts) if (b[3] + bSize(b) / 2 === ev.x && b[4] + bSize(b) / 2 === ev.y) ghosts.delete(id);
        sfx.boom(0);
        break;
      case 'death':
        fx.push({ kind: 'burst', x: ev.x, y: ev.y, color: '#ff5a4e', born: now, life: 900 });
        if (ev.left < 0) toast(`${icon('hk:troll')} ¡El cazador ha caído!`);
        else
          toast(
            ev.playerId === meId()
              ? `☠ Te alcanzó el cazador${ev.bounty ? ` (se llevó ${fmt(ev.bounty)} de oro)` : ''}`
              : `☠ ${esc(ev.name)} ha caído · quedan ${ev.left}`,
            true,
          );
        sfx.leak();
        break;
      case 'unitdeath':
        fx.push({ kind: 'burst', x: ev.x, y: ev.y, color: '#ffb4ad', born: now, life: 400 });
        break;
      case 'fx': {
        const color = FX_COLOR[ev.a] ?? '#fff';
        if (ev.tx !== undefined) {
          fx.push({ kind: 'beam', x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, color, born: now, life: 380 });
          ring(ev.tx, ev.ty ?? ev.y, color, 0.8);
        }
        ring(ev.x, ev.y, color, ev.r ?? 0.9);
        if (ev.a === 'trap_fire') toast(`${icon('hk:trap')} ¡Una trampa del cazador ha saltado!`, me()?.side === 'elf');
        if (ev.a === 'eye' && me()?.side === 'elf') toast(`${icon('hk:eye')} El cazador está mirando con su Ojo`, true);
        break;
      }
      case 'released':
        toast(me()?.side === 'hunter' ? `${icon('hk:troll')} ¡Estás libre! A cazar.` : `${icon('hk:troll')} ¡El cazador anda suelto!`, true);
        sfx.boss();
        break;
      case 'shared':
        toast('👁 Los colonos ya comparten visión');
        break;
      case 'exposed':
        if (ev.names.length) toast(`🔦 Sin casa y a la vista del cazador: ${ev.names.map(esc).join(', ')}`, true);
        break;
      case 'levelup':
        ring(ev.x, ev.y, '#ffd54f', 1.6);
        floatText(ev.x, ev.y - 2, `¡Nivel ${ev.level}!`, '#ffd54f');
        if (ev.playerId === meId()) sfx.upgrade(0);
        break;
      case 'form':
        toast(`${ev.form === 'angel' ? icon('hk:angel') : icon('hk:wolf')} ${esc(ev.name)} vuelve como ${ev.form === 'angel' ? 'ángel' : 'lobo'}`);
        break;
      case 'steal':
        floatText(ev.x, ev.y - 0.8, `+${fmt(ev.gold)}`, '#ffd54f');
        break;
      case 'miss':
        floatText(ev.x, ev.y - 0.5, 'falla', '#c9c9d1');
        break;
      case 'treeeaten':
        fx.push({ kind: 'burst', x: ev.x, y: ev.y, color: '#7bd88f', born: now, life: 700 });
        break;
      case 'mage':
        ring(ev.x, ev.y, '#c4a5ff', 3);
        toast(`${icon('hk:mage')} ¡Ha nacido un Mago élfico!`);
        break;
      case 'bought':
        toast(ev.text);
        sfx.coin();
        break;
      case 'reject':
        toast(esc(ev.reason), true);
        sfx.error();
        break;
    }
  }
}

// ---------- HUD ----------
function setHtml(id: string, html: string): void {
  if (hashes[id] === html) return;
  hashes[id] = html;
  root.querySelector(`#${id}`)!.innerHTML = html;
}

function syncHud(): void {
  if (!cur || !init) return;
  const s = cur.snap;
  const m = s.me;

  // --- recursos ---
  let res = '';
  if (m) {
    const role =
      m.form === 'hunter' ? 'Cazador' : m.form === 'elf' ? 'Colono' : m.form === 'angel' ? 'Ángel' : m.form === 'wolf' ? 'Lobo' : 'Caído';
    const roleIcon = m.form === 'hunter' ? 'hk:troll' : m.form === 'wolf' ? 'hk:wolf' : m.form === 'angel' ? 'hk:angel' : 'hk:elf';
    res += `<span class="hk-chip role ${m.side}" data-act="focus" data-tip="Centrar la cámara (Espacio)">${icon(roleIcon)} ${role}${m.side === 'hunter' ? ` <small>nv ${m.level}</small>` : ''}</span>`;
    res += `<span class="hk-chip gold">${icon('hk:gold', '🪙')} ${fmt(m.gold)}${m.income ? `<small>+${fmt(m.income)}/s</small>` : ''}</span>`;
    res += `<span class="hk-chip wood">${icon('hk:wood', '🪵')} ${fmt(m.wood)}${m.woodRate ? `<small>+${m.woodRate}/s</small>` : ''}</span>`;
    if (m.form === 'elf') res += `<span class="hk-chip" data-tip="Comida: la consumen los reparadores. La casa da más.">${icon('hk:food', '🍞')} ${m.food[0]}/${m.food[1]}</span>`;
  } else res = `<span class="hk-chip">👁 Espectador</span>`;
  setHtml('hk-res', res);

  // --- reloj y fases ---
  const mm = Math.floor(s.sec / 60);
  const ss = String(s.sec % 60).padStart(2, '0');
  let phase = '';
  if (s.releaseIn > 0) phase = `<span class="ph red">El cazador sale en <b>${s.releaseIn}</b></span>`;
  else if (s.sharedIn > 0) phase = `<span class="ph">Visión compartida en <b>${Math.ceil(s.sharedIn / 60)} min</b></span>`;
  else if (s.exposeIn > 0) phase = `<span class="ph">Quien no tenga casa quedará expuesto en <b>${Math.ceil(s.exposeIn / 60)} min</b></span>`;
  setHtml('hk-clock', `<span class="hk-chip time">${s.night ? '🌙' : '☀️'} ${mm}:${ss}</span>${phase}<span class="hk-chip market" data-tip="Precio de 10 de madera en el mercado (comprar / vender)">${icon('hk:wood')} ${s.market + MARKET.step}/${s.market}</span>`);

  // --- equipo ---
  setHtml(
    'hk-team',
    init.players
      .map((p) => {
        const sp = s.players.find((q) => q.id === p.id);
        const f = sp?.form ?? '';
        const ic = f === 'hunter' ? 'hk:troll' : f === 'wolf' ? 'hk:wolf' : f === 'angel' ? 'hk:angel' : f === 'elf' ? 'hk:elf' : '';
        const gold = sp && sp.gold >= 0 && p.id !== meId() ? `<small>${fmt(sp.gold)}</small>` : '';
        const ally = s.me && sp && p.id !== meId() && sp.gold >= 0 && (sp.form === 'hunter' || sp.form === 'wolf' ? 'hunter' : 'elf') === s.me.side;
        const give = ally && s.me!.gold > 0 ? `<button class="give" data-act="give" data-v="${p.id}" data-n="50" data-tip="Darle la mitad de tu oro">${icon('hk:gold')}½</button><button class="give" data-act="give" data-v="${p.id}" data-n="100" data-tip="Darle todo tu oro">${icon('hk:gold')}todo</button>` : '';
        return `<span class="tm${sp?.alive ? '' : ' down'}${!sp?.connected ? ' off' : ''}"><i style="background:${p.color}"></i>${ic ? icon(ic) : '☠'} ${esc(p.name)}${p.id === meId() ? ' (tú)' : ''}${f === 'hunter' || f === 'wolf' ? ` <small>nv ${sp?.level}</small>` : ''}${gold}${give}</span>`;
      })
      .join(''),
  );

  // --- cartel central ---
  const banner = root.querySelector<HTMLElement>('#hk-banner')!;
  let bh = '';
  if (m && m.form === 'hunter' && s.releaseIn > 0)
    bh = `<b>${s.releaseIn}</b><span>Estás retenido en tu guarida. Los colonos se esconden. Ve comprando en la tienda (G).</span>`;
  else if (m && m.form === 'elf' && s.releaseIn > 0)
    bh = `<b>${s.releaseIn}</b><span>¡Corre! Elige una parcela, cierra sus puertas con murallas y construye tu casa.</span>`;
  else if (m && m.channel > 0) bh = `<b class="calm">Volviendo a la guarida… ${m.channel}</b>`;
  else if (m && m.respawn > 0) bh = `<b class="calm">Vuelves en ${m.respawn}</b>`;
  if (bh !== hashes.banner) {
    hashes.banner = bh;
    banner.innerHTML = bh;
    banner.hidden = !bh;
  }

  syncCard();
  syncPanel();
  syncShop();
  syncChoose();
}

function abilityButton(a: Ability): string {
  const def = ABILITIES[a];
  const cd = me()?.cds[a] ?? 0;
  const tip = `<b>${def.name}</b> <kbd>${def.key}</kbd><br>${esc(def.desc)}<br><small>Recarga ${def.cd} s</small>`;
  return `<button class="hk-btn ab${targeting === a ? ' on' : ''}" data-act="ability" data-v="${a}" data-tip="${esc(tip)}">
    <span class="ic">${icon(def.icon, def.emoji)}</span><kbd>${def.key}</kbd>${cd > 0 ? `<span class="cd">${cd}</span>` : ''}</button>`;
}

function syncCard(): void {
  const m = me();
  const s = cur!.snap;
  let unitbar = '';
  let card = '';
  if (!m || s.over || m.form === 'choosing') {
    setHtml('hk-unitbar', '');
    setHtml('hk-card', '');
    return;
  }
  const u = myUnit();
  if (u) {
    const frac = Math.max(0, u[5] / u[6]);
    if (m.side === 'hunter') {
      const xpFrac = m.xpNext > m.xpPrev ? (m.xp - m.xpPrev) / (m.xpNext - m.xpPrev) : 0;
      unitbar = `<div class="hk-bars">
        <div class="bar hp"><i style="width:${frac * 100}%"></i><span>${fmt(u[5])} / ${fmt(u[6])}</span></div>
        <div class="bar xp"><i style="width:${Math.min(1, xpFrac) * 100}%"></i><span>nivel ${m.level} · ${fmt(m.xp - m.xpPrev)}/${fmt(m.xpNext - m.xpPrev)} xp</span></div>
      </div>
      <div class="hk-stats">⚔ ${fmt(m.stats.dmg)} · 🛡 ${fmt(m.stats.armor)} · ⏱ ${m.stats.attackSec}s · 👣 ${m.stats.speed} · ❤ +${fmt(m.stats.regen)}/s${m.attrs[0] || m.attrs[1] ? ` · 💪 ${fmt(m.attrs[0])} · 🏹 ${fmt(m.attrs[1])}` : ''}</div>`;
    } else {
      unitbar = `<div class="hk-bars"><div class="bar hp small"><i style="width:${frac * 100}%"></i><span>${u[5]} / ${u[6]}</span></div></div>`;
    }
  }
  const abilities = abilitiesOfMe().map(abilityButton).join('');
  if (m.form === 'elf') {
    const mine = myBuildings();
    const builds = BUILDING_ORDER.map((t) => {
      const d = BUILDINGS[t];
      const l1 = levelDef(t, 1, null, 'main');
      const have = mine.filter((b) => BUILDING_ORDER[b[1]] === t).length;
      const req = reqText(l1.req);
      const off = have >= d.limit || !!req;
      const tip = `<b>${d.name}</b> <kbd>${d.hotkey}</kbd> · ${costHtml(l1.gold, l1.wood)}<br>${esc(d.desc)}${req ? `<br><em>${req}</em>` : ''}`;
      return `<button class="hk-btn bd${placing === t ? ' on' : ''}${off ? ' off' : !afford(l1.gold, l1.wood) ? ' poor' : ''}" data-act="place" data-v="${t}" data-tip="${esc(tip)}">
        <span class="ic">${icon(d.icon, d.emoji)}</span><kbd>${d.hotkey}</kbd><span class="ct">${l1.gold || l1.wood ? costHtml(l1.gold, l1.wood) : 'gratis'}</span>${d.limit < 10 ? `<span class="nb">${have}/${d.limit}</span>` : ''}</button>`;
    }).join('');
    const market = `<div class="hk-market">
      <button class="hk-btn sm${afford(s.market + MARKET.step, 0) ? '' : ' poor'}" data-act="market" data-v="buy" data-tip="Compra ${MARKET.lot} de madera. Cada compra la encarece para todos.">${icon('hk:wood')}+${MARKET.lot} <small>${icon('hk:gold')}${s.market + MARKET.step}</small></button>
      <button class="hk-btn sm${m.wood >= MARKET.lot ? '' : ' poor'}" data-act="market" data-v="sell" data-tip="Vende ${MARKET.lot} de madera.">${icon('hk:wood')}−${MARKET.lot} <small>${icon('hk:gold')}${s.market}</small></button>
    </div>`;
    const book = m.spec
      ? `<span class="hk-spec" data-tip="${esc(`<b>${SPECS[m.spec].name}</b><br>${SPECS[m.spec].desc}`)}">${icon(SPECS[m.spec].icon)}</span>`
      : `<button class="hk-btn ab book" data-act="book" data-tip="Elige una especialidad para toda la partida">${icon('hk:book', '📖')}<span class="dot"></span></button>`;
    const mage =
      m.mageReady > 0
        ? `<button class="hk-btn ab${m.mageReady >= MAGE_FUSION_TOWERS ? '' : ' poor'}" data-act="mage" data-tip="${esc(`<b>Mago élfico</b><br>Funde ${MAGE_FUSION_TOWERS} torres del misterio en un mago que te sigue y fulmina al cazador.<br>Tienes ${m.mageReady}.`)}"><span class="ic">${icon('hk:mage')}</span><span class="nb">${m.mageReady}</span></button>`
        : '';
    card = `<div class="hk-group"><div class="hk-label">Construir</div><div class="hk-row">${builds}</div></div>
      <div class="hk-group"><div class="hk-label">Habilidades</div><div class="hk-row">${abilities}${book}${mage}</div></div>
      <div class="hk-group"><div class="hk-label">Mercado</div>${market}</div>`;
  } else if (m.side === 'hunter') {
    const inv = m.inv
      .map((it, i) => {
        if (!it) return `<button class="hk-slot empty" data-act="slot" data-n="${i}"><kbd>${i + 1}</kbd></button>`;
        if (it.kind === 'cons') {
          const c = CONSUMABLES[it.c];
          return `<button class="hk-slot" data-act="slot" data-n="${i}" data-tip="${esc(`<b>${c.name}</b><br>${c.desc}${it.c !== 'ankh' ? '<br><small>Clic para usar</small>' : ''}`)}"><span class="ic">${icon(c.icon)}</span><kbd>${i + 1}</kbd></button>`;
        }
        if (it.kind === 'trinket') {
          const t = TRINKETS[it.t];
          return `<button class="hk-slot t2" data-act="slot" data-n="${i}" data-tip="${esc(`<b>${t.name}</b><br>${t.desc}<br><small>Mayús+clic en la guarida: vender por la mitad</small>`)}"><span class="ic">${icon(t.icon)}</span></button>`;
        }
        const tier = ITEMS[it.line].tiers[it.tier];
        const stat = it.line === 'gloves' ? `+${Math.round(tier.value * 100)} %` : `+${fmt(tier.value)}`;
        return `<button class="hk-slot t${Math.min(4, Math.floor(it.tier / 3))}" data-act="slot" data-n="${i}" data-tip="${esc(`<b>${tier.name}</b><br>${stat} ${ITEMS[it.line].stat}<br><small>Mayús+clic en la guarida: vender por la mitad</small>`)}"><span class="ic">${icon(tier.icon)}</span><span class="lv">${it.tier + 1}</span></button>`;
      })
      .join('');
    const boots = m.boots >= 0 ? ITEMS.boots.tiers[m.boots] : null;
    const bootsSlot = `<button class="hk-slot boots${boots ? ' t1' : ' empty'}" data-tip="${esc(boots ? `<b>${boots.name}</b><br>+${Math.round(boots.value * 128)} de velocidad<br><small>Hueco propio de las botas</small>` : 'Hueco para botas (cómpralas en la tienda)')}"><span class="ic">${icon('hk:item-boots')}</span></button>`;
    card = `<div class="hk-group"><div class="hk-label">Habilidades</div><div class="hk-row">${abilities}</div></div>
      <div class="hk-group"><div class="hk-label">Inventario</div><div class="hk-row inv">${inv}<span class="hk-sep"></span>${bootsSlot}</div></div>
      <div class="hk-group"><div class="hk-label">Guarida</div><div class="hk-row"><button class="hk-btn ab shopbtn${shopOpen ? ' on' : ''}" data-act="shop" data-tip="Tienda de la guarida (G). Solo se compra estando cerca."><span class="ic">${icon('hk:shop')}</span><kbd>G</kbd>${m.nearShop ? '<span class="dot"></span>' : ''}</button></div></div>`;
  } else if (m.form === 'angel') {
    card = `<div class="hk-group"><div class="hk-label">Ángel · ayuda a los colonos</div><div class="hk-row">${abilities}</div></div>
      <div class="hk-hint">Clic en un edificio de los colonos para repararlo. Roba oro junto a la guarida del cazador.</div>`;
  }
  setHtml('hk-unitbar', unitbar);
  setHtml('hk-card', card);
}

function syncPanel(): void {
  const panel = root.querySelector<HTMLElement>('#hk-panel')!;
  const b = selected && cur ? cur.snap.buildings.find((o) => o[0] === selected && o[2] === meIdx()) : undefined;
  const m = me();
  if (!b || !m || cur!.snap.over || m.form !== 'elf') {
    if (selected && !b) selected = 0;
    if (!panel.hidden) panel.hidden = true;
    hashes.panel = '';
    return;
  }
  const { type, wall, tower, def } = buildingInfo(b);
  const level = b[5];
  const maxLv = type === 'wall' ? wallMaxLevel(wall) : levelsOf(type);
  const lines: string[] = [];
  lines.push(`<div class="bar hp"><i style="width:${(b[6] / b[7]) * 100}%"></i><span>${fmt(b[6])} / ${fmt(b[7])}</span></div>`);
  const stat = (k: string, v: string) => `<span class="st"><em>${k}</em>${v}</span>`;
  const stats: string[] = [stat('armadura', String(def.armor))];
  if (def.income) stats.push(stat('oro/s', fmt(def.income * RESOURCE_MULT)));
  if (def.food) stats.push(stat('comida', `+${def.food}`));
  if (def.dmg) stats.push(stat('daño', fmt(def.dmg)), stat('cadencia', `${def.cd}s`), stat('alcance', def.range!.toFixed(1)));
  if (def.regen) stats.push(stat('regen', `${fmt(def.regen)}/s`));
  if (def.flatReduce) stats.push(stat('por golpe', `−${fmt(def.flatReduce)}`));
  if (def.thorns) stats.push(stat('espinas', fmt(def.thorns)));
  if (def.slowAura) stats.push(stat('congela', `−${Math.round(def.slowAura * 100)} %`));
  if (def.goldPerHit) stats.push(stat(type === 'wall' ? 'oro al recibir' : 'oro/disparo', `+${def.goldPerHit * RESOURCE_MULT}`));
  if (def.repairBonus) stats.push(stat('reparación', `+${Math.round(def.repairBonus * 100)} %`));
  lines.push(`<div class="hk-stats-grid">${stats.join('')}</div>`);

  let up = '';
  if (level < maxLv) {
    if (type === 'wall' && level === 5) {
      up = `<div class="hk-label">Especialidad (nivel 6)</div><div class="hk-branches">${WALL_BRANCH_ORDER.map((br) => {
        const nd = levelDef('wall', 6, br, 'main');
        const req = reqText(nd.req);
        return `<button class="hk-branch${!afford(nd.gold, nd.wood) || req ? ' poor' : ''}" data-act="upgrade" data-v="${br}" data-tip="${esc(`<b>${WALL_BRANCHES[br].name}</b> · ${fmt(nd.hp)} de vida, armadura ${nd.armor}<br>${WALL_BRANCHES[br].pitch}`)}">
          <span class="ic">${icon(WALL_BRANCHES[br].icon)}</span><b>${WALL_BRANCHES[br].name}</b><small>${costHtml(nd.gold, nd.wood)}</small></button>`;
      }).join('')}</div>`;
    } else {
      const nd = levelDef(type, level + 1, wall, tower);
      const req = reqText(nd.req);
      const delta: string[] = [];
      if (nd.hp !== def.hp) delta.push(`vida ${fmt(nd.hp)}`);
      if (nd.income && nd.income !== def.income) delta.push(`${fmt(nd.income * RESOURCE_MULT)} oro/s`);
      if (nd.dmg && nd.dmg !== def.dmg) delta.push(`daño ${fmt(nd.dmg)}`);
      if (nd.armor !== def.armor) delta.push(`armadura ${nd.armor}`);
      up = `<button class="hk-btn wide primary${!afford(nd.gold, nd.wood) || req ? ' poor' : ''}" data-act="upgrade" data-tip="${esc(`<b>${nd.name}</b><br>${delta.join(' · ')}${req ? `<br><em>${req}</em>` : ''}`)}">
          ${icon('hk:upgrade')} ${esc(nd.name)} <span class="ct">${costHtml(nd.gold, nd.wood)}</span><kbd>U</kbd></button>
        ${req ? `<div class="hk-req">${req}</div>` : ''}`;
      if (type === 'tower' && level === 2) {
        const gd = levelDef('tower', 3, null, 'gold');
        const greq = reqText(gd.req);
        up += `<button class="hk-btn wide${!afford(gd.gold, gd.wood) || greq ? ' poor' : ''}" data-act="upgrade" data-v="gold" data-tip="${esc('<b>Rama de oro</b><br>Pega menos, pero cada disparo al cazador te da oro.')}">
          ${icon('hk:tower-gold')} ${gd.name} <span class="ct">${costHtml(gd.gold, gd.wood)}</span></button>`;
      }
    }
  } else up = `<div class="hk-req ok">Nivel máximo</div>`;

  if (type === 'wall' && def.luck) {
    up += `<button class="hk-btn wide${b[12] > 0 ? ' poor' : ''}" data-act="lots" data-tip="${esc('<b>Sortear armadura</b><br>De 0 a 30 de armadura extra. Cada 3 minutos.')}">${icon('hk:wall-random')} Sortear armadura <span class="ct">${b[12] > 0 ? `${b[12]} s` : `ahora +${b[11]}`}</span></button>`;
  }
  if (type === 'wall' && def.eatsTree) {
    up += `<button class="hk-btn wide${b[9] & 64 ? ' poor' : ''}" data-act="eat" data-tip="${esc(`<b>Comerse un árbol</b><br>Uno a 4 casillas como mucho: +${fmt(def.eatsTree)} de vida en 30 s. El árbol vuelve a crecer al minuto.`)}">${icon('hk:wall-tree')} Comerse un árbol <span class="ct">+${fmt(def.eatsTree)}</span></button>`;
  }
  if (type === 'tower' && b[10] > 0) lines.push(`<div class="hk-req ok">Remodelada ${b[10]}/5: +${b[10] * 20} % de alcance, +${b[10] * 5} % de cadencia</div>`);
  let train = '';
  if (type === 'workshop' || type === 'elftree') {
    const table = type === 'workshop' ? REPAIRERS : LUMBERJACKS;
    const kind = type === 'workshop' ? 'repairer' : 'lumberjack';
    train = `<div class="hk-label">${type === 'workshop' ? 'Reparadores' : 'Leñadores'}</div><div class="hk-train">${table
      .map((w, i) => {
        const req = reqText(w.req);
        const info = kind === 'repairer' ? `repara el edificio entero en ${Math.round(50 * (w.ratio ?? 1))} s · comida ${w.food}` : `${(w.woodPerSec ?? 0) * RESOURCE_MULT} de madera/s`;
        return `<button class="hk-btn tr${!afford(w.gold, 0) || req ? ' poor' : ''}" data-act="train" data-v="${kind}" data-n="${i}" data-tip="${esc(`<b>${w.name}</b> · ${costHtml(w.gold, 0)}<br>${info}${req ? `<br><em>${req}</em>` : ''}`)}">
          <span class="ic">${icon(kind === 'repairer' ? 'hk:repairer' : 'hk:lumberjack')}</span><span class="lv">${i + 1}</span><span class="ct">${fmt(w.gold)}</span></button>`;
      })
      .join('')}</div>`;
  }
  const html = `<div class="hk-panel-head"><span class="ic big">${icon(buildingIcon(b))}</span><div><b>${esc(def.name)}</b><small>nivel ${level}/${maxLv}</small></div><button data-act="close" data-v="panel">✕</button></div>
    ${lines.join('')}${up}${train}
    <button class="hk-btn sm danger" data-act="demolish" data-tip="Derribar (Supr). Solo con la vida casi entera y sin el cazador cerca. No devuelve nada.">${icon('hk:demolish')} Derribar</button>`;
  if (html !== hashes.panel) {
    hashes.panel = html;
    panel.innerHTML = html;
  }
  panel.hidden = false;
}

function syncShop(): void {
  const shop = root.querySelector<HTMLElement>('#hk-shop')!;
  const m = me();
  if (!shopOpen || !m || m.side !== 'hunter' || cur!.snap.over) {
    if (!shop.hidden) shop.hidden = true;
    hashes.shop = '';
    return;
  }
  const lines = ITEM_LINE_ORDER.map((line) => {
    const L = ITEMS[line];
    const tiers = L.tiers
      .map((t, i) => {
        const stat = line === 'gloves' ? `+${Math.round(t.value * 100)}%` : line === 'boots' ? `+${Math.round(t.value * 128)}` : `+${fmt(t.value)}`;
        return `<button class="hk-item t${Math.min(4, Math.floor(i / 3))}${afford(t.gold, t.wood) && m.nearShop ? '' : ' poor'}" data-act="buy" data-v="${line}" data-n="${i}" data-tip="${esc(`<b>${t.name}</b> · ${stat} ${L.stat}<br>${costHtml(t.gold, t.wood)}${t.merge > 0 ? `<br><small>${t.merge} del nivel anterior se funden en este</small>` : ''}`)}">
          <span class="ic">${icon(t.icon)}</span><span class="v">${stat}</span><span class="ct">${t.gold ? fmt(t.gold) : `${icon('hk:wood')}${t.wood}`}</span></button>`;
      })
      .join('');
    return `<div class="hk-shopline"><div class="hk-label">${L.name}</div><div class="hk-row">${tiers}</div></div>`;
  }).join('');
  const nextHut = HUT_LEVELS[m.hutLevel];
  const trinkets = `<div class="hk-shopline"><div class="hk-label">Objetos sueltos</div><div class="hk-row">${TRINKET_ORDER.map((t: Trinket) => {
    const d = TRINKETS[t];
    return `<button class="hk-item${afford(d.gold, d.wood) && m.nearShop ? '' : ' poor'}" data-act="buytrinket" data-v="${t}" data-tip="${esc(`<b>${d.name}</b><br>${d.desc}<br>${costHtml(d.gold, d.wood)}`)}"><span class="ic">${icon(d.icon)}</span><span class="ct">${d.gold ? fmt(d.gold) : `${icon('hk:wood')}${d.wood}`}</span></button>`;
  }).join('')}</div></div>`;
  const beastBtn =
    m.form === 'hunter'
      ? `<button class="hk-item${m.beast === 0 && afford(0, BEAST.wood) && m.nearShop ? '' : ' poor'}" data-act="beast" data-tip="${esc(`<b>${BEAST.name}</b><br>Un compañero de ${fmt(BEAST.hp)} de vida y ${BEAST.dmg} de daño que te sigue y ataca lo mismo que tú. Cobra la mitad del daño en oro. Si cae, vuelve a la guarida en ${BEAST.respawnSec} s.<br>${costHtml(0, BEAST.wood)}`)}"><span class="ic">${icon('hk:beast')}</span><span class="ct">${m.beast ? (m.beast === 1 ? 'contigo' : 'vuelve') : `${icon('hk:wood')}${BEAST.wood}`}</span></button>`
      : '';
  const extras = `${trinkets}<div class="hk-shopline"><div class="hk-label">Otros</div><div class="hk-row">${beastBtn}
    ${(Object.keys(CONSUMABLES) as Consumable[])
      .map((c) => {
        const d = CONSUMABLES[c];
        return `<button class="hk-item${afford(d.gold, d.wood) && m.nearShop ? '' : ' poor'}" data-act="buycons" data-v="${c}" data-tip="${esc(`<b>${d.name}</b><br>${d.desc}<br>${costHtml(d.gold, d.wood)}`)}"><span class="ic">${icon(d.icon)}</span><span class="ct">${d.gold ? fmt(d.gold) : `${icon('hk:wood')}${d.wood}`}</span></button>`;
      })
      .join('')}
    <button class="hk-item${afford(WOOD_FOR_GOLD, 0) && m.nearShop ? '' : ' poor'}" data-act="buywood" data-tip="${esc(`<b>1 de madera</b><br>Para los objetos rúnicos.<br>${costHtml(WOOD_FOR_GOLD, 0)}`)}"><span class="ic">${icon('hk:item-wood')}</span><span class="ct">${fmt(WOOD_FOR_GOLD)}</span></button>
    ${m.form === 'hunter' ? `<button class="hk-item hut${nextHut && afford(nextHut.cost, 0) ? '' : ' poor'}" data-act="hut" data-tip="${esc(nextHut ? `<b>Mejorar la guarida</b><br>${m.hutIncome} → ${nextHut.income * RESOURCE_MULT} de oro/s<br>${costHtml(nextHut.cost, 0)}` : 'Guarida al máximo')}"><span class="ic">${icon('hk:hut')}</span><span class="v">nv ${m.hutLevel}</span><span class="ct">${nextHut ? fmt(nextHut.cost) : 'máx'}</span></button>` : ''}
  </div></div>`;
  const html = `<div class="hk-panel-head"><span class="ic big">${icon('hk:shop')}</span><div><b>Tienda de la guarida</b><small>${m.nearShop ? 'Dos objetos iguales se funden en el siguiente nivel' : 'Acércate a la guarida para comprar'}</small></div><button data-act="close" data-v="shop">✕</button></div>${lines}${extras}`;
  if (html !== hashes.shop) {
    hashes.shop = html;
    shop.innerHTML = html;
  }
  shop.hidden = false;
}

function syncChoose(): void {
  const modal = root.querySelector<HTMLElement>('#hk-modal')!;
  const m = me();
  if (m?.form === 'choosing') {
    const html = `<div class="hk-modal-box">
      <div class="hk-modal-head"><span>☠ Has caído</span><span class="t">${m.choose}</span></div>
      <p class="hk-sub">Sigues en la partida. Elige cómo vuelves:</p>
      <div class="hk-choices two">
        <button class="hk-choice angel" data-act="form" data-v="angel"><span class="ic">${icon('hk:angel')}</span><b>Ángel</b><small>Ayudas a los colonos: reparas sus edificios, aturdes al cazador y le robas oro en su guarida.</small></button>
        <button class="hk-choice wolf" data-act="form" data-v="wolf"><span class="ic">${icon('hk:wolf')}</span><b>Lobo</b><small>Te pasas al cazador: golpeas y cobras oro por cada golpe, compras en su guarida. Empiezas con oro según los minutos de partida.</small></button>
      </div></div>`;
    if (hashes.choose !== html) {
      hashes.choose = html;
      modal.innerHTML = html;
    }
    modal.hidden = false;
  } else if (hashes.choose) {
    hashes.choose = '';
    modal.hidden = true;
  }
}

// ---------- dibujo ----------
// Posición que se pinta de cada unidad: se INTERPOLA entre los dos últimos
// snapshots (un tick por detrás, como hacen el Dota o el WC3), así nada da
// saltos hacia atrás. Tu propio personaje, además, arranca al instante tras el
// clic (predicción). Cuando el servidor confirma el movimiento, el adelanto que
// llevaba se absorbe poco a poco frenando un pelo, nunca retrocediendo.
function lerpUnits(now: number): Map<number, { x: number; y: number }> {
  const out = new Map<number, { x: number; y: number }>();
  if (!cur) return out;
  const t = prev ? Math.min(1, Math.max(0, (now - cur.at) / Math.max(30, cur.at - prev.at))) : 1;
  const old = new Map(prev ? prev.snap.units.map((u) => [u[0], u] as const) : []);
  const mine = myUnit();
  for (const u of cur.snap.units) {
    const o = old.get(u[0]);
    let x = u[3];
    let y = u[4];
    if (o && Math.hypot(o[3] - u[3], o[4] - u[4]) < 2) {
      x = o[3] + (u[3] - o[3]) * t;
      y = o[4] + (u[4] - o[4]) * t;
    }
    if (predict && mine && u[0] === mine[0]) {
      const last = disp.get(u[0]) ?? { x, y };
      const dx = predict.tx - predict.from.x;
      const dy = predict.ty - predict.from.y;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      // ¿ya obedece el servidor ESTE clic? Lo sabemos porque su destino actual
      // es la casilla pinchada (o porque ya ha llegado). Moverse no basta: si
      // ya andaba, durante la latencia sigue con la orden anterior.
      const md = cur.snap.me?.dest;
      const tcx = Math.floor(predict.tx);
      const tcy = Math.floor(predict.ty);
      const obeys =
        (md && Math.abs(md[0] - tcx) <= 1 && Math.abs(md[1] - tcy) <= 1) ||
        (md && String(md) !== predict.prevDest) || // pinchó en algo bloqueado: va a la casilla libre más cercana
        Math.hypot(u[3] - predict.tx, u[4] - predict.ty) < 0.3;
      const age = (now - predict.t0) / 1000;
      if (!predict.offset && !obeys && age < 1.2) {
        // aún sin respuesta: avanzar en línea recta hacia el destino
        const step = Math.min(dist, mySpeed() * age);
        x = predict.from.x + ux * step;
        y = predict.from.y + uy * step;
      } else {
        if (!predict.offset) {
          predict.offset = { x: last.x - x, y: last.y - y };
          predict.blendT0 = now;
        }
        const k = Math.max(0, 1 - (now - predict.blendT0) / PREDICT_BLEND_MS);
        x += predict.offset.x * k;
        y += predict.offset.y * k;
        // nunca hacia atrás respecto a la marcha (salvo que el camino real dé la
        // vuelta para rodear un muro: entonces manda el servidor)
        const vx = o ? u[3] - o[3] : 0;
        const vy = o ? u[4] - o[4] : 0;
        const vlen = Math.hypot(vx, vy);
        const sameWay = vlen < 0.001 || (vx * ux + vy * uy) / vlen > 0.5;
        if (sameWay && (x - last.x) * ux + (y - last.y) * uy < 0) {
          x = last.x;
          y = last.y;
        }
        if (k === 0) predict = null;
      }
    }
    disp.set(u[0], { x, y });
    out.set(u[0], { x, y });
  }
  return out;
}

function bar(x: number, y: number, w: number, frac: number, color: string): void {
  const s = cellPx();
  const h = Math.max(3, s * 0.09);
  g.fillStyle = 'rgba(0,0,0,0.7)';
  g.fillRect(x - (w * s) / 2 - 1, y - 1, w * s + 2, h + 2);
  g.fillStyle = color;
  g.fillRect(x - (w * s) / 2, y, w * s * Math.max(0, Math.min(1, frac)), h);
}

function drawTree(px: number, py: number, s: number, n: number): void {
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.ellipse(px + s * 0.5, py + s * 0.82, s * 0.42, s * 0.15, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3d2a1a';
  g.fillRect(px + s * 0.44, py + s * 0.5, s * 0.12, s * 0.32);
  const hue = 130 + n * 24;
  const layers: [number, number, number, number][] = [
    [0.5, 0.42, 0.42, 20],
    [0.42, 0.32, 0.3, 26],
    [0.58, 0.3, 0.26, 30],
    [0.48, 0.2, 0.22, 36],
  ];
  for (const [ax, ay, r, l] of layers) {
    g.fillStyle = `hsl(${hue} 45% ${l + n * 6}%)`;
    g.beginPath();
    g.arc(px + s * ax, py + s * ay, s * r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(255,255,220,0.12)';
  g.beginPath();
  g.arc(px + s * 0.42, py + s * 0.16, s * 0.1, 0, Math.PI * 2);
  g.fill();
}

function drawBuilding(b: HuntSnapBuilding, X: (v: number) => number, Y: (v: number) => number, ghost: boolean, now: number): void {
  const s = cellPx();
  const size = bSize(b);
  const sx = X(b[3]);
  const sy = Y(b[4]);
  const w = size * s;
  const color = playerColor(b[2]);
  const type = BUILDING_ORDER[b[1]];
  g.save();
  if (ghost) g.globalAlpha = 0.38;
  // losa del color del dueño
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.roundRect(sx + 2, sy + 4, w - 4, w - 4, s * 0.12);
  g.fill();
  g.strokeStyle = color;
  g.globalAlpha *= 0.85;
  g.lineWidth = Math.max(1.5, s * 0.05);
  g.beginPath();
  g.roundRect(sx + 3, sy + 3, w - 6, w - 6, s * 0.12);
  g.stroke();
  g.globalAlpha = ghost ? 0.38 : 1;
  // brillo para la casa (es lo que más importa) y las minas
  if (!ghost && (type === 'house' || type === 'mine')) {
    const grd = g.createRadialGradient(sx + w / 2, sy + w / 2, 0, sx + w / 2, sy + w / 2, w * 0.75);
    grd.addColorStop(0, 'rgba(255, 205, 69, 0.25)');
    grd.addColorStop(1, 'rgba(255, 205, 69, 0)');
    g.fillStyle = grd;
    g.fillRect(sx - w * 0.25, sy - w * 0.25, w * 1.5, w * 1.5);
  }
  const iconSize = type === 'wall' ? s * 1.08 : size === 2 ? w * 0.92 : s * 1.18;
  if (!drawPxIcon(g, buildingIcon(b), sx + w / 2, sy + w / 2 - (type === 'tower' ? s * 0.12 : 0), iconSize)) {
    g.fillStyle = '#8a7a5a';
    g.fillRect(sx + 4, sy + 4, w - 8, w - 8);
  }
  if (!ghost) {
    if (b[9] & 1) {
      g.strokeStyle = `rgba(159, 212, 255, ${0.6 + Math.sin(now / 120) * 0.3})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(sx + w / 2, sy + w / 2, w * 0.62, 0, Math.PI * 2);
      g.stroke();
    }
    if (b[9] & 16) g.globalAlpha = 0.35;
    if (b[9] & 64) {
      g.fillStyle = 'rgba(123, 216, 143, 0.9)';
      g.font = `${Math.round(s * 0.35)}px system-ui`;
      g.textAlign = 'center';
      g.fillText('🌿', sx + w / 2, sy + w + s * 0.1);
    }
    if (b[9] & 2) {
      g.fillStyle = 'rgba(255, 224, 102, 0.85)';
      g.font = `700 ${Math.round(s * 0.4)}px system-ui`;
      g.textAlign = 'center';
      g.fillText('✦✦', sx + w / 2, sy - 2);
    }
    // nivel
    g.font = `800 ${Math.round(Math.max(10, s * 0.27))}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(8,10,16,0.85)';
    g.beginPath();
    g.arc(sx + w - s * 0.16, sy + s * 0.16, s * 0.17, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffe9a8';
    g.fillText(String(b[5]), sx + w - s * 0.16, sy + s * 0.17);
    if (b[6] < b[7]) bar(sx + w / 2, sy - s * 0.12, size * 0.9, b[6] / b[7], b[6] / b[7] > 0.4 ? '#7bd88f' : '#ff5a4e');
  }
  if (b[0] === selected) {
    g.strokeStyle = '#ffcd45';
    g.lineWidth = 2.5;
    g.setLineDash([6, 4]);
    g.strokeRect(sx + 1, sy + 1, w - 2, w - 2);
    g.setLineDash([]);
  }
  g.restore();
}

function drawUnit(u: HuntSnapUnit, x: number, y: number, now: number, moving: boolean, faceLeft: boolean): void {
  const s = cellPx();
  const kind = UNIT_KIND_ORDER[u[1]];
  const color = playerColor(u[2]);
  const big = kind === 'hunter' || kind === 'wolf';
  const worker = kind === 'repairer' || kind === 'lumberjack';
  const size = kind === 'hunter' ? s * 2 : kind === 'wolf' ? s * 1.45 : worker ? s * 0.85 : s * 1.2;
  const invis = (u[7] & 1) !== 0;
  g.save();
  if (invis) g.globalAlpha = 0.45;
  // sombra y aro del dueño
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.beginPath();
  g.ellipse(x, y + size * 0.36, size * 0.36, size * 0.12, 0, 0, Math.PI * 2);
  g.fill();
  if (!worker) {
    g.strokeStyle = color;
    g.lineWidth = Math.max(1.5, s * 0.05);
    g.beginPath();
    g.ellipse(x, y + size * 0.36, size * 0.38, size * 0.13, 0, 0, Math.PI * 2);
    g.stroke();
  }
  if (kind === 'hunter') {
    const pulse = 0.35 + Math.sin(now / 260) * 0.1;
    const grd = g.createRadialGradient(x, y, size * 0.1, x, y, size * 0.75);
    grd.addColorStop(0, `rgba(255, 60, 40, ${pulse})`);
    grd.addColorStop(1, 'rgba(255, 60, 40, 0)');
    g.fillStyle = grd;
    g.fillRect(x - size, y - size, size * 2, size * 2);
  }
  if (kind === 'angel') {
    const grd = g.createRadialGradient(x, y, 0, x, y, size * 0.8);
    grd.addColorStop(0, 'rgba(255, 250, 220, 0.4)');
    grd.addColorStop(1, 'rgba(255, 250, 220, 0)');
    g.fillStyle = grd;
    g.fillRect(x - size, y - size, size * 2, size * 2);
  }
  const bob = moving ? Math.sin(now / (big ? 120 : 90)) * size * 0.04 : 0;
  g.translate(x, y - size * 0.1 + bob);
  if (faceLeft) g.scale(-1, 1);
  if (!drawPxIcon(g, UNIT_ICON[kind], 0, 0, size)) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(0, 0, size * 0.35, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  g.save();
  // estados
  const st: string[] = [];
  if (u[7] & 2) st.push('💫');
  if (u[7] & 4) st.push('🌿');
  if (u[7] & 64) st.push('🤫');
  if (u[7] & 16) st.push('✨');
  if (u[7] & 32) st.push('😡');
  if (u[7] & 256) st.push('🙈');
  if (u[7] & 512) st.push('🔰');
  if (u[7] & 1024) st.push('❄️');
  if (u[7] & 2048) st.push('🔥');
  if (u[7] & 4096) st.push('💪');
  if (st.length) {
    g.font = `${Math.round(s * 0.36)}px system-ui`;
    g.textAlign = 'center';
    g.fillText(st.join(''), x, y - size * 0.75);
  }
  if (!worker) {
    const name = init?.players[u[2]]?.name ?? '';
    g.font = `700 ${Math.round(Math.max(10, s * 0.26))}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    const label = big ? `${name} · ${u[8]}` : name;
    const ly = y - size * 0.55;
    g.strokeText(label, x, ly);
    g.fillStyle = big ? '#ffb4ad' : '#fff';
    g.fillText(label, x, ly);
  }
  if (u[5] < u[6] || big) bar(x, y - size * 0.52, big ? 1.4 : worker ? 0.6 : 0.8, u[5] / u[6], big ? '#ff5a4e' : '#7bd88f');
  g.restore();
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (!active || !cur || !init) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.round(canvas.clientWidth * dpr);
  const ch = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  if (!cw || !ch) return;
  if (!ground) ground = drawGround();
  if (!miniBase) miniBase = drawMiniBase();
  const snap = cur.snap;
  const pos = lerpUnits(now);
  const mine = myUnit();

  // cámara: sigue a tu personaje; flechas para moverla; Espacio la recentra
  const panSpeed = 0.6 / zoom;
  if (keys.has('ArrowLeft')) (cam.x -= panSpeed), (follow = false);
  if (keys.has('ArrowRight')) (cam.x += panSpeed), (follow = false);
  if (keys.has('ArrowUp')) (cam.y -= panSpeed), (follow = false);
  if (keys.has('ArrowDown')) (cam.y += panSpeed), (follow = false);
  if (follow && mine) {
    const p = pos.get(mine[0])!;
    cam.x += (p.x - cam.x) * 0.16;
    cam.y += (p.y - cam.y) * 0.16;
  } else if (follow && !mine && !snap.me) {
    cam.x += (map.w / 2 - cam.x) * 0.08;
    cam.y += (map.h / 2 - cam.y) * 0.08;
  }
  const s = cellPx();
  const ox = cw / 2 - cam.x * s;
  const oy = ch / 2 - cam.y * s;
  const X = (v: number) => ox + v * s;
  const Y = (v: number) => oy + v * s;
  const x0 = Math.max(0, Math.floor(cam.x - cw / 2 / s) - 1);
  const x1 = Math.min(map.w, Math.ceil(cam.x + cw / 2 / s) + 1);
  const y0 = Math.max(0, Math.floor(cam.y - ch / 2 / s) - 1);
  const y1 = Math.min(map.h, Math.ceil(cam.y + ch / 2 / s) + 2);

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#05070c';
  g.fillRect(0, 0, cw, ch);
  g.imageSmoothingEnabled = true;
  g.drawImage(ground, ox, oy, map.w * s, map.h * s);

  // guarida y tiendas
  const drawables: { y: number; draw: () => void }[] = [];
  {
    const gx = X(map.camp.x + 0.5);
    const gy = Y(map.camp.y + 0.5);
    const pulse = 0.55 + Math.sin(now / 500) * 0.15;
    const grd = g.createRadialGradient(gx, gy, s * 0.3, gx, gy, s * 4.5);
    grd.addColorStop(0, `rgba(255, 80, 50, ${0.32 * pulse})`);
    grd.addColorStop(1, 'rgba(255, 80, 50, 0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(gx, gy, s * 4.5, 0, Math.PI * 2);
    g.fill();
    drawables.push({
      y: map.camp.y + 0.9,
      draw: () => {
        drawPxIcon(g, 'hk:hut', gx, gy - s * 0.3, s * 2.2);
        // brasas que suben de la guarida
        for (let i = 0; i < 7; i++) {
          const t = ((now / 1400 + i / 7) % 1);
          const ex = gx + Math.sin(i * 2.3 + now / 600) * s * 0.5;
          const ey = gy - s * 0.6 - t * s * 1.6;
          g.fillStyle = `rgba(255, ${140 + i * 12}, 60, ${1 - t})`;
          g.fillRect(ex, ey, Math.max(2, s * 0.06), Math.max(2, s * 0.06));
        }
      },
    });
    const shops: [number, number][] = [
      [-3, -2],
      [3, -2],
      [-3.5, 1],
      [3.5, 1],
    ];
    for (const [dx, dy] of shops) {
      drawables.push({ y: map.camp.y + dy + 0.6, draw: () => drawPxIcon(g, 'hk:shop', X(map.camp.x + 0.5 + dx), Y(map.camp.y + 0.5 + dy), s * 1.3) });
    }
  }

  // árboles visibles (se ordenan con las unidades para que tapen bien)
  const dead = new Set(snap.deadTrees);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (map.tiles[y * map.w + x] !== 2) continue;
      if (dead.has(y * map.w + x)) {
        const sx2 = X(x);
        const sy2 = Y(y);
        drawables.push({ y: y + 0.5, draw: () => {
          g.fillStyle = '#3d2a1a';
          g.beginPath();
          g.ellipse(sx2 + s * 0.5, sy2 + s * 0.6, s * 0.18, s * 0.1, 0, 0, Math.PI * 2);
          g.fill();
        } });
        continue;
      }
      const n = hash(x, y);
      drawables.push({ y: y + 0.8, draw: () => drawTree(X(x), Y(y) - s * 0.25, s * 1.1, n) });
    }

  // edificios (el cazador recuerda apagados los que ya vio)
  const visibleIds = new Set(snap.buildings.map((b) => b[0]));
  if (snap.me?.side === 'hunter') {
    for (const b of snap.buildings) ghosts.set(b[0], b);
    for (const [id, b] of ghosts) {
      if (visibleIds.has(id)) continue;
      const cx = b[3] + bSize(b) / 2;
      const cy = b[4] + bSize(b) / 2;
      const seen = snap.reveal || snap.vision.some(([vx, vy, r]) => Math.hypot(vx - cx, vy - cy) <= r - 0.5);
      if (seen) ghosts.delete(id);
      else drawables.push({ y: b[4] + bSize(b), draw: () => drawBuilding(b, X, Y, true, now) });
    }
  }
  for (const b of snap.buildings) drawables.push({ y: b[4] + bSize(b) - 0.05, draw: () => drawBuilding(b, X, Y, false, now) });

  // minitiendas vudú del bando del cazador
  for (const [sx3, sy3] of snap.shops) drawables.push({ y: sy3, draw: () => drawPxIcon(g, 'hk:item-voodoo', X(sx3), Y(sy3), s * 1.1) });
  // trampas (solo las ve su bando)
  for (const [tx, ty] of snap.traps) drawables.push({ y: ty, draw: () => drawPxIcon(g, 'hk:trap', X(tx), Y(ty), s * 0.7) });

  // unidades
  for (const u of snap.units) {
    const p = pos.get(u[0])!;
    const old = prev?.snap.units.find((o) => o[0] === u[0]);
    const moving = !!old && Math.hypot(old[3] - u[3], old[4] - u[4]) > 0.01;
    const left = !!old && u[3] < old[3] - 0.001;
    drawables.push({ y: p.y + 0.2, draw: () => drawUnit(u, X(p.x), Y(p.y), now, moving, left) });
  }
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  // ayudas: colocación, objetivo de habilidad, alcance de la torre seleccionada
  const m = snap.me;
  if (m && mouse.in && (placing || targeting || useSlot >= 0)) {
    if (placing) {
      const size = BUILDINGS[placing].size;
      const c = placeCell(mouse.x, placing);
      const cy = placeCell(mouse.y, placing).y;
      let ok = true;
      for (let j = 0; j < size; j++)
        for (let i = 0; i < size; i++) {
          const ix = c.x + i;
          const iy = cy + j;
          const idx = iy * map.w + ix;
          if (ix < 0 || iy < 0 || ix >= map.w || iy >= map.h || map.tiles[idx] !== 0 || map.noBuild[idx]) ok = false;
          if (snap.buildings.some((b) => ix >= b[3] && ix < b[3] + bSize(b) && iy >= b[4] && iy < b[4] + bSize(b))) ok = false;
        }
      g.fillStyle = ok ? 'rgba(123, 216, 143, 0.35)' : 'rgba(255, 90, 78, 0.4)';
      g.fillRect(X(c.x), Y(cy), size * s, size * s);
      g.globalAlpha = 0.7;
      drawPxIcon(g, BUILDINGS[placing].icon, X(c.x + size / 2), Y(cy + size / 2), size * s * 0.9);
      g.globalAlpha = 1;
      if (placing === 'tower') {
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        g.beginPath();
        g.arc(X(c.x + 0.5), Y(cy + 0.5), (levelDef('tower', 2, null, 'main').range ?? 4.7) * s, 0, Math.PI * 2);
        g.stroke();
      }
    } else {
      const def = targeting ? ABILITIES[targeting] : null;
      const r = def?.radius ?? 0.8;
      g.strokeStyle = 'rgba(255, 220, 140, 0.8)';
      g.setLineDash([5, 5]);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(X(mouse.x), Y(mouse.y), r * s, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      if (def?.range && def.range < 100 && mine) {
        const p = pos.get(mine[0])!;
        g.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        g.beginPath();
        g.arc(X(p.x), Y(p.y), def.range * s, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }
  const sel = selected ? snap.buildings.find((b) => b[0] === selected) : undefined;
  if (sel && BUILDING_ORDER[sel[1]] === 'tower') {
    const r = buildingInfo(sel).def.range;
    if (r) {
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(X(sel[3] + 0.5), Y(sel[4] + 0.5), r * s, 0, Math.PI * 2);
      g.stroke();
    }
  }
  if (m?.dest) {
    g.strokeStyle = 'rgba(155, 226, 138, 0.7)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(X(m.dest[0] + 0.5), Y(m.dest[1] + 0.5), s * 0.2, 0, Math.PI * 2);
    g.stroke();
  }

  // efectos
  fx = fx.filter((f) => now - f.born < f.life);
  for (const f of fx) {
    // el efecto puede nacer después del instante de este fotograma: t nunca negativo
    const t = Math.max(0, (now - f.born) / f.life);
    g.globalAlpha = 1 - t;
    g.strokeStyle = f.color;
    g.fillStyle = f.color;
    if (f.kind === 'ring') {
      g.lineWidth = 3;
      g.beginPath();
      g.arc(X(f.x), Y(f.y), s * ((f.r ?? 0.6) * (0.4 + t * 0.6)), 0, Math.PI * 2);
      g.stroke();
    } else if (f.kind === 'shot') {
      g.lineWidth = 2.5;
      const a = Math.max(0, t - 0.45);
      const b = Math.min(1, t + 0.45);
      g.beginPath();
      g.moveTo(X(f.x + (f.tx! - f.x) * a), Y(f.y - 0.6 + (f.ty! - f.y + 0.6) * a));
      g.lineTo(X(f.x + (f.tx! - f.x) * b), Y(f.y - 0.6 + (f.ty! - f.y + 0.6) * b));
      g.stroke();
    } else if (f.kind === 'beam') {
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(X(f.x), Y(f.y));
      g.lineTo(X(f.tx!), Y(f.ty!));
      g.stroke();
    } else if (f.kind === 'slash') {
      g.lineWidth = s * 0.1;
      g.beginPath();
      g.arc(X(f.x), Y(f.y), s * 0.6, -0.9 + t * 1.6, 0.3 + t * 1.6);
      g.stroke();
    } else if (f.kind === 'burst') {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const d = s * (0.3 + t * 1.2);
        g.fillRect(X(f.x) + Math.cos(a) * d - 2, Y(f.y) + Math.sin(a) * d - 2, 4, 4);
      }
    } else {
      g.font = `800 ${Math.round(Math.max(11, s * 0.34))}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.strokeText(f.text!, X(f.x), Y(f.y - t * 0.9));
      g.fillText(f.text!, X(f.x), Y(f.y - t * 0.9));
    }
  }
  g.globalAlpha = 1;

  // noche: velo azul que entra y sale despacio, con charcos de luz cálida
  nightLevel += ((snap.night ? 1 : 0) - nightLevel) * 0.02;
  if (nightLevel > 0.01) {
    g.fillStyle = `rgba(12, 20, 60, ${0.38 * nightLevel})`;
    g.fillRect(0, 0, cw, ch);
    g.globalCompositeOperation = 'lighter';
    const light = (wx: number, wy: number, r: number, a: number, rgb = '255, 170, 90') => {
      const lx = X(wx);
      const ly = Y(wy);
      const rr = r * s;
      if (lx + rr < 0 || ly + rr < 0 || lx - rr > cw || ly - rr > ch) return;
      const grd = g.createRadialGradient(lx, ly, 0, lx, ly, rr);
      grd.addColorStop(0, `rgba(${rgb}, ${a * nightLevel})`);
      grd.addColorStop(1, `rgba(${rgb}, 0)`);
      g.fillStyle = grd;
      g.fillRect(lx - rr, ly - rr, rr * 2, rr * 2);
    };
    light(map.camp.x + 0.5, map.camp.y + 0.5, 6, 0.35, '255, 110, 60');
    for (const b of snap.buildings) {
      const t = BUILDING_ORDER[b[1]];
      if (t === 'house' || t === 'tower' || t === 'workshop' || t === 'sight') light(b[3] + bSize(b) / 2, b[4] + bSize(b) / 2, t === 'house' ? 3.2 : 2.2, 0.22);
    }
    for (const u of snap.units) {
      const p = pos.get(u[0])!;
      const kind = UNIT_KIND_ORDER[u[1]];
      if (kind === 'elf' || kind === 'angel') light(p.x, p.y, 2.4, 0.2, kind === 'angel' ? '255, 245, 210' : '200, 255, 190');
    }
    g.globalCompositeOperation = 'source-over';
  }
  // motas ambientales: luciérnagas de noche, polen de día
  if (motes.length === 0) for (let i = 0; i < 70; i++) motes.push({ x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.0004, vy: (Math.random() - 0.5) * 0.0004, phase: Math.random() * 6 });
  for (const mo of motes) {
    mo.x = (mo.x + mo.vx + 1) % 1;
    mo.y = (mo.y + mo.vy + 1) % 1;
    const tw = 0.5 + Math.sin(now / 500 + mo.phase) * 0.5;
    const r = Math.max(1.5, s * 0.05);
    g.fillStyle = nightLevel > 0.5 ? `rgba(220, 255, 140, ${0.75 * tw * nightLevel})` : `rgba(255, 250, 220, ${0.22 * tw})`;
    g.beginPath();
    g.arc(mo.x * cw, mo.y * ch, nightLevel > 0.5 ? r * 1.4 : r, 0, Math.PI * 2);
    g.fill();
  }
  // ojos activos del propio bando
  for (const [ex, ey, er] of snap.eyes) {
    g.strokeStyle = 'rgba(255, 122, 92, 0.35)';
    g.setLineDash([8, 6]);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(X(ex), Y(ey), er * s, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }

  // niebla
  if (!snap.reveal) {
    if (!fog) fog = document.createElement('canvas');
    const fw = Math.ceil(cw / 4);
    const fh = Math.ceil(ch / 4);
    if (fog.width !== fw || fog.height !== fh) {
      fog.width = fw;
      fog.height = fh;
    }
    const f = fog.getContext('2d')!;
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, fw, fh);
    f.fillStyle = 'rgba(4, 7, 18, 0.78)';
    f.fillRect(0, 0, fw, fh);
    f.globalCompositeOperation = 'destination-out';
    for (const [vx, vy, r] of snap.vision) {
      const own = mine && Math.hypot(vx - mine[3], vy - mine[4]) < 0.01 ? pos.get(mine[0])! : { x: vx, y: vy };
      const px = X(own.x) / 4;
      const py = Y(own.y) / 4;
      const rr = (r * s) / 4;
      if (px + rr < 0 || py + rr < 0 || px - rr > fw || py - rr > fh) continue;
      const grd = f.createRadialGradient(px, py, rr * 0.5, px, py, rr);
      grd.addColorStop(0, 'rgba(0,0,0,1)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = grd;
      f.beginPath();
      f.arc(px, py, rr, 0, Math.PI * 2);
      f.fill();
    }
    g.drawImage(fog, 0, 0, cw, ch);
  }
  {
    const v = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = v;
    g.fillRect(0, 0, cw, ch);
  }

  drawMini(pos, x0, y0, x1, y1);
  syncHud();
}

function drawMini(pos: Map<number, { x: number; y: number }>, x0: number, y0: number, x1: number, y1: number): void {
  const k = mini.getContext('2d')!;
  const snap = cur!.snap;
  k.globalCompositeOperation = 'source-over';
  k.drawImage(miniBase!, 0, 0);
  for (const b of snap.buildings) {
    k.fillStyle = playerColor(b[2]);
    k.fillRect(b[3] * 2, b[4] * 2, bSize(b) * 2, bSize(b) * 2);
  }
  if (!snap.reveal) {
    k.fillStyle = 'rgba(4, 7, 18, 0.55)';
    k.beginPath();
    k.rect(0, 0, mini.width, mini.height);
    for (const [vx, vy, r] of snap.vision) {
      k.moveTo(vx * 2 + r * 2, vy * 2);
      k.arc(vx * 2, vy * 2, r * 2, 0, Math.PI * 2, true);
    }
    k.fill('evenodd');
  }
  for (const u of snap.units) {
    const p = pos.get(u[0])!;
    const kind = UNIT_KIND_ORDER[u[1]];
    const r = kind === 'hunter' ? 4 : kind === 'repairer' || kind === 'lumberjack' ? 1.5 : 3;
    k.fillStyle = kind === 'hunter' || kind === 'wolf' ? '#ff5a4e' : playerColor(u[2]);
    k.beginPath();
    k.arc(p.x * 2, p.y * 2, r, 0, Math.PI * 2);
    k.fill();
    if (u[2] === meIdx() && kind !== 'repairer' && kind !== 'lumberjack') {
      k.strokeStyle = '#fff';
      k.lineWidth = 1.5;
      k.stroke();
    }
  }
  k.strokeStyle = 'rgba(255,255,255,0.7)';
  k.lineWidth = 1;
  k.strokeRect(x0 * 2, y0 * 2, (x1 - x0) * 2, (y1 - y0) * 2);
}

// ---------- ciclo de vida (lo llama main.ts) ----------
// ganchos para la prueba visual (tools/huntvisual.ts): abrir paneles sin clicar el canvas
(window as unknown as { __hunt?: unknown }).__hunt = {
  select: (id: number) => (selected = id),
  shop: () => (shopOpen = true),
  book: () => openBook(),
  // prueba de movimiento: registra fotograma a fotograma dónde se pinta tu personaje
  pos: () => {
    const u = myUnit();
    return u ? (disp.get(u[0]) ?? null) : null;
  },
  rclick: (x: number, y: number) => onWorldClick(x, y, true),
  me: () => {
    const u = myUnit();
    return u ? { x: u[3], y: u[4], form: me()?.form } : null;
  },
  zoom: (z: number) => (zoom = z),
  mine: () => myBuildings().map((b) => ({ id: b[0], type: BUILDING_ORDER[b[1]], level: b[5] })),
};

export function isHuntActive(): boolean {
  return active;
}

export function startHunt(i: HuntInit): void {
  build();
  const fresh = !active || init?.hunterId !== i.hunterId || init.youAre !== i.youAre;
  init = i;
  active = true;
  root.querySelector<HTMLElement>('#hk-end')!.hidden = true;
  if (!fresh) return;
  prev = null;
  cur = null;
  placing = null;
  targeting = null;
  selected = 0;
  shopOpen = false;
  follow = true;
  zoom = 1;
  fx = [];
  ghosts.clear();
  for (const k of Object.keys(hashes)) delete hashes[k];
  cam.x = map.camp.x + 0.5;
  cam.y = map.camp.y + 0.5;
  const mineP = i.players.find((p) => p.id === i.youAre);
  toast(
    mineP?.role === 'hunter'
      ? `${icon('hk:troll')} Te ha tocado ser el CAZADOR`
      : mineP
        ? `${icon('hk:elf')} Eres COLONO: busca una parcela y ciérrala`
        : '👁 Estás mirando la cacería',
  );
  void PHASE;
}

export function onHuntTick(snap: HuntSnap, events: HuntEvent[]): void {
  if (!active) return;
  prev = cur;
  cur = { snap, at: performance.now() };
  onEvents(events);
}

export function onHuntOver(result: HuntResult, backToLobby: () => void): void {
  if (!built || !init) {
    backToLobby();
    return;
  }
  const mine = result.players.find((p) => p.id === init!.youAre);
  const won = mine ? (mine.role === 'hunter') === (result.winner === 'hunter') : null;
  const why = result.reason === 'hunter_dead' ? 'El cazador ha caído.' : 'No queda ningún colono en pie.';
  const mm = Math.floor(result.seconds / 60);
  const ss = String(result.seconds % 60).padStart(2, '0');
  const formName: Record<string, string> = { hunter: 'Cazador', elf: 'Colono', angel: 'Ángel', wolf: 'Lobo', choosing: 'Caído', dead: 'Caído' };
  const end = root.querySelector<HTMLElement>('#hk-end')!;
  end.innerHTML = `<div class="hk-end-box ${result.winner}">
    <div class="hk-end-icon">${icon(result.winner === 'hunter' ? 'hk:troll' : 'hk:house')}</div>
    <h2>${won === null ? (result.winner === 'hunter' ? 'Gana el cazador' : 'Ganan los colonos') : won ? '¡Victoria!' : 'Derrota'}</h2>
    <p>${why} La cacería duró ${mm}:${ss}.</p>
    <table>
      <thead><tr><th>Jugador</th><th>Papel</th><th>Oro</th><th>Daño</th><th>Edif.</th><th>Bajas</th></tr></thead>
      <tbody>${result.players
        .map(
          (p) => `<tr class="${p.id === init!.youAre ? 'me' : ''}">
            <td><i style="background:${p.color}"></i>${esc(p.name)}</td>
            <td>${p.role === 'hunter' ? `Cazador · nv ${p.level}` : formName[p.form] ?? p.form}</td>
            <td>${fmt(p.goldEarned)}</td><td>${fmt(p.damage)}</td><td>${p.role === 'hunter' ? '—' : p.built}</td><td>${p.kills}</td></tr>`,
        )
        .join('')}</tbody>
    </table>
    <button class="hk-btn wide primary" id="hk-back">Volver a la sala</button>
  </div>`;
  end.hidden = false;
  if (won === false) sfx.defeat();
  else sfx.victory();
  end.querySelector('#hk-back')!.addEventListener('click', () => {
    active = false;
    backToLobby();
  });
}

export function abandonHunt(): void {
  active = false;
}
