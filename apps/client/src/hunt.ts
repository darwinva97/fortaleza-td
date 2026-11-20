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
  type HuntSnapMe,
  type ItemLine,
  type LevelDef,
  type Req,
  type TowerBranch,
  type UnitKind,
  type WallBranch,
  RESOURCE_MULT,
  SOLDIERS,
  SOLDIER_ORDER,
  type SoldierKind,
  TOWER_FORKS,
  TOWER_GREEN_FINAL,
  WOOD_BULK,
  TILE_FLOOR,
  TILE_TREE,
  steerStep,
} from '@td/shared';
import { net } from './net.js';
import { sfx, unlockAudio } from './audio.js';
import { drawPxIcon, pxIcon } from './px-icons.js';
import { UNIT_SHEETS, type Dir, type UnitSheet } from './hunt-sprites.gen.js';

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
let inspect = 0; // unidad que estás mirando (clic sobre ella): vida, equipo...
let group: number[] = []; // varias unidades tuyas seleccionadas (recuadro, doble clic)
const boxSel = { on: false, moved: false, sx: 0, sy: 0, ex: 0, ey: 0 };
let rosterClick = { kind: '', at: 0, idx: 0 };
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
  small?: boolean;
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
// posiciones que se pintan (suavizadas)
const disp = new Map<number, { x: number; y: number }>();
// ---------- WASD ----------
// Las teclas mandan una dirección al servidor (orden 'steer'). Tu personaje se
// mueve YA en pantalla con la misma regla de choques que el servidor
// (steerStep) y se corrige suavemente si el servidor no está de acuerdo.
const codes = new Set<string>(); // teclas físicas pulsadas (e.code)
let touchSteer: [number, number] = [0, 0]; // joystick del móvil
let isTouch = false;
let steerSent: [number, number] = [0, 0]; // última dirección enviada
let steerActive: [number, number] = [0, 0]; // la que creemos que aplica el servidor
const local = { on: false, x: 0, y: 0 };
let lastLerp = 0;
let gridKey = '';
let gridCache: Uint8Array | null = null;
// ---------- sprites animados ----------
const unitAtlas = new Image();
let unitAtlasOk = false;
unitAtlas.onload = () => (unitAtlasOk = true);
unitAtlas.src = '/sprites/hunt-units.png';
const tintCache = new Map<string, HTMLCanvasElement>(); // elfo pintado del color de cada jugador
const anim = new Map<number, { dir: Dir; walk: number; x: number; y: number; movedAt: number }>();
const corpses: { kind: string; x: number; y: number; born: number }[] = [];
// altura dibujada (en casillas) de cada personaje con hoja de sprites
const SPRITE_TILES: Record<string, number> = { elf: 1.3, hunter: 2.05, wolf: 1.2, angel: 1.3, repairer: 1.05, lumberjack: 1.05 };
const STRIDE: Record<string, number> = { elf: 0.3, hunter: 0.42, wolf: 0.36, angel: 0.34, repairer: 0.26, lumberjack: 0.26 }; // casillas por paso
// personajes cuya ropa verde se pinta del color del jugador
const TINTED = new Set(['elf', 'repairer', 'lumberjack']);
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
  ...(Object.fromEntries(SOLDIER_ORDER.map((k) => [k, SOLDIERS[k].icon])) as Record<SoldierKind, string>),
};
const isSoldierKind = (k: UnitKind): k is SoldierKind => k in SOLDIERS;

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
      <button class="hk-endbtn" id="hk-endbtn" data-act="endhunt" hidden title="Terminar la partida ahora (solo el anfitrión)">Terminar</button>
    </div>
    <div class="hk-banner" id="hk-banner" hidden></div>
    <div class="hk-toasts"></div>
    <div class="hk-chat" id="hk-chat">
      <div class="hk-chat-log" id="hk-chat-log"></div>
      <form class="hk-chat-form" id="hk-chat-form" hidden>
        <button type="button" class="hk-chat-ch" id="hk-chat-ch" title="Cambiar canal (Tab)">Equipo</button>
        <input id="hk-chat-in" maxlength="200" autocomplete="off" placeholder="Escribe y pulsa Enter" />
      </form>
    </div>
    <div class="hk-mini"><canvas id="hk-mini"></canvas></div>
    <div class="hk-dock"><div class="hk-dock-in" id="hk-dock-in">
      <div class="hk-card-wrap">
        <div class="hk-unitbar" id="hk-unitbar"></div>
        <div class="hk-card" id="hk-card"></div>
      </div>
      <div class="hk-side">
        <div class="hk-panel" id="hk-panel" hidden></div>
        <div class="hk-shop" id="hk-shop" hidden></div>
      </div>
    </div></div>
    <div class="hk-modal" id="hk-modal" hidden></div>
    <div class="hk-tip" id="hk-tip" hidden></div>
    <div class="hk-end" id="hk-end" hidden></div>
    <div class="hk-touch" id="hk-touch">
      <div class="hk-joy" id="hk-joy"><div class="hk-joy-knob" id="hk-joy-knob"></div></div>
      <div class="hk-tbtns">
        <button class="hk-tbtn act" data-act="tact" aria-label="Acción: reparar o atacar">⚡<small>Acción</small></button>
        <button class="hk-tbtn" data-act="tme" aria-label="Volver a tu personaje">👤</button>
        <button class="hk-tbtn" data-act="tchat" aria-label="Chat">💬</button>
      </div>
    </div>
    <div class="hk-rotate" id="hk-rotate"><div class="ph">📱</div><b>Gira el móvil</b><p>La Cacería se juega en horizontal.</p></div>`;
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
    if (e.pointerType === 'touch') {
      touchDown(e);
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    // izquierdo sin nada que colocar/apuntar: se decide al soltar (clic o recuadro)
    if (e.button === 0 && !placing && !targeting && useSlot < 0) {
      Object.assign(boxSel, { on: true, moved: false, sx: e.clientX, sy: e.clientY, ex: e.clientX, ey: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    onWorldClick(w.x, w.y, e.button === 2);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      touchMove(e);
      return;
    }
    if (boxSel.on) {
      boxSel.ex = e.clientX;
      boxSel.ey = e.clientY;
      if (Math.hypot(boxSel.ex - boxSel.sx, boxSel.ey - boxSel.sy) > 6) boxSel.moved = true;
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') {
      touchUp(e);
      return;
    }
    if (!boxSel.on || e.button !== 0) return;
    boxSel.on = false;
    if (boxSel.moved) selectBox();
    else {
      const w = toWorld(e.clientX, e.clientY);
      onWorldClick(w.x, w.y, false);
    }
  });
  canvas.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      gesture.cancelled = true;
    }
  });
  setupTouch();
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
    follow = false;
    cam.x = x;
    cam.y = y;
  });
  mini.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', onKey);
  // chat de la Cacería: Enter abre; por defecto a tu equipo
  const chatForm = root.querySelector<HTMLFormElement>('#hk-chat-form')!;
  const chatIn = root.querySelector<HTMLInputElement>('#hk-chat-in')!;
  const chatCh = root.querySelector<HTMLButtonElement>('#hk-chat-ch')!;
  const setCh = (team: boolean) => {
    chatTeam = team;
    chatCh.textContent = team ? 'Equipo' : 'Todos';
    chatCh.classList.toggle('all', !team);
  };
  chatCh.addEventListener('click', () => {
    setCh(!chatTeam);
    chatIn.focus();
  });
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatIn.value.trim();
    if (text) net.send({ type: 'chat', text, team: chatTeam });
    chatIn.value = '';
    closeChat();
  });
  chatIn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeChat();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setCh(!chatTeam);
    }
    e.stopPropagation();
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.key);
    codes.delete(e.code);
  });
  window.addEventListener('blur', () => {
    keys.clear();
    codes.clear();
  });
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

// ---------- móvil ----------
// Tocar = clic (seleccionar, colocar, apuntar). Mantener pulsado = clic derecho
// (mandar obreros, fijar objetivo de torre). Arrastrar = mover la cámara.
// Dos dedos = zoom. El joystick mueve a tu personaje y ⚡ hace lo de la R.
const touches = new Map<number, { x: number; y: number }>();
const gesture = { sx: 0, sy: 0, moved: false, cancelled: false, long: false, pinch: 0, zoom0: 1, timer: 0 as unknown as ReturnType<typeof setTimeout> };

function touchDown(e: PointerEvent): void {
  canvas.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  clearTimeout(gesture.timer);
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    gesture.pinch = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    gesture.zoom0 = zoom;
    gesture.cancelled = true;
    return;
  }
  gesture.sx = e.clientX;
  gesture.sy = e.clientY;
  gesture.moved = false;
  gesture.cancelled = false;
  gesture.long = false;
  const w = toWorld(e.clientX, e.clientY);
  mouse.x = w.x;
  mouse.y = w.y;
  mouse.in = true;
  gesture.timer = setTimeout(() => {
    if (gesture.moved || gesture.cancelled) return;
    gesture.long = true;
    navigator.vibrate?.(15);
    onWorldClick(w.x, w.y, true);
  }, 480);
}
function touchMove(e: PointerEvent): void {
  const t = touches.get(e.pointerId);
  if (!t) return;
  const px = t.x;
  const py = t.y;
  t.x = e.clientX;
  t.y = e.clientY;
  if (touches.size >= 2) {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    zoom = Math.min(1.8, Math.max(0.35, gesture.zoom0 * (d / gesture.pinch)));
    return;
  }
  if (Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 12) {
    gesture.moved = true;
    clearTimeout(gesture.timer);
  }
  const w = toWorld(e.clientX, e.clientY);
  mouse.x = w.x;
  mouse.y = w.y;
  // arrastrar con un dedo mueve la cámara (sin colocar nada)
  if (gesture.moved && !placing && !targeting) {
    const k = (window.devicePixelRatio || 1) / cellPx();
    cam.x -= (e.clientX - px) * k;
    cam.y -= (e.clientY - py) * k;
    follow = false;
  }
}
function touchUp(e: PointerEvent): void {
  touches.delete(e.pointerId);
  clearTimeout(gesture.timer);
  if (gesture.cancelled || gesture.long) {
    if (touches.size === 0) gesture.cancelled = false;
    return;
  }
  // con algo que colocar o apuntar, se suelta donde se quiera (y se puede arrastrar)
  if (gesture.moved && !placing && !targeting && useSlot < 0) return;
  const w = toWorld(e.clientX, e.clientY);
  onWorldClick(w.x, w.y, false);
}

function setupTouch(): void {
  isTouch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  root.classList.toggle('touch', isTouch);
  const joy = root.querySelector<HTMLElement>('#hk-joy')!;
  const knob = root.querySelector<HTMLElement>('#hk-joy-knob')!;
  let jid = -1;
  const setJoy = (e: PointerEvent) => {
    const r = joy.getBoundingClientRect();
    const R = r.width / 2;
    let dx = (e.clientX - (r.left + R)) / R;
    let dy = (e.clientY - (r.top + R)) / R;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    knob.style.transform = `translate(${dx * R * 0.55}px, ${dy * R * 0.55}px)`;
    if (m < 0.28) {
      touchSteer = [0, 0];
      return;
    }
    // 8 direcciones
    const a = Math.atan2(dy, dx);
    const sector = Math.round(a / (Math.PI / 4));
    const dirs: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    touchSteer = dirs[(sector + 8) % 8];
  };
  joy.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlockAudio();
    goLandscape();
    jid = e.pointerId;
    joy.setPointerCapture(e.pointerId);
    joy.classList.add('on');
    setJoy(e);
  });
  joy.addEventListener('pointermove', (e) => {
    if (e.pointerId === jid) setJoy(e);
  });
  const release = (e: PointerEvent) => {
    if (e.pointerId !== jid) return;
    jid = -1;
    touchSteer = [0, 0];
    knob.style.transform = '';
    joy.classList.remove('on');
  };
  joy.addEventListener('pointerup', release);
  joy.addEventListener('pointercancel', release);
}

// pantalla completa y horizontal (Android lo permite; iOS solo muestra el aviso)
function goLandscape(): void {
  if (!isTouch || document.fullscreenElement) return;
  const el = document.documentElement;
  void el
    .requestFullscreen?.()
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => {});
}

// ⚡: lo mismo que la R, pero sin ratón: lo seleccionado o lo más cercano
function actTouch(): void {
  const m = me();
  const u = myUnit();
  if (!cur || !m || !u) return;
  const p = disp.get(u[0]) ?? { x: u[3], y: u[4] };
  let tx: number | null = null;
  let ty: number | null = null;
  const bCenter = (b: HuntSnapBuilding) => [b[3] + bSize(b) / 2, b[4] + bSize(b) / 2] as const;
  const iu = inspect ? cur.snap.units.find((o) => o[0] === inspect) : undefined;
  const sb = selected ? cur.snap.buildings.find((o) => o[0] === selected) : undefined;
  if (m.side === 'hunter' && iu && isEnemyUnit(iu)) [tx, ty] = [iu[3], iu[4]];
  else if (m.side === 'elf' && sb && sb[6] < sb[7]) [tx, ty] = bCenter(sb);
  else if (m.side === 'elf') {
    let best = 4.5;
    for (const b of cur.snap.buildings) {
      if (b[6] >= b[7]) continue;
      const [cx, cy] = bCenter(b);
      const d = Math.hypot(cx - p.x, cy - p.y);
      if (d < best) [best, tx, ty] = [d, cx, cy];
    }
  } else {
    let best = 4.5;
    for (const o of cur.snap.units) {
      if (!isEnemyUnit(o)) continue;
      const d = Math.hypot(o[3] - p.x, o[4] - p.y);
      if (d < best) [best, tx, ty] = [d, o[3], o[4]];
    }
    if (tx === null) {
      best = 3.5;
      for (const b of cur.snap.buildings) {
        const [cx, cy] = bCenter(b);
        const d = Math.hypot(cx - p.x, cy - p.y);
        if (d < best) [best, tx, ty] = [d, cx, cy];
      }
    }
  }
  if (tx === null || ty === null) {
    toast(m.side === 'elf' ? 'No hay nada dañado cerca para reparar' : 'No hay nada cerca que atacar', true);
    return;
  }
  const keep = { x: mouse.x, y: mouse.y, in: mouse.in };
  mouse.x = tx;
  mouse.y = ty;
  mouse.in = true;
  actOnCursor();
  Object.assign(mouse, keep);
}

// ---------- chat ----------
let chatTeam = true;
function openChat(): void {
  const form = root.querySelector<HTMLFormElement>('#hk-chat-form')!;
  codes.clear(); // que no se quede andando mientras escribes
  form.hidden = false;
  root.querySelector('#hk-chat')!.classList.add('open');
  root.querySelector<HTMLInputElement>('#hk-chat-in')!.focus();
}
function closeChat(): void {
  const input = root.querySelector<HTMLInputElement>('#hk-chat-in')!;
  input.blur();
  root.querySelector<HTMLFormElement>('#hk-chat-form')!.hidden = true;
  root.querySelector('#hk-chat')!.classList.remove('open');
}
// mensajes de la sala durante la Cacería (main.ts los reenvía aquí)
export function huntChat(from: string, color: string, text: string, team?: 'hunter' | 'elf'): void {
  if (!built) return;
  const log = root.querySelector<HTMLElement>('#hk-chat-log');
  if (!log) return;
  const el = document.createElement('div');
  el.className = 'msg';
  if (team) {
    const t = document.createElement('span');
    t.className = `ch ${team}`;
    t.textContent = team === 'hunter' ? 'Trolls' : 'Elfos';
    el.appendChild(t);
  }
  if (from) {
    const b = document.createElement('b');
    b.style.color = color;
    b.textContent = from + ':';
    el.appendChild(b);
  }
  el.appendChild(document.createTextNode(' ' + text));
  log.appendChild(el);
  while (log.children.length > 40) log.firstChild?.remove();
  log.scrollTop = log.scrollHeight;
  setTimeout(() => el.classList.add('faded'), 10000);
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
    // tu personaje no se mueve con el clic (WASD); el clic derecho manda a la
    // unidad o torre que tengas seleccionada
    if (group.length) {
      // a varias a la vez: si apuntas a algo, todas a eso; si es suelo, repartidas
      const units = group.map((id) => cur!.snap.units.find((o) => o[0] === id)).filter((o): o is HuntSnapUnit => !!o);
      const onSomething = !!unitAt(x, y) || !!buildingAt(x, y) || map.tiles[Math.floor(y) * map.w + Math.floor(x)] === TILE_TREE;
      units.forEach((u, i) => {
        const ring = Math.ceil(Math.sqrt(i + 1) - 1);
        const ang = i * 2.4;
        const off = onSomething || i === 0 ? 0 : 0.7 * (ring + 0.6);
        commandUnit(u, x + Math.cos(ang) * off, y + Math.sin(ang) * off);
      });
      return;
    }
    const iu = inspect ? cur.snap.units.find((o) => o[0] === inspect) : undefined;
    if (iu && iu[2] === meIdx() && COMMANDABLE.includes(UNIT_KIND_ORDER[iu[1]])) {
      commandUnit(iu, x, y);
      return;
    }
    const sb = selected ? cur.snap.buildings.find((o) => o[0] === selected && o[2] === meIdx()) : undefined;
    if (sb && BUILDING_ORDER[sb[1]] === 'tower') {
      const foe = cur.snap.units.find((u) => isEnemyUnit(u) && Math.hypot(u[3] - x, u[4] - y) < 0.9);
      send({ k: 'focus', id: sb[0], target: foe ? foe[0] : 0 });
      if (foe) ring(foe[3], foe[4], '#ff5a4e', 0.8);
      toast(foe ? 'La torre disparará primero a ese objetivo' : 'La torre vuelve a disparar al más cercano');
    }
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
    orderSent();
    ring(cx + 0.5, cy + 0.5, '#ffcd45');
    if (!keys.has('Shift')) placing = null;
    return;
  }
  // ¿clic sobre un edificio propio? → seleccionar
  const own = myBuildings().find((o) => cx >= o[3] && cx < o[3] + bSize(o) && cy >= o[4] && cy < o[4] + bSize(o));
  // ¿clic sobre una unidad? → seleccionarla. Mayús+clic suma/quita de la selección
  const best = unitAt(x, y);
  if (best) {
    const mineCmd = best[2] === meIdx() && COMMANDABLE.includes(UNIT_KIND_ORDER[best[1]]);
    if (keys.has('Shift') && mineCmd) {
      const set = new Set(group.length ? group : inspect ? [inspect] : []);
      if (set.has(best[0])) set.delete(best[0]);
      else set.add(best[0]);
      setGroup([...set]);
      return;
    }
    group = [];
    inspect = best[0];
    selected = 0;
    return;
  }
  if (own && m.side === 'elf') {
    selected = own[0];
    inspect = 0;
    group = [];
    return;
  }
  selected = 0;
  inspect = 0;
  group = [];
}

// altura dibujada (casillas) de cada tipo: la zona de clic es todo el dibujo
function unitHeight(kind: UnitKind): number {
  if (UNIT_SHEETS[kind] && unitAtlasOk) return SPRITE_TILES[kind] ?? 1.3;
  if (isSoldierKind(kind)) return SOLDIERS[kind].size;
  return kind === 'hunter' ? 2 : kind === 'wolf' ? 1.45 : kind === 'repairer' || kind === 'lumberjack' ? 0.85 : 1.2;
}
// la unidad bajo el punto: si hay varias, la más pequeña (un leñador delante del troll)
function unitAt(x: number, y: number): HuntSnapUnit | undefined {
  if (!cur) return undefined;
  let best: HuntSnapUnit | undefined;
  let bestScore = Infinity;
  for (const u of cur.snap.units) {
    const p = disp.get(u[0]) ?? { x: u[3], y: u[4] };
    const h = unitHeight(UNIT_KIND_ORDER[u[1]]);
    const hw = Math.max(0.42, h * 0.32);
    const foot = p.y + 0.36;
    if (x < p.x - hw || x > p.x + hw || y < foot - h * 0.95 || y > foot + 0.15) continue;
    const score = h * 10 + Math.abs(x - p.x) + Math.abs(y - (foot - h / 2)) * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return best;
}
function buildingAt(x: number, y: number): HuntSnapBuilding | undefined {
  if (!cur) return undefined;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  return cur.snap.buildings.find((o) => cx >= o[3] && cx < o[3] + bSize(o) && cy >= o[4] && cy < o[4] + bSize(o));
}
function setGroup(ids: number[]): void {
  if (ids.length === 1) {
    group = [];
    inspect = ids[0];
  } else {
    group = ids;
    inspect = 0;
  }
  selected = 0;
}
// recuadro: todas tus unidades mandables que queden dentro
function selectBox(): void {
  if (!cur) return;
  const a = toWorld(boxSel.sx, boxSel.sy);
  const b = toWorld(boxSel.ex, boxSel.ey);
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const ids = cur.snap.units
    .filter((u) => u[2] === meIdx() && COMMANDABLE.includes(UNIT_KIND_ORDER[u[1]]))
    .filter((u) => {
      const p = disp.get(u[0]) ?? { x: u[3], y: u[4] };
      return p.x >= x0 && p.x <= x1 && p.y >= y0 - 0.5 && p.y <= y1 + 0.3;
    })
    .map((u) => u[0]);
  if (ids.length) setGroup(ids);
}
// tus unidades mandables, por tipo (barra «Tus unidades» y Tab)
function myCommandables(): HuntSnapUnit[] {
  if (!cur) return [];
  return cur.snap.units.filter((u) => u[2] === meIdx() && COMMANDABLE.includes(UNIT_KIND_ORDER[u[1]]));
}
function focusUnit(u: HuntSnapUnit): void {
  const p = disp.get(u[0]) ?? { x: u[3], y: u[4] };
  follow = false;
  cam.x = p.x;
  cam.y = p.y;
}

// unidades propias que se mandan con el ratón (tu personaje va con WASD)
const COMMANDABLE: UnitKind[] = ['repairer', 'lumberjack', 'beast', 'mage', ...SOLDIER_ORDER];

function commandUnit(u: HuntSnapUnit, x: number, y: number): void {
  if (!cur) return;
  const kind = UNIT_KIND_ORDER[u[1]];
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const bAt = cur.snap.buildings.find((o) => cx >= o[3] && cx < o[3] + bSize(o) && cy >= o[4] && cy < o[4] + bSize(o));
  if (kind === 'beast' || kind === 'mage' || isSoldierKind(kind)) {
    const mineU = myUnit();
    if (mineU && Math.hypot(mineU[3] - x, mineU[4] - y) < 0.9) {
      send({ k: 'worker', id: u[0], follow: true });
      ring(mineU[3], mineU[4], '#9be28a');
      toast('Te sigue de nuevo');
      return;
    }
    const foe = cur.snap.units.find((o) => isEnemyUnit(o) && Math.hypot(o[3] - x, o[4] - y) < 0.9);
    if (foe) {
      send({ k: 'worker', id: u[0], target: foe[0] });
      ring(foe[3], foe[4], '#ff5a4e');
      return;
    }
    if (bAt && kind === 'beast' && me()?.side === 'hunter') {
      send({ k: 'worker', id: u[0], target: bAt[0] });
      ring(bAt[3] + bSize(bAt) / 2, bAt[4] + bSize(bAt) / 2, '#ff5a4e', 1);
      return;
    }
  }
  if (kind === 'repairer' && bAt) {
    send({ k: 'worker', id: u[0], target: bAt[0] });
    ring(bAt[3] + bSize(bAt) / 2, bAt[4] + bSize(bAt) / 2, '#ffe9a8', 1);
    if (bAt[6] >= bAt[7]) toast('Lo reparará en cuanto reciba daño');
    return;
  }
  if (kind === 'lumberjack') {
    const idx = cy * map.w + cx;
    if (map.tiles[idx] === TILE_TREE && !cur.snap.deadTrees.includes(idx)) {
      send({ k: 'worker', id: u[0], tree: idx });
      ring(cx + 0.5, cy + 0.5, '#c8935a');
      return;
    }
  }
  send({ k: 'worker', id: u[0], x, y });
  ring(x, y, '#9be28a');
}

// una orden que no es WASD: el servidor suelta la dirección; hasta que cambien
// las teclas no la volvemos a mandar
function orderSent(): void {
  steerActive = [0, 0];
  steerSent = steerFromKeys();
}

function steerFromKeys(): [number, number] {
  if (touchSteer[0] || touchSteer[1]) return touchSteer;
  const dx = (codes.has('KeyD') ? 1 : 0) - (codes.has('KeyA') ? 1 : 0);
  const dy = (codes.has('KeyS') ? 1 : 0) - (codes.has('KeyW') ? 1 : 0);
  return [dx, dy];
}

function syncSteer(): void {
  const m = me();
  const can = !!m && !cur?.snap.over && m.form !== 'choosing' && m.form !== 'dead';
  const want: [number, number] = can ? steerFromKeys() : [0, 0];
  if (want[0] === steerSent[0] && want[1] === steerSent[1]) return;
  const wasMoving = steerActive[0] !== 0 || steerActive[1] !== 0;
  steerSent = want;
  steerActive = want;
  // al cambiar o soltar, decimos dónde nos ve el jugador (el servidor lo acepta si es razonable)
  const at = wasMoving && local.on ? { x: Math.round(local.x * 1000) / 1000, y: Math.round(local.y * 1000) / 1000 } : {};
  send({ k: 'steer', dx: want[0], dy: want[1], ...at });
  if (want[0] || want[1]) follow = true;
}

// R: actuar sobre lo que señala el ratón (reparar si eres colono o ángel,
// atacar si eres del bando del cazador)
function actOnCursor(): void {
  const m = me();
  if (!cur || !m || !mouse.in) return;
  const x = mouse.x;
  const y = mouse.y;
  const near = (o: HuntSnapBuilding): number => {
    const sz = bSize(o);
    return Math.hypot(Math.max(o[3] - x, 0, x - (o[3] + sz)), Math.max(o[4] - y, 0, y - (o[4] + sz)));
  };
  const bAt = cur.snap.buildings.filter((o) => near(o) < 0.35).sort((a, b) => near(a) - near(b))[0];
  if (m.side === 'elf') {
    if (m.form !== 'elf' && m.form !== 'angel') return;
    if (!bAt) {
      toast('Señala una torre o una muralla y pulsa R para repararla', true);
      return;
    }
    if (bAt[6] >= bAt[7]) {
      toast('Ese edificio ya está entero');
      return;
    }
    send({ k: 'repair', target: bAt[0] });
    orderSent();
    ring(bAt[3] + bSize(bAt) / 2, bAt[4] + bSize(bAt) / 2, '#ffe9a8', 1);
    return;
  }
  const enemy = cur.snap.units.find((u) => isEnemyUnit(u) && Math.hypot(u[3] - x, u[4] - y) < 0.8);
  if (enemy) {
    send({ k: 'attack', target: enemy[0] });
    orderSent();
    ring(enemy[3], enemy[4], '#ff5a4e');
    return;
  }
  if (bAt) {
    send({ k: 'attack', target: bAt[0] });
    orderSent();
    ring(bAt[3] + bSize(bAt) / 2, bAt[4] + bSize(bAt) / 2, '#ff5a4e');
    return;
  }
  toast('Señala un enemigo o un edificio y pulsa R para atacarlo', true);
}

// rejilla de casillas bloqueadas vista desde el cliente (para predecir el WASD)
function clientGrid(): Uint8Array {
  const snap = cur!.snap;
  const key = `${snap.tick}`;
  if (gridCache && key === gridKey) return gridCache;
  const g2 = new Uint8Array(map.w * map.h);
  for (let i = 0; i < g2.length; i++) g2[i] = map.tiles[i] === TILE_FLOOR ? 0 : 1;
  for (const i of snap.deadTrees) g2[i] = 0;
  g2[map.camp.y * map.w + map.camp.x] = 1;
  const blockB = (b: HuntSnapBuilding): void => {
    const sz = bSize(b);
    for (let j = 0; j < sz; j++) for (let i = 0; i < sz; i++) g2[(b[4] + j) * map.w + b[3] + i] = 1;
  };
  for (const b of snap.buildings) blockB(b);
  for (const b of ghosts.values()) blockB(b);
  gridKey = key;
  gridCache = g2;
  return g2;
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
  else if (a === 'recall' && mouse.in) send({ k: 'ability', a, x: mouse.x, y: mouse.y }); // señalando a un aliado, vas con él
  else send({ k: 'ability', a });
}

function onKey(e: KeyboardEvent): void {
  if (!active || !cur) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  keys.add(e.key);
  const k = e.key.toLowerCase();
  const m = me();
  if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD') {
    codes.add(e.code);
    e.preventDefault();
    return;
  }
  if (k === 'enter') {
    e.preventDefault();
    openChat();
    return;
  }
  if (k === 'tab') {
    e.preventDefault();
    const list = myCommandables();
    if (!list.length) return;
    const i = list.findIndex((u) => u[0] === inspect);
    const nxt = list[(i + 1) % list.length];
    setGroup([nxt[0]]);
    focusUnit(nxt);
    return;
  }
  if (k === 'escape') {
    group = [];
    placing = null;
    targeting = null;
    useSlot = -1;
    selected = 0;
    inspect = 0;
    shopOpen = false;
    return;
  }
  if (k === ' ') {
    follow = true;
    e.preventDefault();
    return;
  }
  if (!m || cur.snap.over) return;
  // 1: vuelve a tu personaje (como F1 en el Dota) aunque estés mandando a otros
  if (k === '1') {
    inspect = 0;
    selected = 0;
    placing = null;
    targeting = null;
    follow = true;
    return;
  }
  if (k === 'r' && !e.repeat) {
    actOnCursor();
    return;
  }
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
    if (n >= 2 && n <= INVENTORY_SLOTS + 1) useItem(n - 2);
    if (k === 'g') shopOpen = !shopOpen;
  }
  if (k === 'h') {
    send({ k: 'stop' });
    orderSent();
  }
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
    case 'roster': {
      const list = myCommandables().filter((u) => UNIT_KIND_ORDER[u[1]] === v);
      if (!list.length) break;
      const nowT = performance.now();
      if (rosterClick.kind === v && nowT - rosterClick.at < 350) {
        setGroup(list.map((u) => u[0]));
        rosterClick = { kind: '', at: 0, idx: 0 };
        break;
      }
      const idx = rosterClick.kind === v ? (rosterClick.idx + 1) % list.length : 0;
      rosterClick = { kind: v, at: nowT, idx };
      setGroup([list[idx][0]]);
      focusUnit(list[idx]);
      break;
    }
    case 'army':
      send({ k: 'army', id: selected, kind: v as SoldierKind });
      break;
    case 'sellunit':
      if (inspect) send({ k: 'sellunit', id: inspect });
      inspect = 0;
      break;
    case 'follow':
      if (inspect) send({ k: 'worker', id: inspect, follow: true });
      break;
    case 'tact':
      actTouch();
      break;
    case 'tme':
      inspect = 0;
      selected = 0;
      placing = null;
      targeting = null;
      follow = true;
      break;
    case 'tchat':
      openChat();
      break;
    case 'endhunt':
      if (window.confirm('¿Terminar la partida ahora? Todos volverán a la sala.')) net.send({ type: 'end_hunt' });
      break;
    case 'unfocus':
      if (selected) send({ k: 'focus', id: selected, target: 0 });
      break;
    case 'train':
      send({ k: 'train', id: selected, unit: v as 'repairer' | 'lumberjack', tier: n });
      break;
    case 'market':
      send({ k: 'market', buy: v === 'buy' || v === 'buybulk', bulk: v === 'buybulk' || v === 'sellbulk' });
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
      send({ k: 'buywood', bulk: v === 'bulk' });
      break;
    case 'wolves':
      send({ k: 'wolves', allow: v === 'on' });
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
      if (v === 'panel') {
        selected = 0;
        inspect = 0;
        group = [];
      }
      if (v === 'shop') shopOpen = false;
      if (v === 'modal') root.querySelector<HTMLElement>('#hk-modal')!.hidden = true;
      break;
    case 'focus':
      follow = true;
      break;
  }
  // forzar a repintar ya (en el sitio, sin rehacer los botones)
  hashes['hk-card'] = '';
  hashes['hk-panel'] = '';
  hashes['hk-shop'] = '';
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
  hashes['hk-modal'] = '';
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
function floatText(x: number, y: number, text: string, color: string, small = false): void {
  fx.push({ kind: 'text', x, y, text, color, born: performance.now(), life: small ? 900 : 1000, small });
}
let incomeSec = -1;
// cada segundo, «+oro» pequeño sobre tus casas y minas (lo que te acaban de pagar)
function incomeFloats(): void {
  const snap = cur?.snap;
  if (!snap || snap.over || snap.sec === incomeSec) return;
  const first = incomeSec < 0;
  incomeSec = snap.sec;
  if (first) return;
  const i = meIdx();
  for (const b of snap.buildings) {
    if (b[2] !== i) continue;
    const { def } = buildingInfo(b);
    if (!def.income) continue;
    const sz = bSize(b);
    floatText(b[3] + sz / 2, b[4] + sz / 2 - (sz === 2 ? 0.95 : 0.6), `+${fmt(def.income * RESOURCE_MULT)}`, '#ffd85e', true);
  }
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
        if (UNIT_SHEETS[ev.kind]) corpses.push({ kind: ev.kind, x: ev.x, y: ev.y, born: now });
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
// Actualiza el HTML de un panel SIN rehacerlo: se conservan los mismos
// elementos y solo se tocan los atributos y textos que cambian. Si se
// reemplazara con innerHTML (la vida, el oro... cambian a cada rato), el botón
// que estás pulsando desaparecería entre el «pulsar» y el «soltar» y el clic se
// perdería.
function setHtml(id: string, html: string): void {
  if (hashes[id] === html) return;
  hashes[id] = html;
  const el = root.querySelector(`#${id}`)!;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  morphChildren(el, tpl.content);
}
function morphChildren(into: Node, from: Node): void {
  const want = Array.from(from.childNodes);
  let i = 0;
  for (; i < want.length; i++) {
    const n = want[i];
    const have = into.childNodes[i];
    if (!have) into.appendChild(n.cloneNode(true));
    else if (!morphNode(have, n)) into.replaceChild(n.cloneNode(true), have);
  }
  while (into.childNodes.length > want.length) into.removeChild(into.lastChild!);
}
// actualiza `have` para que sea como `want`; false si son de distinto tipo
function morphNode(have: Node, want: Node): boolean {
  if (have.nodeType !== want.nodeType) return false;
  if (have.nodeType === Node.TEXT_NODE || have.nodeType === Node.COMMENT_NODE) {
    if (have.nodeValue !== want.nodeValue) have.nodeValue = want.nodeValue;
    return true;
  }
  if (have.nodeType !== Node.ELEMENT_NODE) return false;
  const a = have as Element;
  const b = want as Element;
  if (a.tagName !== b.tagName) return false;
  for (const at of Array.from(a.attributes)) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
  for (const at of Array.from(b.attributes)) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
  morphChildren(a, b);
  return true;
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
    bh = `<b>${s.releaseIn}</b><span>¡Corre${isTouch ? '' : ' (WASD)'}! Elige una parcela, cierra sus puertas con murallas y construye tu casa.</span>`;
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
  layoutDock();
  syncChoose();
}

function manaBar(m: HuntSnapMe): string {
  const [cur0, max] = m.mana ?? [0, 0];
  if (!max) return '';
  return `<div class="bar mana"><i style="width:${Math.min(1, cur0 / max) * 100}%"></i><span>${fmt(cur0)} / ${fmt(max)} maná</span></div>`;
}

function abilityButton(a: Ability): string {
  const def = ABILITIES[a];
  const cd = me()?.cds[a] ?? 0;
  const mana = def.mana ?? 0;
  const noMana = mana > (me()?.mana?.[0] ?? 0);
  const tip = `<b>${def.name}</b> <kbd>${def.key}</kbd><br>${esc(def.desc)}<br><small>Recarga ${def.cd} s${mana ? ` · ${mana} de maná` : ''}</small>`;
  return `<button class="hk-btn ab${targeting === a ? ' on' : ''}${noMana && cd <= 0 ? ' nomana' : ''}" data-act="ability" data-v="${a}" data-tip="${esc(tip)}">
    <span class="ic">${icon(def.icon, def.emoji)}</span><kbd>${def.key}</kbd>${cd > 0 ? `<span class="cd">${cd}</span>` : ''}${mana ? `<span class="mn">${mana}</span>` : ''}</button>`;
}

// huecos del inventario. `own`: los tuyos (se usan con clic y llevan su tecla);
// si no, solo se miran (el equipo del cazador visto por un colono)
function invHtml(inv: HuntSnapMe['inv'], own: boolean): string {
  const act = (i: number) => (own ? ` data-act="slot" data-n="${i}"` : '');
  const key = (i: number) => (own ? `<kbd>${i + 2}</kbd>` : '');
  return inv
    .map((it, i) => {
      if (!it) return `<button class="hk-slot empty"${act(i)}>${key(i)}</button>`;
      if (it.kind === 'cons') {
        const c = CONSUMABLES[it.c];
        return `<button class="hk-slot"${act(i)} data-tip="${esc(`<b>${c.name}</b><br>${c.desc}${own && it.c !== 'ankh' ? '<br><small>Clic para usar</small>' : ''}`)}"><span class="ic">${icon(c.icon)}</span>${key(i)}</button>`;
      }
      if (it.kind === 'trinket') {
        const t = TRINKETS[it.t];
        return `<button class="hk-slot t2"${act(i)} data-tip="${esc(`<b>${t.name}</b><br>${t.desc}${own ? '<br><small>Mayús+clic en la guarida: vender por la mitad</small>' : ''}`)}"><span class="ic">${icon(t.icon)}</span></button>`;
      }
      const tier = ITEMS[it.line].tiers[it.tier];
      const stat = it.line === 'gloves' ? `+${Math.round(tier.value * 100)} %` : `+${fmt(tier.value)}`;
      return `<button class="hk-slot t${Math.min(4, Math.floor(it.tier / 3))}"${act(i)} data-tip="${esc(`<b>${tier.name}</b><br>${stat} ${ITEMS[it.line].stat}${own ? '<br><small>Mayús+clic en la guarida: vender por la mitad</small>' : ''}`)}"><span class="ic">${icon(tier.icon)}</span><span class="lv">${it.tier + 1}</span></button>`;
    })
    .join('');
}
function bootsHtml(level: number, own: boolean): string {
  const boots = level >= 0 ? ITEMS.boots.tiers[level] : null;
  const tip = boots ? `<b>${boots.name}</b><br>+${Math.round(boots.value * 128)} de velocidad${own ? '<br><small>Hueco propio de las botas</small>' : ''}` : own ? 'Hueco para botas (cómpralas en la tienda)' : 'Sin botas';
  return `<button class="hk-slot boots${boots ? ' t1' : ' empty'}" data-tip="${esc(tip)}"><span class="ic">${icon('hk:item-boots')}</span></button>`;
}

const KIND_NAME: Record<UnitKind, string> = {
  hunter: 'Cazador',
  elf: 'Colono',
  angel: 'Ángel',
  wolf: 'Lobo',
  repairer: 'Reparador',
  lumberjack: 'Leñador',
  beast: 'Bestia del cazador',
  mage: 'Mago élfico',
  ...(Object.fromEntries(SOLDIER_ORDER.map((k) => [k, SOLDIERS[k].name])) as Record<SoldierKind, string>),
};

// ficha de la unidad que inspeccionas: vida, nivel y, si es el cazador o un
// lobo, sus estadísticas y sus objetos
function inspectHtml(u: HuntSnapUnit): string {
  const kind = UNIT_KIND_ORDER[u[1]];
  const owner = init?.players[u[2]];
  const sp = cur?.snap.players[u[2]];
  const main = kind === 'hunter' || kind === 'wolf' || kind === 'elf' || kind === 'angel';
  const gear = main && (kind === 'hunter' || kind === 'wolf') ? sp?.gear : undefined;
  const sub = kind === 'hunter' || kind === 'wolf' ? `${KIND_NAME[kind]} · nivel ${u[8]}` : kind === 'repairer' || kind === 'lumberjack' ? `${KIND_NAME[kind]} de ${esc(owner?.name ?? '')}` : KIND_NAME[kind];
  const title = main ? esc(owner?.name ?? KIND_NAME[kind]) : KIND_NAME[kind];
  const frac = Math.max(0, u[5] / Math.max(1, u[6]));
  const lines: string[] = [];
  lines.push(`<div class="bar hp${kind === 'hunter' || kind === 'wolf' ? ' foe' : ''}"><i style="width:${frac * 100}%"></i><span>${fmt(u[5])} / ${fmt(u[6])}</span></div>`);
  if (gear) {
    const st = (k: string, v: string) => `<span class="st"><em>${k}</em>${v}</span>`;
    lines.push(
      `<div class="hk-stats-grid">${st('daño', fmt(gear.stats.dmg))}${st('armadura', fmt(gear.stats.armor))}${st('golpe cada', `${gear.stats.attackSec}s`)}${st('velocidad', String(gear.stats.speed))}${st('regen', `${fmt(gear.stats.regen)}/s`)}</div>`,
    );
    lines.push(`<div class="hk-label">Objetos</div><div class="hk-row inv">${invHtml(gear.inv, false)}<span class="hk-sep"></span>${bootsHtml(gear.boots, false)}</div>`);
  } else if (kind === 'hunter' || kind === 'wolf') {
    lines.push(`<div class="hk-hint">No ves su equipo ahora mismo.</div>`);
  }
  if (u[2] === meIdx() && COMMANDABLE.includes(kind)) {
    const how: Partial<Record<UnitKind, string>> = {
      repairer: 'Clic derecho: en un edificio, lo repara; en el suelo, va allí y repara lo que se rompa cerca.',
      lumberjack: 'Clic derecho: en un árbol, lo tala; en el suelo, va allí y tala el árbol más cercano.',
      beast: 'Clic derecho: en un enemigo, lo ataca; en el suelo, va y se queda; en tu personaje, te sigue.',
      mage: 'Clic derecho: en el cazador, lo ataca; en el suelo, va y se queda; en tu personaje, te sigue.',
    };
    if (isSoldierKind(kind)) lines.push(`<div class="hk-hint">${esc(SOLDIERS[kind].desc)}</div>`);
    lines.push(`<div class="hk-hint">${how[kind] ?? 'Clic derecho: en un enemigo, lo ataca; en el suelo, va y se queda; en tu personaje, te sigue.'}</div>`);
    if (kind === 'repairer' || kind === 'lumberjack') {
      const def = (kind === 'repairer' ? REPAIRERS : LUMBERJACKS)[u[8]];
      lines.push(`<button class="hk-btn sm danger" data-act="sellunit" data-tip="Recuperas la mitad de lo que costó">${icon('hk:demolish')} Vender (+${fmt(Math.floor((def?.gold ?? 0) / 2))})</button>`);
    } else lines.push(`<button class="hk-btn sm" data-act="follow">Que me siga</button>`);
  }
  return `<div class="hk-panel-head"><span class="ic big">${icon(UNIT_ICON[kind])}</span><div><b>${title}</b><small>${sub}</small></div><button data-act="close" data-v="panel">✕</button></div>${lines.join('')}`;
}

// «Tus unidades»: un botón por tipo con su cantidad. Clic = la siguiente de ese
// tipo (y la cámara va a ella); doble clic = todas las de ese tipo
function rosterHtml(): string {
  const list = myCommandables();
  if (!list.length) return '';
  const byKind = new Map<UnitKind, number>();
  for (const u of list) byKind.set(UNIT_KIND_ORDER[u[1]], (byKind.get(UNIT_KIND_ORDER[u[1]]) ?? 0) + 1);
  const sel = new Set(group.length ? group : inspect ? [inspect] : []);
  const btns = [...byKind]
    .map(([k, n]) => {
      const on = list.some((u) => UNIT_KIND_ORDER[u[1]] === k && sel.has(u[0]));
      return `<button class="hk-btn ab roster${on ? ' on' : ''}" data-act="roster" data-v="${k}" data-tip="${esc(`<b>${KIND_NAME[k]}</b> ×${n}<br>Clic: el siguiente · doble clic: todos`)}"><span class="ic">${icon(UNIT_ICON[k])}</span><span class="nb">${n}</span></button>`;
    })
    .join('');
  return `<div class="hk-group"><div class="hk-label">Tus unidades <kbd>Tab</kbd></div><div class="hk-row">${btns}</div></div>`;
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
        ${manaBar(m)}
        <div class="bar xp"><i style="width:${Math.min(1, xpFrac) * 100}%"></i><span>nivel ${m.level} · ${fmt(m.xp - m.xpPrev)}/${fmt(m.xpNext - m.xpPrev)} xp</span></div>
      </div>
      <div class="hk-stats">⚔ ${fmt(m.stats.dmg)} · 🛡 ${fmt(m.stats.armor)} · ⏱ ${m.stats.attackSec}s · 👣 ${m.stats.speed} · ❤ +${fmt(m.stats.regen)}/s${m.attrs[0] || m.attrs[1] ? ` · 💪 ${fmt(m.attrs[0])} · 🏹 ${fmt(m.attrs[1])}` : ''}</div>`;
    } else {
      unitbar = `<div class="hk-bars"><div class="bar hp small"><i style="width:${frac * 100}%"></i><span>${u[5]} / ${u[6]}</span></div>${manaBar(m)}</div>`;
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
    const noTown = m.tech < 2;
    const townTip = noTown ? '<br><em>Necesitas un Ayuntamiento (mejora tu taller).</em>' : '';
    const market = `<div class="hk-market">
      <button class="hk-btn sm${!noTown && afford(s.market + MARKET.step, 0) ? '' : ' poor'}" data-act="market" data-v="buy" data-tip="${esc(`Compra ${MARKET.lot} de madera. Cada compra la encarece para todos.${townTip}`)}">${icon('hk:wood')}+${MARKET.lot} <small>${icon('hk:gold')}${s.market + MARKET.step}</small></button>
      <button class="hk-btn sm${!noTown && m.wood >= MARKET.lot ? '' : ' poor'}" data-act="market" data-v="sell" data-tip="${esc(`Vende ${MARKET.lot} de madera.${townTip}`)}">${icon('hk:wood')}−${MARKET.lot} <small>${icon('hk:gold')}${s.market}</small></button>
      <button class="hk-btn sm${!noTown && afford(s.market + MARKET.step, 0) ? '' : ' poor'}" data-act="market" data-v="buybulk" data-tip="${esc(`Compra 200 de madera de golpe (20 lotes; el precio sube en cada uno).${townTip}`)}">${icon('hk:wood')}+200</button>
      <button class="hk-btn sm${!noTown && m.wood >= MARKET.lot ? '' : ' poor'}" data-act="market" data-v="sellbulk" data-tip="${esc(`Vende hasta 200 de madera de golpe.${townTip}`)}">${icon('hk:wood')}−200</button>
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
      <div class="hk-group"><div class="hk-label">Mercado</div>${market}</div>${rosterHtml()}`;
  } else if (m.side === 'hunter') {
    const inv = invHtml(m.inv, true);
    const bootsSlot = bootsHtml(m.boots, true);
    card = `<div class="hk-group"><div class="hk-label">Habilidades</div><div class="hk-row">${abilities}</div></div>
      <div class="hk-group"><div class="hk-label">Inventario</div><div class="hk-row inv">${inv}<span class="hk-sep"></span>${bootsSlot}</div></div>
      <div class="hk-group"><div class="hk-label">Guarida</div><div class="hk-row"><button class="hk-btn ab shopbtn${shopOpen ? ' on' : ''}" data-act="shop" data-tip="Tienda de la guarida (G). Solo se compra estando cerca."><span class="ic">${icon('hk:shop')}</span><kbd>G</kbd>${m.nearShop ? '<span class="dot"></span>' : ''}</button>${m.form === 'hunter' ? `<button class="hk-btn ab${m.allowWolves ? ' on' : ''}" data-act="wolves" data-v="${m.allowWolves ? 'off' : 'on'}" data-tip="${esc(m.allowWolves ? '<b>Admites lobos</b><br>Los colonos que caigan pueden unirse a ti como lobos. Clic para no admitirlos.' : '<b>No admites lobos</b><br>Los caídos solo pueden volver como ángeles. Clic para admitirlos.')}"><span class="ic">${icon('hk:wolf')}</span><span class="ct">${m.allowWolves ? 'sí' : 'no'}</span></button>` : ''}</div></div>${rosterHtml()}`;
  } else if (m.form === 'angel') {
    card = `<div class="hk-group"><div class="hk-label">Ángel · ayuda a los colonos</div><div class="hk-row">${abilities}</div></div>
      <div class="hk-hint">Señala un edificio de los colonos y pulsa R para repararlo. Roba oro junto a la guarida del cazador.</div>`;
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
    if (group.length && cur) {
      group = group.filter((id) => cur!.snap.units.some((o) => o[0] === id));
      if (group.length > 1) {
        const byKind = new Map<UnitKind, number>();
        for (const id of group) {
          const u = cur.snap.units.find((o) => o[0] === id)!;
          byKind.set(UNIT_KIND_ORDER[u[1]], (byKind.get(UNIT_KIND_ORDER[u[1]]) ?? 0) + 1);
        }
        const chips = [...byKind].map(([k, n]) => `<span class="hk-gchip">${icon(UNIT_ICON[k])}<b>${n}</b> ${esc(KIND_NAME[k])}</span>`).join('');
        setHtml(
          'hk-panel',
          `<div class="hk-panel-head"><span class="ic big">${icon('hk:upgrade')}</span><div><b>${group.length} unidades</b><small>seleccionadas</small></div><button data-act="close" data-v="panel">✕</button></div><div class="hk-gchips">${chips}</div><div class="hk-hint">Clic derecho: van todas (a reparar, talar, atacar o a un punto, repartidas). Mayús+clic suma o quita una.</div>`,
        );
        panel.hidden = false;
        return;
      }
      if (group.length === 1) setGroup(group);
    }
    const iu = inspect && cur && !cur.snap.over ? cur.snap.units.find((o) => o[0] === inspect) : undefined;
    if (inspect && !iu) inspect = 0;
    if (iu) {
      setHtml('hk-panel', inspectHtml(iu));
      panel.hidden = false;
      return;
    }
    if (!panel.hidden) panel.hidden = true;
    hashes['hk-panel'] = '';
    return;
  }
  const { type, wall, tower, def } = buildingInfo(b);
  const level = b[5];
  const maxLv = type === 'wall' ? wallMaxLevel(wall) : type === 'tower' && level === TOWER_GREEN_FINAL ? level : levelsOf(type);
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
      up = `<div class="hk-label">Especialidad (nivel 6)</div><div class="hk-branches">${WALL_BRANCH_ORDER.filter((br) => !WALL_BRANCHES[br].hidden).map((br) => {
        const nd = levelDef('wall', 6, br, 'main');
        const req = reqText(nd.req);
        return `<button class="hk-branch${!afford(nd.gold, nd.wood) || req ? ' poor' : ''}" data-act="upgrade" data-v="${br}" data-tip="${esc(`<b>${WALL_BRANCHES[br].name}</b> · ${fmt(nd.hp)} de vida, armadura ${nd.armor}<br>${WALL_BRANCHES[br].pitch}`)}">
          <span class="ic">${icon(WALL_BRANCHES[br].icon)}</span><b>${WALL_BRANCHES[br].name}</b><small>${costHtml(nd.gold, nd.wood)}</small></button>`;
      }).join('')}</div>`;
    } else if (type === 'tower' && TOWER_FORKS[level]) {
      // bifurcación: elegir rama (como en el original)
      up = `<div class="hk-label">Elige cómo sigue</div><div class="hk-branches two">${TOWER_FORKS[level]
        .map((f) => {
          const nd = levelDef('tower', f.level, null, 'main');
          const req = reqText(nd.req);
          const tip = `<b>${nd.name}</b><br>vida ${fmt(nd.hp)} · daño ${fmt(nd.dmg ?? 0)} · alcance ${(nd.range ?? 0).toFixed(1)}${f.level === TOWER_GREEN_FINAL ? '<br><em>Final de su rama: no sube más.</em>' : ''}${f.level === 13 ? '<br><em>Se salta el Dragón negro.</em>' : ''}`;
          return `<button class="hk-branch${!afford(nd.gold, nd.wood) || req ? ' poor' : ''}" data-act="upgrade" data-v="${f.branch}" data-tip="${esc(tip)}"><span class="ic">${icon('hk:tower')}</span><b>${nd.name}</b><small>${costHtml(nd.gold, nd.wood)}</small></button>`;
        })
        .join('')}</div>`;
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

  // muralla salida de la aleatoria: un único sorteo de armadura a los 3 minutos
  if (type === 'wall' && b[12] >= 0) {
    up += `<button class="hk-btn wide${b[12] > 0 ? ' poor' : ''}" data-act="lots" data-tip="${esc('<b>Sortear armadura</b><br>Una sola vez: de −3 a +3 de armadura para siempre.')}">${icon('hk:wall-random')} Sortear armadura <span class="ct">${b[12] > 0 ? `${b[12]} s` : 'ya'}</span></button>`;
  } else if (type === 'wall' && b[11]) lines.push(`<div class="hk-req ok">Armadura sorteada: ${b[11] > 0 ? '+' : ''}${b[11]}</div>`);
  if (type === 'wall' && def.eatsTree) {
    up += `<button class="hk-btn wide${b[9] & 64 ? ' poor' : ''}" data-act="eat" data-tip="${esc(`<b>Comerse un árbol</b><br>Uno a 4 casillas como mucho: +${fmt(def.eatsTree)} de vida en 30 s. El árbol vuelve a crecer al minuto.`)}">${icon('hk:wall-tree')} Comerse un árbol <span class="ct">+${fmt(def.eatsTree)}</span></button>`;
  }
  if (type === 'tower' && b[10] > 0) lines.push(`<div class="hk-req ok">Remodelada ${b[10]}/5: +${b[10] * 20} % de alcance, +${b[10] * 5} % de cadencia</div>`);
  let train = '';
  let army = '';
  if (type === 'workshop' && level >= 5) {
    army = `<div class="hk-label">Ejército (Cenarion Keep)</div><div class="hk-train">${SOLDIER_ORDER.map((k) => {
      const d = SOLDIERS[k];
      const stats = d.dmg ? `vida ${fmt(d.hp)} · daño ${fmt(d.dmg)} · alcance ${d.range.toFixed(1)} · armadura ${d.armor}` : `vida ${fmt(d.hp)} · no ataca`;
      return `<button class="hk-btn tr${!afford(d.gold, d.wood) ? ' poor' : ''}" data-act="army" data-v="${k}" data-tip="${esc(`<b>${d.name}</b> · ${costHtml(d.gold, d.wood)} · comida ${d.food}<br>${stats}<br>${d.desc}`)}"><span class="ic">${icon(d.icon)}</span><span class="ct">${d.gold ? fmt(d.gold) : `${fmt(d.wood)}🪵`}</span></button>`;
    }).join('')}</div>`;
  }
  if (type === 'workshop' || type === 'elftree') {
    const table = type === 'workshop' ? REPAIRERS : LUMBERJACKS;
    const kind = type === 'workshop' ? 'repairer' : 'lumberjack';
    train = `<div class="hk-label">${type === 'workshop' ? 'Reparadores' : 'Leñadores'}</div><div class="hk-train">${table
      .map((w, i) => {
        const req = reqText(w.req);
        const info = kind === 'repairer' ? `repara el edificio entero en ${Math.round(50 * (w.ratio ?? 1))} s · comida ${w.food}` : `${(w.woodPerSec ?? 0) * RESOURCE_MULT} de madera/s`;
        const extra = w.name === 'Paladín' ? '<br>Luz sagrada al edificio más dañado, Armadura sagrada y +3 de armadura alrededor.' : '';
        return `<button class="hk-btn tr${!afford(w.gold, w.wood ?? 0) || req ? ' poor' : ''}" data-act="train" data-v="${kind}" data-n="${i}" data-tip="${esc(`<b>${w.name}</b> · ${costHtml(w.gold, w.wood ?? 0)}<br>${info}${extra}${req ? `<br><em>${req}</em>` : ''}`)}">
          <span class="ic">${icon(kind === 'repairer' ? 'hk:repairer' : 'hk:lumberjack')}</span><span class="lv">${i + 1}</span><span class="ct">${fmt(w.gold)}</span></button>`;
      })
      .join('')}</div>`;
  }
  let towerFocus = '';
  if (type === 'tower' && def.dmg) {
    const fu = b[13] ? cur!.snap.units.find((o) => o[0] === b[13]) : undefined;
    towerFocus = fu
      ? `<div class="hk-focus">${icon(UNIT_ICON[UNIT_KIND_ORDER[fu[1]]])}<span>Objetivo: <b>${esc(init?.players[fu[2]]?.name ?? KIND_NAME[UNIT_KIND_ORDER[fu[1]]])}</b></span><button class="hk-btn sm" data-act="unfocus">Quitar</button></div>`
      : `<div class="hk-hint">Clic derecho sobre un enemigo: esta torre le dispara primero.</div>`;
  }
  const html = `<div class="hk-panel-head"><span class="ic big">${icon(buildingIcon(b))}</span><div><b>${esc(def.name)}</b><small>nivel ${level}/${maxLv}</small></div><button data-act="close" data-v="panel">✕</button></div>
    ${lines.join('')}${up}${train}${army}
    ${towerFocus}<button class="hk-btn sm danger" data-act="demolish" data-tip="Vender (Supr): recuperas la mitad de lo invertido. Solo con la vida casi entera y sin el cazador cerca.">${icon('hk:demolish')} Vender (½)</button>`;
  setHtml('hk-panel', html);
  panel.hidden = false;
}

// el panel y la tienda van AL LADO de la barra de mando si caben; si no, flotan
// justo encima de su extremo derecho (cerca de la mano, sin tapar el centro)
function layoutDock(): void {
  const dock = root.querySelector<HTMLElement>('.hk-dock');
  const inner = root.querySelector<HTMLElement>('#hk-dock-in');
  const side = root.querySelector<HTMLElement>('.hk-side');
  const card = root.querySelector<HTMLElement>('.hk-card-wrap');
  if (!dock || !inner || !side || !card) return;
  const open = [...side.children].some((c) => !(c as HTMLElement).hidden);
  if (!open) {
    inner.classList.remove('stack');
    return;
  }
  const sideW = Math.max(...[...side.children].map((c) => ((c as HTMLElement).hidden ? 0 : (c as HTMLElement).offsetWidth)));
  const fits = card.offsetWidth + 8 + sideW <= dock.clientWidth;
  inner.classList.toggle('stack', !fits);
}

function syncShop(): void {
  const shop = root.querySelector<HTMLElement>('#hk-shop')!;
  const m = me();
  if (!shopOpen || !m || m.side !== 'hunter' || cur!.snap.over) {
    if (!shop.hidden) shop.hidden = true;
    hashes['hk-shop'] = '';
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
    <button class="hk-item${afford(WOOD_BULK.gold, 0) && m.nearShop ? '' : ' poor'}" data-act="buywood" data-v="bulk" data-tip="${esc(`<b>${WOOD_BULK.wood} de madera</b><br>Al por mayor, algo más baratas.<br>${costHtml(WOOD_BULK.gold, 0)}`)}"><span class="ic">${icon('hk:item-wood')}</span><span class="v">×${WOOD_BULK.wood}</span><span class="ct">${fmt(WOOD_BULK.gold)}</span></button>
    ${m.form === 'hunter' ? `<button class="hk-item hut${nextHut && afford(nextHut.cost, 0) ? '' : ' poor'}" data-act="hut" data-tip="${esc(nextHut ? `<b>Mejorar la guarida</b><br>${m.hutIncome} → ${nextHut.income * RESOURCE_MULT} de oro/s<br>${costHtml(nextHut.cost, 0)}` : 'Guarida al máximo')}"><span class="ic">${icon('hk:hut')}</span><span class="v">nv ${m.hutLevel}</span><span class="ct">${nextHut ? fmt(nextHut.cost) : 'máx'}</span></button>` : ''}
  </div></div>`;
  const html = `<div class="hk-panel-head"><span class="ic big">${icon('hk:shop')}</span><div><b>Tienda de la guarida</b><small>${m.nearShop ? 'Dos objetos iguales se funden en el siguiente nivel' : 'Acércate a la guarida para comprar'}</small></div><button data-act="close" data-v="shop">✕</button></div>${lines}${extras}`;
  setHtml('hk-shop', html);
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
        ${cur?.snap.wolves === false
          ? `<button class="hk-choice wolf off" disabled><span class="ic">${icon('hk:wolf')}</span><b>Lobo</b><small>El cazador no admite lobos en esta partida.</small></button>`
          : `<button class="hk-choice wolf" data-act="form" data-v="wolf"><span class="ic">${icon('hk:wolf')}</span><b>Lobo</b><small>Te pasas al cazador: golpeas y cobras oro por cada golpe, compras en su guarida. Empiezas con oro según los minutos de partida.</small></button>`}
      </div></div>`;
    setHtml('hk-modal', html);
    hashes.choose = html;
    modal.hidden = false;
  } else if (hashes.choose) {
    hashes.choose = '';
    modal.hidden = true;
  }
}

// ---------- dibujo ----------
// Posición que se pinta de cada unidad: se INTERPOLA entre los dos últimos
// snapshots (un tick por detrás, como hacen el Dota o el WC3), así nada da
// saltos hacia atrás. Tu propio personaje, mientras pulsas WASD, se mueve en
// local con la misma regla de choques que el servidor (sin esperar la red) y se
// corrige con suavidad: lo lateral siempre; lo que vas por delante en la marcha
// (la latencia) solo si se dispara; al soltar, converge donde paró el servidor.
function lerpUnits(now: number): Map<number, { x: number; y: number }> {
  const out = new Map<number, { x: number; y: number }>();
  if (!cur) return out;
  const t = prev ? Math.min(1, Math.max(0, (now - cur.at) / Math.max(30, cur.at - prev.at))) : 1;
  const old = new Map(prev ? prev.snap.units.map((u) => [u[0], u] as const) : []);
  const mine = myUnit();
  const dt = Math.min(0.1, Math.max(0, (now - (lastLerp || now)) / 1000));
  lastLerp = now;
  if (!mine) local.on = false;
  for (const u of cur.snap.units) {
    const o = old.get(u[0]);
    let x = u[3];
    let y = u[4];
    if (o && Math.hypot(o[3] - u[3], o[4] - u[4]) < 2) {
      x = o[3] + (u[3] - o[3]) * t;
      y = o[4] + (u[4] - o[4]) * t;
    }
    if (mine && u[0] === mine[0]) {
      const m = cur.snap.me;
      const [sx, sy] = steerActive;
      const held = (u[7] & 6) !== 0 || (m?.form === 'hunter' && cur.snap.releaseIn > 0);
      const spd = m?.speed ?? 0;
      if ((sx || sy) && !held && spd > 0) {
        if (!local.on) {
          const d0 = disp.get(u[0]) ?? { x, y };
          local.on = true;
          local.x = d0.x;
          local.y = d0.y;
        }
        const nx = steerStep(map, clientGrid(), local.x, local.y, sx, sy, spd * dt);
        local.x = nx.x;
        local.y = nx.y;
        const k = sx && sy ? Math.SQRT1_2 : 1;
        const ux = sx * k;
        const uy = sy * k;
        const ex = u[3] - local.x;
        const ey = u[4] - local.y;
        const along = ex * ux + ey * uy;
        const pull = Math.min(1, dt * 5);
        // lateral: siempre hacia el servidor
        local.x += (ex - along * ux) * pull;
        local.y += (ey - along * uy) * pull;
        // en la marcha: si el servidor va por delante, alcanzarle; si nos hemos
        // adelantado demasiado (p. ej. allí estabas bloqueado), volver
        if (along > 0.05) {
          local.x += ux * along * pull;
          local.y += uy * along * pull;
        } else if (along < -2) {
          local.x += ux * (along + 2) * pull;
          local.y += uy * (along + 2) * pull;
        }
      } else if (local.on) {
        // soltaste: en cuanto el servidor también pare, converger a su posición
        const ack = m?.steer;
        // (hacia su ÚLTIMA posición, no la interpolada, que aún viene por detrás)
        if (!ack || (!ack[0] && !ack[1]) || held) {
          const k = Math.min(1, dt * 9);
          local.x += (u[3] - local.x) * k;
          local.y += (u[4] - local.y) * k;
          // se suelta cuando la interpolada también ha llegado (si no, daría un tirón atrás)
          if (Math.hypot(u[3] - local.x, u[4] - local.y) < 0.03 && Math.hypot(u[3] - x, u[4] - y) < 0.03) local.on = false;
        }
      }
      if (local.on) {
        x = local.x;
        y = local.y;
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
  // el dibujo ocupa menos que su hueco (el hueco sigue bloqueando el paso):
  // casa, taller, mina y árbol élfico ~1,35 casillas; torre ~0,95; la muralla
  // llena su casilla porque es una pared
  const wall = type === 'wall';
  const iconSize = wall ? s * 1.08 : size === 2 ? s * 1.38 : s * 0.98;
  const icx = sx + w / 2;
  const icy = sy + w / 2 + (wall ? 0 : size === 2 ? s * 0.08 : -s * 0.04);
  // suelo del hueco: tenue, para ver qué casillas tapa
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.beginPath();
  g.roundRect(sx + 3, sy + 3, w - 6, w - 6, s * 0.14);
  g.fill();
  // sombra y aro del dueño bajo el edificio
  if (!wall) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(icx, icy + iconSize * 0.4, iconSize * 0.42, iconSize * 0.13, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = color;
  g.globalAlpha *= 0.7;
  g.lineWidth = Math.max(1.2, s * 0.04);
  g.beginPath();
  if (wall) g.roundRect(sx + 3, sy + 3, w - 6, w - 6, s * 0.12);
  else g.ellipse(icx, icy + iconSize * 0.4, iconSize * 0.44, iconSize * 0.14, 0, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = ghost ? 0.38 : 1;
  // brillo para la casa (es lo que más importa) y las minas
  if (!ghost && (type === 'house' || type === 'mine')) {
    const grd = g.createRadialGradient(icx, icy, 0, icx, icy, iconSize * 0.8);
    grd.addColorStop(0, 'rgba(255, 205, 69, 0.22)');
    grd.addColorStop(1, 'rgba(255, 205, 69, 0)');
    g.fillStyle = grd;
    g.fillRect(icx - iconSize, icy - iconSize, iconSize * 2, iconSize * 2);
  }
  if (!drawPxIcon(g, buildingIcon(b), icx, icy, iconSize)) {
    g.fillStyle = '#8a7a5a';
    g.fillRect(icx - iconSize * 0.4, icy - iconSize * 0.4, iconSize * 0.8, iconSize * 0.8);
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
    // nivel: en la esquina del DIBUJO, no del hueco
    const bx = wall ? sx + w - s * 0.16 : icx + iconSize * 0.4;
    const by = wall ? sy + s * 0.16 : icy - iconSize * 0.38;
    g.fillStyle = 'rgba(8,10,16,0.85)';
    g.beginPath();
    g.arc(bx, by, s * 0.15, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffe9a8';
    g.font = `800 ${Math.round(Math.max(9, s * 0.23))}px system-ui, sans-serif`;
    g.fillText(String(b[5]), bx, by + s * 0.01);
    if (b[6] < b[7]) bar(icx, (wall ? sy : icy - iconSize * 0.5) - s * 0.1, wall ? 0.9 : Math.min(size * 0.9, 1.2), b[6] / b[7], b[6] / b[7] > 0.4 ? '#7bd88f' : '#ff5a4e');
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

// ---------- sprites ----------
function hexHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return rgbHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}
function rgbHsl(r: number, g2: number, b: number): [number, number, number] {
  r /= 255;
  g2 /= 255;
  b /= 255;
  const mx = Math.max(r, g2, b);
  const mn = Math.min(r, g2, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s2 = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g2 - b) / d + (g2 < b ? 6 : 0) : mx === g2 ? (b - r) / d + 2 : (r - g2) / d + 4;
  h *= 60;
  return [h, s2, l];
}
function hslRgb(h: number, s2: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s2;
  const hp = (((h % 360) + 360) % 360) / 60;
  const xx = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, xx, 0] : hp < 2 ? [xx, c, 0] : hp < 3 ? [0, c, xx] : hp < 4 ? [0, xx, c] : hp < 5 ? [xx, 0, c] : [c, 0, xx];
  const m0 = l - c / 2;
  return [Math.round((r1 + m0) * 255), Math.round((g1 + m0) * 255), Math.round((b1 + m0) * 255)];
}

// la túnica verde del elfo se pinta del color del jugador (una vez por color)
function sheetImage(kind: string, color: string): CanvasImageSource {
  if (!TINTED.has(kind)) return unitAtlas;
  const key = `${kind}|${color}`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const sh = UNIT_SHEETS[kind];
  // solo la franja del atlas de este personaje (mismas coordenadas que el atlas)
  const y0 = Math.min(...sh.frames.map((f) => f[1]));
  const h = Math.max(...sh.frames.map((f) => f[1])) + sh.h;
  const c = document.createElement('canvas');
  c.width = unitAtlas.width;
  c.height = h;
  const cx = c.getContext('2d', { willReadFrequently: true })!;
  cx.drawImage(unitAtlas, 0, y0, unitAtlas.width, h - y0, 0, y0, unitAtlas.width, h - y0);
  const img = cx.getImageData(0, y0, c.width, h - y0);
  const d = img.data;
  const [th, ts] = hexHsl(color);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const [hh, ss, ll] = rgbHsl(d[i], d[i + 1], d[i + 2]);
    if (hh < 75 || hh > 170 || ss < 0.22 || ll < 0.1) continue;
    const [r, g1, b] = hslRgb(th, Math.min(1, ss * 0.45 + ts * 0.6), ll);
    d[i] = r;
    d[i + 1] = g1;
    d[i + 2] = b;
  }
  cx.putImageData(img, 0, y0);
  tintCache.set(key, c);
  return c;
}

// dibuja un cuadro con los pies en (x, footY)
function drawSprite(kind: string, sheet: UnitSheet, fi: number, x: number, footY: number, s: number, color: string): void {
  const [fx0, fy0] = sheet.frames[fi];
  const k = ((SPRITE_TILES[kind] ?? 1.3) * s) / sheet.ref;
  const dw = sheet.w * k;
  const dh = sheet.h * k;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(sheetImage(kind, color), fx0, fy0, sheet.w, sheet.h, x - dw / 2, footY - dh + k, dw, dh);
}

function drawCorpse(c: { kind: string; x: number; y: number; born: number }, x: number, y: number, now: number): void {
  const sheet = UNIT_SHEETS[c.kind];
  if (!sheet || !unitAtlasOk) return;
  const age = now - c.born;
  const fr = sheet.anims.death;
  const fi = fr[Math.min(fr.length - 1, Math.floor(age / 170))];
  g.save();
  g.globalAlpha = age > 2200 ? Math.max(0, 1 - (age - 2200) / 800) : 1;
  drawSprite(c.kind, sheet, fi, x, y + cellPx() * 0.32, cellPx(), '#3fa34d');
  g.restore();
}

const ACT_DIRS: Dir[] = ['down', 'left', 'right', 'up'];
const DIR_VEC: [number, number][] = [[0, 1], [-1, 0], [1, 0], [0, -1]];
// árboles que se están talando este fotograma (casilla → hora de inicio)
const chopping = new Map<number, number>();
const chopSeen = new Set<number>();
// el árbol que está talando un leñador: el de su lado de trabajo más cercano
function treeOf(x: number, y: number, act: number): number {
  const [vx, vy] = DIR_VEC[act - 1];
  const dead = new Set(cur?.snap.deadTrees ?? []);
  let best = -1;
  let bestD = Infinity;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = Math.floor(x + vx * 0.6) + i;
      const cy = Math.floor(y + vy * 0.6) + j;
      if (cx < 0 || cy < 0 || cx >= map.w || cy >= map.h) continue;
      const idx = cy * map.w + cx;
      if (map.tiles[idx] !== TILE_TREE || dead.has(idx)) continue;
      const d = Math.hypot(cx + 0.5 - x - vx * 0.5, cy + 0.5 - y - vy * 0.5);
      if (d < bestD) {
        bestD = d;
        best = idx;
      }
    }
  return best;
}

function drawUnit(u: HuntSnapUnit, x: number, y: number, now: number, moving: boolean, faceLeft: boolean): void {
  const s = cellPx();
  const kind = UNIT_KIND_ORDER[u[1]];
  const color = playerColor(u[2]);
  const big = kind === 'hunter' || kind === 'wolf';
  const worker = kind === 'repairer' || kind === 'lumberjack';
  const sheet = unitAtlasOk ? UNIT_SHEETS[kind] : undefined;
  // obrero trabajando: se pega a su árbol/edificio (sombra incluida)
  const working = worker && (u[9] ?? 0) > 0;
  if (working) {
    const [vx, vy] = DIR_VEC[u[9] - 1];
    x += vx * s * (kind === 'lumberjack' ? 0.5 : 0.36);
    y += vy * s * (kind === 'lumberjack' ? (vy < 0 ? 0.62 : 0.4) : 0.36);
  }
  const soldier = isSoldierKind(kind);
  const size = sheet ? (SPRITE_TILES[kind] ?? 1.3) * s * 0.8 : soldier ? SOLDIERS[kind].size * s : kind === 'hunter' ? s * 2 : kind === 'wolf' ? s * 1.45 : worker ? s * 0.85 : s * 1.2;
  const footY = sheet ? y + s * 0.32 : y + size * 0.36;
  const topY = sheet ? footY - (SPRITE_TILES[kind] ?? 1.3) * s * 0.92 : y - size * 0.55;
  const invis = (u[7] & 1) !== 0;
  g.save();
  // objetivo fijado por la torre que tienes seleccionada: mira roja
  const selB = selected ? cur?.snap.buildings.find((o) => o[0] === selected) : undefined;
  if (selB && selB[13] === u[0]) {
    const r = size * 0.5;
    g.strokeStyle = '#ff5a4e';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(x, footY - size * 0.35, r, 0, Math.PI * 2);
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      g.moveTo(x + ax * r * 0.6, footY - size * 0.35 + ay * r * 0.6);
      g.lineTo(x + ax * r * 1.25, footY - size * 0.35 + ay * r * 1.25);
    }
    g.stroke();
  }
  if (group.includes(u[0])) {
    g.strokeStyle = '#9be28a';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(x, footY, size * 0.46, size * 0.16, 0, 0, Math.PI * 2);
    g.stroke();
  }
  if (u[0] === inspect) {
    g.strokeStyle = '#ffcd45';
    g.lineWidth = 2;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.ellipse(x, footY, size * 0.48, size * 0.17, 0, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  if (invis) g.globalAlpha = 0.45;
  // sombra y aro del dueño
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.beginPath();
  g.ellipse(x, footY, size * 0.36, size * 0.12, 0, 0, Math.PI * 2);
  g.fill();
  if (!worker) {
    g.strokeStyle = color;
    g.lineWidth = Math.max(1.5, s * 0.05);
    g.beginPath();
    g.ellipse(x, footY, size * 0.38, size * 0.13, 0, 0, Math.PI * 2);
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
    const grd = g.createRadialGradient(x, y - s * 0.3, 0, x, y - s * 0.3, size * 0.8);
    grd.addColorStop(0, 'rgba(255, 250, 220, 0.4)');
    grd.addColorStop(1, 'rgba(255, 250, 220, 0)');
    g.fillStyle = grd;
    g.fillRect(x - size, y - size - s * 0.3, size * 2, size * 2);
  }
  // obreros trabajando: pegados a su árbol o edificio, dando hachazos/martillazos
  if (working && !sheet) {
    const [vx] = DIR_VEC[u[9] - 1];
    const swing = Math.sin(now / 85);
    g.translate(x, y - s * 0.06 - Math.max(0, swing) * s * 0.04);
    if (vx < 0) g.scale(-1, 1);
    g.rotate(swing * 0.28);
    if (!drawPxIcon(g, UNIT_ICON[kind], 0, 0, size)) {
      g.fillStyle = color;
      g.beginPath();
      g.arc(0, 0, size * 0.35, 0, Math.PI * 2);
      g.fill();
    }
  } else if (sheet) {
    const a = anim.get(u[0]);
    let dir: Dir = a?.dir ?? 'down';
    let fi: number;
    const act = u[9] ?? 0;
    if (act >= 1 && act <= 4) {
      dir = ACT_DIRS[act - 1];
      if (a) a.dir = dir;
      const fr = sheet.anims.act[dir];
      fi = fr[Math.floor(now / 115) % fr.length];
    } else if (moving) {
      const fr = sheet.anims.walk[dir];
      fi = fr[Math.floor((a?.walk ?? 0) / (STRIDE[kind] ?? 0.3)) % fr.length];
    } else fi = sheet.anims.idle[dir];
    // el ángel flota
    const lift = kind === 'angel' ? Math.sin(now / 380) * s * 0.05 : 0;
    drawSprite(kind, sheet, fi, x, footY + lift, s, color);
  } else {
    const bob = moving ? Math.sin(now / (big ? 120 : 90)) * size * 0.04 : 0;
    g.translate(x, y - size * 0.1 + bob);
    if (faceLeft) g.scale(-1, 1);
    if (!drawPxIcon(g, UNIT_ICON[kind], 0, 0, size)) {
      g.fillStyle = color;
      g.beginPath();
      g.arc(0, 0, size * 0.35, 0, Math.PI * 2);
      g.fill();
    }
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
    g.fillText(st.join(''), x, topY - s * 0.45);
  }
  if (!worker && !soldier) {
    const name = init?.players[u[2]]?.name ?? '';
    g.font = `700 ${Math.round(Math.max(10, s * 0.26))}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    const label = big ? `${name} · ${u[8]}` : name;
    const ly = topY;
    g.strokeText(label, x, ly);
    g.fillStyle = big ? '#ffb4ad' : '#fff';
    g.fillText(label, x, ly);
  }
  if (u[5] < u[6] || big) bar(x, topY + s * 0.03, big ? 1.4 : worker ? 0.6 : 0.8, u[5] / u[6], big ? '#ff5a4e' : '#7bd88f');
  g.restore();
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (!active || !cur || !init) return;
  syncSteer();
  incomeFloats();
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
      const idx = y * map.w + x;
      drawables.push({
        y: y + 0.8,
        draw: () => {
          const c0 = chopping.get(idx);
          if (c0 === undefined) return drawTree(X(x), Y(y) - s * 0.25, s * 1.1, n);
          // talando: el árbol se sacude con cada hachazo y salen astillas
          const hit = Math.max(0, Math.sin(now / 85));
          drawTree(X(x) + Math.sin(now / 40) * s * 0.035 * hit, Y(y) - s * 0.25, s * 1.1, n);
          for (let k = 0; k < 4; k++) {
            const ph = ((now - c0) / 520 + k / 4) % 1;
            const ang = -Math.PI / 2 + (hash(x + k, y) - 0.5) * 2.4;
            const d = s * (0.15 + ph * 0.55);
            g.globalAlpha = 1 - ph;
            g.fillStyle = k % 2 ? '#c8935a' : '#8a5a32';
            const cs = Math.max(2, s * 0.07);
            g.fillRect(X(x + 0.5) + Math.cos(ang) * d - cs / 2, Y(y + 0.55) + Math.sin(ang) * d + ph * ph * s * 0.4 - cs / 2, cs, cs);
          }
          g.globalAlpha = 1;
        },
      });
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
    // dirección y paso de la animación según lo que se mueve EN PANTALLA
    let a = anim.get(u[0]);
    if (!a) {
      a = { dir: 'down', walk: 0, x: p.x, y: p.y, movedAt: -1e9 };
      anim.set(u[0], a);
    }
    const ddx = p.x - a.x;
    const ddy = p.y - a.y;
    const dist = Math.hypot(ddx, ddy);
    if (dist > 0.0015 && dist < 1.5) {
      a.walk += dist;
      a.movedAt = now;
      // en diagonal pura se queda con la que tenía (no parpadea)
      if (Math.abs(ddx) > Math.abs(ddy) * 1.15) a.dir = ddx < 0 ? 'left' : 'right';
      else if (Math.abs(ddy) > Math.abs(ddx) * 1.15) a.dir = ddy < 0 ? 'up' : 'down';
    }
    a.x = p.x;
    a.y = p.y;
    if (u[1] === UNIT_KIND_ORDER.indexOf('lumberjack') && (u[9] ?? 0) > 0) {
      const t = treeOf(p.x, p.y, u[9]);
      if (t >= 0) {
        chopSeen.add(t);
        if (!chopping.has(t)) chopping.set(t, now);
      }
    }
    const moving = now - a.movedAt < 140;
    const left = a.dir === 'left';
    drawables.push({ y: p.y + 0.2, draw: () => drawUnit(u, X(p.x), Y(p.y), now, moving, left) });
  }
  for (const t of chopping.keys()) if (!chopSeen.has(t)) chopping.delete(t);
  chopSeen.clear();
  if (anim.size > snap.units.length * 2 + 20) {
    const alive = new Set(snap.units.map((u) => u[0]));
    for (const id of anim.keys()) if (!alive.has(id)) anim.delete(id);
  }
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i];
    if (now - c.born > 3000) {
      corpses.splice(i, 1);
      continue;
    }
    drawables.push({ y: c.y, draw: () => drawCorpse(c, X(c.x), Y(c.y), now) });
  }
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  // lo que hay bajo el ratón se ilumina (así sabes qué vas a seleccionar)
  if (mouse.in && !isTouch && !placing && !targeting && useSlot < 0 && !boxSel.moved) {
    const hu = unitAt(mouse.x, mouse.y);
    const hb = hu ? undefined : buildingAt(mouse.x, mouse.y);
    canvas.style.cursor = hu || hb ? 'pointer' : 'crosshair';
    g.save();
    g.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    g.lineWidth = 2;
    g.setLineDash([4, 3]);
    if (hu) {
      const p = pos.get(hu[0]) ?? { x: hu[3], y: hu[4] };
      const h = unitHeight(UNIT_KIND_ORDER[hu[1]]);
      g.beginPath();
      g.ellipse(X(p.x), Y(p.y) + s * 0.36, h * s * 0.36, h * s * 0.13, 0, 0, Math.PI * 2);
      g.stroke();
    } else if (hb) {
      g.strokeRect(X(hb[3]) + 2, Y(hb[4]) + 2, bSize(hb) * s - 4, bSize(hb) * s - 4);
    }
    g.restore();
  }
  if (boxSel.on && boxSel.moved) {
    const r = canvas.getBoundingClientRect();
    const dpr2 = window.devicePixelRatio || 1;
    const x0 = (Math.min(boxSel.sx, boxSel.ex) - r.left) * dpr2;
    const y0 = (Math.min(boxSel.sy, boxSel.ey) - r.top) * dpr2;
    const w0 = Math.abs(boxSel.ex - boxSel.sx) * dpr2;
    const h0 = Math.abs(boxSel.ey - boxSel.sy) * dpr2;
    g.save();
    g.fillStyle = 'rgba(155, 226, 138, 0.12)';
    g.strokeStyle = 'rgba(155, 226, 138, 0.9)';
    g.lineWidth = 1.5;
    g.fillRect(x0, y0, w0, h0);
    g.strokeRect(x0, y0, w0, h0);
    g.restore();
  }
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
      const rise = f.small ? 0.55 : 0.9;
      g.font = f.small ? `800 ${Math.round(Math.max(9, s * 0.22))}px system-ui, sans-serif` : `800 ${Math.round(Math.max(11, s * 0.34))}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = f.small ? 2.5 : 3;
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.strokeText(f.text!, X(f.x), Y(f.y - t * rise));
      g.fillText(f.text!, X(f.x), Y(f.y - t * rise));
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
  inspectKind: (kind: UnitKind) => {
    const u = cur?.snap.units.find((o) => UNIT_KIND_ORDER[o[1]] === kind);
    if (u) {
      inspect = u[0];
      selected = 0;
    }
    return !!u;
  },
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
  // partida nueva (no una reconexión a la misma): se olvida TODO lo de la anterior
  root.querySelector<HTMLElement>('#hk-endbtn')!.hidden = !isHostFlag;
  const fresh = !active || init?.gameId !== i.gameId || init?.hunterId !== i.hunterId || init.youAre !== i.youAre;
  init = i;
  active = true;
  root.querySelector<HTMLElement>('#hk-end')!.hidden = true;
  if (!fresh) return;
  prev = null;
  cur = null;
  placing = null;
  targeting = null;
  selected = 0;
  inspect = 0;
  useSlot = -1;
  shopOpen = false;
  disp.clear();
  anim.clear();
  corpses.length = 0;
  chopping.clear();
  local.on = false;
  steerSent = [0, 0];
  steerActive = [0, 0];
  incomeSec = -1;
  const modal = root.querySelector<HTMLElement>('#hk-modal');
  if (modal) modal.hidden = true;
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

// el anfitrión ve el botón de terminar la partida
let isHostFlag = false;
export function setHuntHost(host: boolean): void {
  isHostFlag = host;
  if (built) root.querySelector<HTMLElement>('#hk-endbtn')!.hidden = !host;
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
  const why = result.reason === 'ended' ? 'El anfitrión terminó la partida.' : result.reason === 'hunter_dead' ? 'El cazador ha caído.' : 'No queda ningún colono en pie.';
  const ended = result.reason === 'ended';
  const mm = Math.floor(result.seconds / 60);
  const ss = String(result.seconds % 60).padStart(2, '0');
  const formName: Record<string, string> = { hunter: 'Cazador', elf: 'Colono', angel: 'Ángel', wolf: 'Lobo', choosing: 'Caído', dead: 'Caído' };
  const end = root.querySelector<HTMLElement>('#hk-end')!;
  end.innerHTML = `<div class="hk-end-box ${result.winner}">
    <div class="hk-end-icon">${icon(result.winner === 'hunter' ? 'hk:troll' : 'hk:house')}</div>
    <h2>${ended ? 'Partida terminada' : won === null ? (result.winner === 'hunter' ? 'Gana el cazador' : 'Ganan los colonos') : won ? '¡Victoria!' : 'Derrota'}</h2>
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
