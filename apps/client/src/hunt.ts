// CACERÍA · cliente del modo asimétrico (prototipo). Pantalla propia: canvas a
// pantalla completa con la cámara pegada a tu personaje, niebla de guerra y un
// HUD distinto según seas cazador o colono. No comparte nada con el renderer de
// tower defense salvo la conexión (net) y algunos sprites.
//
// El servidor ya manda a cada uno SOLO lo que ve; aquí la niebla es dibujo.
import './hunt.css';
import {
  HUNT,
  HUNT_BUILDINGS,
  HUNT_BUILDING_ORDER,
  HUNT_ITEMS,
  HUNT_ITEM_ORDER,
  getHuntMap,
  huntItemCost,
  huntTowerDamage,
  huntTreasuryIncome,
  huntUpgradeCost,
  huntVitalityBonus,
  huntWeaponBonus,
  huntWorkerCost,
  huntWorkerPower,
  type HuntBuildingType,
  type HuntCommand,
  type HuntEvent,
  type HuntInit,
  type HuntItem,
  type HuntResult,
  type HuntSnap,
  type HuntSnapBuilding,
} from '@td/shared';
import { net } from './net.js';
import { sfx, unlockAudio } from './audio.js';

const TILE = 32; // px por celda en el mapa prerrenderizado
const map = getHuntMap();

let init: HuntInit | null = null;
let prev: { snap: HuntSnap; at: number } | null = null;
let cur: { snap: HuntSnap; at: number } | null = null;
let active = false;
let built = false;
let placing: HuntBuildingType | null = null;
let selected = 0; // id de edificio propio seleccionado
let zoom = 1;
const cam = { x: map.camp.x + 0.5, y: map.camp.y + 0.5 };
const mouse = { x: 0, y: 0, in: false };
let hudKey = '';
let panelKey = '';
// edificios que el cazador YA vio y ahora tiene fuera de vista (se pintan apagados)
const ghosts = new Map<number, HuntSnapBuilding>();

interface Fx {
  kind: 'shot' | 'text' | 'ring' | 'slash';
  x: number;
  y: number;
  tx?: number;
  ty?: number;
  text?: string;
  color: string;
  born: number;
  life: number;
}
let fx: Fx[] = [];

let root: HTMLElement;
let canvas: HTMLCanvasElement;
let g: CanvasRenderingContext2D;
let ground: HTMLCanvasElement | null = null;
let fog: HTMLCanvasElement | null = null;

const sprites: Record<string, HTMLImageElement> = {};
function sprite(name: string): HTMLImageElement | null {
  let im = sprites[name];
  if (!im) {
    im = new Image();
    im.src = `/sprites/${name}.png`;
    sprites[name] = im;
  }
  return im.complete && im.naturalWidth > 0 ? im : null;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const send = (cmd: HuntCommand): void => net.send({ type: 'hunt_cmd', cmd });
const fmt = (n: number): string => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n));
const myRole = (): 'hunter' | 'colonist' | null => init?.players.find((p) => p.id === init!.youAre)?.role ?? null;
const myIdx = (): number => init?.players.findIndex((p) => p.id === init!.youAre) ?? -1;
const amAlive = (): boolean => cur?.snap.players.find((p) => p.id === init?.youAre)?.alive === true;

function toast(text: string, bad = false): void {
  const box = root.querySelector('.hk-toasts')!;
  const el = document.createElement('div');
  el.className = `hk-toast${bad ? ' bad' : ''}`;
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => el.remove(), 2600);
  while (box.children.length > 4) box.firstChild?.remove();
}

// ---------- mapa prerrenderizado ----------

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
  const W = c.width;
  const H = c.height;
  // prado: un color base y manchas suaves grandes encima (nada de damero por casilla)
  k.fillStyle = '#16301f';
  k.fillRect(0, 0, W, H);
  for (let i = 0; i < 520; i++) {
    const x = hash(i, 7) * W;
    const y = hash(i, 13) * H;
    const r = 40 + hash(i, 29) * 150;
    const light = hash(i, 41) > 0.5;
    const grd = k.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, light ? 'rgba(74, 140, 74, 0.16)' : 'rgba(6, 22, 16, 0.22)');
    grd.addColorStop(1, 'rgba(0, 0, 0, 0)');
    k.fillStyle = grd;
    k.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // briznas sueltas
  for (let i = 0; i < 2600; i++) {
    const x = hash(i, 101) * W;
    const y = hash(i, 211) * H;
    k.fillStyle = hash(i, 307) > 0.5 ? 'rgba(150, 205, 110, 0.16)' : 'rgba(20, 50, 30, 0.35)';
    k.fillRect(x, y, 2, 4 + hash(i, 401) * 4);
  }
  // tierra pisada alrededor de la guarida
  {
    const gx = (map.camp.x + 0.5) * TILE;
    const gy = (map.camp.y + 0.5) * TILE;
    const grd = k.createRadialGradient(gx, gy, TILE, gx, gy, TILE * 6.5);
    grd.addColorStop(0, 'rgba(70, 34, 26, 0.95)');
    grd.addColorStop(0.6, 'rgba(58, 34, 24, 0.6)');
    grd.addColorStop(1, 'rgba(58, 34, 24, 0)');
    k.fillStyle = grd;
    k.fillRect(gx - TILE * 7, gy - TILE * 7, TILE * 14, TILE * 14);
  }
  // suelo de losa de las bases, con sombra interior de los muros
  for (const b of map.bases) {
    const x0 = (b.x + 1) * TILE;
    const y0 = (b.y + 1) * TILE;
    const w = (b.w - 2) * TILE;
    const h = (b.h - 2) * TILE;
    k.fillStyle = '#4a4338';
    k.fillRect(x0, y0, w, h);
    for (let y = b.y + 1; y < b.y + b.h - 1; y++) {
      for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
        const n = hash(x, y);
        k.fillStyle = `rgba(${n > 0.5 ? '255, 240, 210' : '0, 0, 0'}, ${0.03 + n * 0.05})`;
        k.fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
      }
    }
    const sh = k.createLinearGradient(0, y0, 0, y0 + TILE);
    sh.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
    sh.addColorStop(1, 'rgba(0, 0, 0, 0)');
    k.fillStyle = sh;
    k.fillRect(x0, y0, w, TILE);
    // el umbral de la entrada, del mismo material
    k.fillStyle = '#4a4338';
    k.fillRect(b.door.x * TILE, b.door.y * TILE, TILE, TILE);
  }
  // rocas y árboles
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x];
      const n = hash(x + 91, y + 17);
      const px = x * TILE;
      const py = y * TILE;
      if (t === 1) {
        k.fillStyle = '#20242c';
        k.fillRect(px, py, TILE, TILE);
        const top = k.createLinearGradient(0, py, 0, py + TILE);
        top.addColorStop(0, `hsl(218 12% ${44 + n * 8}%)`);
        top.addColorStop(1, `hsl(218 12% ${30 + n * 6}%)`);
        k.fillStyle = top;
        k.beginPath();
        k.roundRect(px + 1.5, py + 1, TILE - 3, TILE - 8, 7);
        k.fill();
        k.fillStyle = 'rgba(255, 255, 255, 0.10)';
        k.beginPath();
        k.roundRect(px + 5, py + 3.5, TILE - 14, 3, 2);
        k.fill();
      } else if (t === 2) {
        k.fillStyle = 'rgba(0, 0, 0, 0.28)';
        k.beginPath();
        k.ellipse(px + 16, py + 25, 12, 5, 0, 0, Math.PI * 2);
        k.fill();
        k.fillStyle = '#3d2c1c';
        k.fillRect(px + 14, py + 16, 4, 10);
        for (let i = 0; i < 3; i++) {
          k.fillStyle = `hsl(${138 + n * 20} 42% ${20 + i * 6 + n * 4}%)`;
          k.beginPath();
          k.arc(px + 16 + (i - 1) * 3 * (n - 0.5), py + 15 - i * 4, 11 - i * 2.5, 0, Math.PI * 2);
          k.fill();
        }
      }
    }
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
      <div class="hk-group" id="hk-left"></div>
      <div class="hk-group" id="hk-right"></div>
    </div>
    <div class="hk-roster" id="hk-roster"></div>
    <div class="hk-banner" id="hk-banner" hidden></div>
    <div class="hk-toasts"></div>
    <div class="hk-panel" id="hk-panel" hidden></div>
    <div class="hk-help" id="hk-help"></div>
    <div class="hk-bar" id="hk-bar"></div>
    <div class="hk-end" id="hk-end" hidden></div>`;
  canvas = root.querySelector('#hunt-canvas')!;
  g = canvas.getContext('2d')!;

  canvas.addEventListener('pointermove', (e) => {
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
    mouse.x = w.x;
    mouse.y = w.y;
    onClick(w.x, w.y, e.button === 2);
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom = Math.min(1.7, Math.max(0.45, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    },
    { passive: false },
  );
  window.addEventListener('keydown', onKey);
  root.querySelector('#hk-bar')!.addEventListener('click', onBarClick);
  root.querySelector('#hk-panel')!.addEventListener('click', onPanelClick);
  requestAnimationFrame(frame);
}

function cellPx(): number {
  return 40 * zoom * (window.devicePixelRatio || 1);
}

function toWorld(clientX: number, clientY: number): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const px = (clientX - r.left) * dpr;
  const py = (clientY - r.top) * dpr;
  const s = cellPx();
  return { x: cam.x + (px - canvas.width / 2) / s, y: cam.y + (py - canvas.height / 2) / s };
}

// ---------- entrada ----------

function myBuildings(): HuntSnapBuilding[] {
  const i = myIdx();
  return cur ? cur.snap.buildings.filter((b) => b[2] === i) : [];
}

function onClick(x: number, y: number, right: boolean): void {
  if (!cur || !init || cur.snap.over || !amAlive()) return;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const role = myRole();
  if (role === 'colonist') {
    if (right) {
      if (placing) placing = null;
      else send({ k: 'move', x, y });
      selected = 0;
      return;
    }
    if (placing) {
      send({ k: 'build', type: placing, cx, cy });
      // la torre se suele poner de varias en varias; el resto, de una en una
      if (placing !== 'tower') placing = null;
      return;
    }
    const mine = myBuildings().find((b) => b[3] === cx && b[4] === cy);
    if (mine) {
      selected = mine[0];
      return;
    }
    selected = 0;
    send({ k: 'move', x, y });
    return;
  }
  if (role === 'hunter') {
    const unit = cur.snap.units.find((u) => u[1] === 1 && Math.hypot(u[3] - x, u[4] - y) < 0.8);
    if (unit) {
      send({ k: 'attack', target: unit[0] });
      ring(unit[3], unit[4], '#ff5a4e');
      return;
    }
    const b = cur.snap.buildings.find((o) => o[3] === cx && o[4] === cy);
    if (b) {
      send({ k: 'attack', target: b[0] });
      ring(b[3] + 0.5, b[4] + 0.5, '#ff5a4e');
      return;
    }
    send({ k: 'move', x, y });
    ring(x, y, '#9be28a');
  }
}

function onKey(e: KeyboardEvent): void {
  if (!active || !cur || cur.snap.over || !amAlive()) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const k = e.key.toLowerCase();
  const role = myRole();
  if (k === 'escape') {
    placing = null;
    selected = 0;
    return;
  }
  if (role === 'colonist') {
    const def = HUNT_BUILDING_ORDER.find((t) => HUNT_BUILDINGS[t].hotkey === k);
    if (def) {
      placing = placing === def ? null : def;
      selected = 0;
    } else if (k === 'f' && mouse.in) send({ k: 'blink', x: mouse.x, y: mouse.y });
    else if (k === 'u' && selected) send({ k: 'upgrade', id: selected });
    else if (k === 'o') send({ k: 'worker' });
    else if (k === 's') send({ k: 'stop' });
  } else if (role === 'hunter') {
    if (k === 'q') send({ k: 'buy', item: 'weapon' });
    else if (k === 'w') send({ k: 'buy', item: 'vitality' });
    else if (k === 'e') send({ k: 'buy', item: 'boots' });
    else if (k === 'r') send({ k: 'reveal' });
    else if (k === 'b') send({ k: 'recall' });
    else if (k === 's') send({ k: 'stop' });
  }
}

function onBarClick(e: Event): void {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.hk-card');
  if (!card || !cur || cur.snap.over) return;
  unlockAudio();
  const a = card.dataset.a!;
  const v = card.dataset.v ?? '';
  if (a === 'place') {
    placing = placing === v ? null : (v as HuntBuildingType);
    selected = 0;
  } else if (a === 'buy') send({ k: 'buy', item: v as HuntItem });
  else if (a === 'reveal') send({ k: 'reveal' });
  else if (a === 'recall') send({ k: 'recall' });
  else if (a === 'blink') toast('Pulsa F con el cursor donde quieras saltar');
}

function onPanelClick(e: Event): void {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!btn || !selected) return;
  const a = btn.dataset.a;
  if (a === 'up') send({ k: 'upgrade', id: selected });
  else if (a === 'worker') send({ k: 'worker' });
  else if (a === 'raze') {
    send({ k: 'demolish', id: selected });
    selected = 0;
  }
}

// ---------- efectos ----------

function ring(x: number, y: number, color: string): void {
  fx.push({ kind: 'ring', x, y, color, born: performance.now(), life: 420 });
}
function floatText(x: number, y: number, text: string, color: string): void {
  fx.push({ kind: 'text', x, y, text, color, born: performance.now(), life: 900 });
}

function onEvents(events: HuntEvent[]): void {
  const now = performance.now();
  for (const ev of events) {
    switch (ev.e) {
      case 'hit':
        fx.push({ kind: 'slash', x: ev.x, y: ev.y, color: '#ffd9d4', born: now, life: 220 });
        if (ev.gold > 0 && myRole() !== 'colonist') floatText(ev.x, ev.y - 0.4, `+${ev.gold}`, '#ffcd45');
        else floatText(ev.x, ev.y - 0.4, `-${ev.dmg}`, '#ff8f86');
        sfx.shot(0);
        break;
      case 'shot':
        fx.push({ kind: 'shot', x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, color: '#ffe9a8', born: now, life: 160 });
        floatText(ev.tx, ev.ty - 0.9, `-${ev.dmg}`, '#ffe9a8');
        break;
      case 'built':
        ring(ev.x, ev.y, '#ffcd45');
        sfx.place(0);
        break;
      case 'upgraded':
        ring(ev.x, ev.y, '#ffcd45');
        floatText(ev.x, ev.y - 0.5, `nivel ${ev.level}`, '#ffcd45');
        sfx.upgrade(0);
        break;
      case 'destroyed':
        ring(ev.x, ev.y, '#ff5a4e');
        for (const [id, b] of ghosts) if (b[3] + 0.5 === ev.x && b[4] + 0.5 === ev.y) ghosts.delete(id);
        sfx.boom(0);
        break;
      case 'death':
        ring(ev.x, ev.y, '#ff5a4e');
        toast(
          ev.playerId === init?.youAre
            ? '☠ El cazador te alcanzó. Sigues mirando.'
            : `☠ ${ev.name} ha caído · quedan ${ev.left}`,
          true,
        );
        sfx.leak();
        break;
      case 'blink':
        ring(ev.x, ev.y, '#8fd3ff');
        ring(ev.tx, ev.ty, '#8fd3ff');
        break;
      case 'recall':
        ring(ev.x, ev.y, '#ff5a4e');
        break;
      case 'reveal':
        toast(myRole() === 'hunter' ? '👁 Rastreas todo el mapa' : '👁 ¡El cazador está rastreando el mapa!', myRole() !== 'hunter');
        break;
      case 'released':
        toast(myRole() === 'hunter' ? '🐾 ¡Estás libre! A cazar.' : '🐾 ¡El cazador anda suelto!', true);
        sfx.boss();
        break;
      case 'bought':
        toast(`${HUNT_ITEMS[ev.item].icon} ${HUNT_ITEMS[ev.item].name} nivel ${ev.tier}`);
        sfx.upgrade(0);
        break;
      case 'reject':
        toast(ev.reason, true);
        sfx.error();
        break;
    }
  }
}

// ---------- HUD ----------

function syncHud(): void {
  if (!cur || !init) return;
  const s = cur.snap;
  const role = myRole();
  const me = s.me;
  const alive = amAlive();
  const colonists = init.players.filter((p) => p.role === 'colonist');
  const left = colonists.filter((p) => s.players.find((q) => q.id === p.id)?.alive).length;
  const mine = myBuildings();
  const count = (t: HuntBuildingType) => mine.filter((b) => HUNT_BUILDING_ORDER[b[1]] === t).length;
  const myUnit = s.units.find((u) => u[2] === myIdx());

  const key = JSON.stringify([s.releaseIn, s.timeLeft, me, left, placing, s.over, alive, mine.length, myUnit ? [myUnit[5], myUnit[6]] : 0, s.players]);
  if (key === hudKey) return;
  hudKey = key;

  // --- arriba ---
  const mm = String(Math.floor(s.timeLeft / 60));
  const ss = String(s.timeLeft % 60).padStart(2, '0');
  let leftHtml = '';
  if (role === 'hunter') {
    leftHtml = `<span class="hk-chip role-hunter">🐾 Cazador</span>`;
    if (myUnit) {
      const frac = Math.max(0, myUnit[5] / myUnit[6]);
      leftHtml += `<span class="hk-chip hk-hp"><i style="transform:scaleX(${frac})"></i><span>❤ ${fmt(myUnit[5])} / ${fmt(myUnit[6])}</span></span>`;
    }
    if (me) leftHtml += `<span class="hk-chip gold">🪙 ${fmt(me.gold)}</span><span class="hk-chip">⚔ ${fmt(me.dmg)}<small>por golpe</small></span>`;
  } else if (role === 'colonist') {
    leftHtml = `<span class="hk-chip role-colonist">🏠 Colono${alive ? '' : ' · caído'}</span>`;
    if (me && alive) leftHtml += `<span class="hk-chip gold">🪙 ${fmt(me.gold)}<small>+${fmt(me.income)}/s</small></span>`;
  } else {
    leftHtml = `<span class="hk-chip">👁 Espectador</span>`;
  }
  root.querySelector('#hk-left')!.innerHTML = leftHtml;
  root.querySelector('#hk-right')!.innerHTML =
    `<span class="hk-chip">🏠 ${left} / ${colonists.length}</span><span class="hk-chip">⏳ ${mm}:${ss}</span>`;

  root.querySelector('#hk-roster')!.innerHTML = init.players
    .map((p) => {
      const sp = s.players.find((q) => q.id === p.id);
      const gold = sp && sp.gold >= 0 && p.id !== init!.youAre ? ` · 🪙${fmt(sp.gold)}` : '';
      return `<span class="${sp?.alive ? '' : 'dead'}"><i style="background:${p.color}"></i>${p.role === 'hunter' ? '🐾 ' : ''}${esc(p.name)}${p.id === init!.youAre ? ' (tú)' : ''}${gold}</span>`;
    })
    .join('');

  // --- cartel central ---
  const banner = root.querySelector<HTMLElement>('#hk-banner')!;
  if (s.releaseIn > 0) {
    banner.hidden = false;
    banner.className = 'hk-banner';
    banner.innerHTML =
      role === 'hunter'
        ? `<b>${s.releaseIn}</b><span>Estás retenido en tu guarida. Los colonos están escondiéndose.</span>`
        : `<b>${s.releaseIn}</b><span>El cazador sale en nada: corre a una base, cierra la entrada con una Muralla y levanta tu Tesorería.</span>`;
  } else if (me && me.channel > 0) {
    banner.hidden = false;
    banner.className = 'hk-banner calm';
    banner.innerHTML = `<b>Volviendo a la guarida… ${me.channel}</b><span>Cualquier orden lo cancela.</span>`;
  } else banner.hidden = true;

  // --- barra de abajo ---
  const bar = root.querySelector<HTMLElement>('#hk-bar')!;
  if (!alive || s.over || !me) {
    bar.hidden = true;
  } else if (role === 'colonist') {
    bar.hidden = false;
    bar.innerHTML =
      HUNT_BUILDING_ORDER.map((t) => {
        const d = HUNT_BUILDINGS[t];
        const n = count(t);
        const full = n >= d.limit;
        return `<button class="hk-card${placing === t ? ' on' : ''}${full ? ' off' : me.gold < d.cost ? ' poor' : ''}" data-a="place" data-v="${t}" title="${esc(d.desc)}">
          <span class="ky">${d.hotkey}</span><span class="nb">${n}/${d.limit}</span>
          <span class="ic">${d.icon}</span><span class="nm">${d.name}</span><span class="ct">${d.cost > 0 ? `🪙${d.cost}` : 'gratis'}</span></button>`;
      }).join('') +
      `<span class="hk-sep"></span>
       <button class="hk-card" data-a="blink" title="Salto: te teletransporta hasta ${HUNT.colonist.blinkRange} casillas, también a través de muros. Recarga ${HUNT.colonist.blinkCd} s.">
         <span class="ky">F</span><span class="ic">✨</span><span class="nm">Salto</span><span class="ct">${HUNT.colonist.blinkCd} s</span>
         ${me.blinkCd > 0 ? `<span class="cd">${me.blinkCd}</span>` : ''}</button>`;
  } else {
    bar.hidden = false;
    const keys: Record<HuntItem, string> = { weapon: 'Q', vitality: 'W', boots: 'E' };
    bar.innerHTML =
      HUNT_ITEM_ORDER.map((it) => {
        const d = HUNT_ITEMS[it];
        const tier = me[it];
        const cost = huntItemCost(it, tier);
        const next =
          it === 'weapon'
            ? `+${fmt(huntWeaponBonus(tier + 1))} daño`
            : it === 'vitality'
              ? `+${fmt(huntVitalityBonus(tier + 1))} vida`
              : `+${HUNT.hunter.bootsSpeed * (tier + 1)} vel.`;
        return `<button class="hk-card${cost <= 0 ? ' off' : me.gold < cost ? ' poor' : ''}" data-a="buy" data-v="${it}" title="${esc(d.desc)} Se compra en tu guarida.">
          <span class="ky">${keys[it]}</span><span class="nb">nv ${tier}</span>
          <span class="ic">${d.icon}</span><span class="nm">${cost > 0 ? next : d.name}</span><span class="ct">${cost > 0 ? `🪙${fmt(cost)}` : 'máx.'}</span></button>`;
      }).join('') +
      `<span class="hk-sep"></span>
       <button class="hk-card" data-a="reveal" title="Rastreo: ves el mapa entero ${HUNT.hunter.revealSec} s. Recarga ${HUNT.hunter.revealCd} s.">
         <span class="ky">R</span><span class="ic">👁</span><span class="nm">Rastreo</span><span class="ct">${HUNT.hunter.revealCd} s</span>
         ${me.revealCd > 0 ? `<span class="cd">${me.revealCd}</span>` : ''}</button>
       <button class="hk-card" data-a="recall" title="Regreso: tras ${HUNT.hunter.recallChannel} s quieto vuelves a tu guarida, donde te curas y compras.">
         <span class="ky">B</span><span class="ic">🏚</span><span class="nm">Regreso</span><span class="ct">${HUNT.hunter.recallCd} s</span>
         ${me.recallCd > 0 ? `<span class="cd">${me.recallCd}</span>` : ''}</button>`;
  }

  root.querySelector('#hk-help')!.innerHTML = !alive
    ? 'Has caído. Ves todo el mapa hasta que acabe la cacería.'
    : role === 'colonist'
      ? '<b>Clic</b> mover · <b>1-4</b> elegir edificio y clic para construir (cerca de ti) · clic en un edificio tuyo para <b>mejorarlo</b> · <b>F</b> salto al cursor · <b>rueda</b> zoom. Te matan de un golpe.'
      : role === 'hunter'
        ? '<b>Clic</b> en el suelo para moverte, en un edificio o colono para atacar · cobras el daño que haces · <b>Q W E</b> comprar en la guarida · <b>R</b> rastreo · <b>B</b> regreso · <b>rueda</b> zoom.'
        : '';
}

function syncPanel(): void {
  const panel = root.querySelector<HTMLElement>('#hk-panel')!;
  const b = selected && cur ? cur.snap.buildings.find((o) => o[0] === selected) : undefined;
  const me = cur?.snap.me;
  if (!b || !me || cur!.snap.over) {
    if (selected && cur && !b) selected = 0;
    panel.hidden = true;
    panelKey = '';
    return;
  }
  const key = JSON.stringify([b, me.gold, me.workers]);
  if (key === panelKey) return;
  panelKey = key;
  const type = HUNT_BUILDING_ORDER[b[1]];
  const def = HUNT_BUILDINGS[type];
  const level = b[5];
  const cost = huntUpgradeCost(type, level);
  const lines: string[] = [`Vida <b>${fmt(b[6])} / ${fmt(b[7])}</b>`];
  if (type === 'treasury') lines.push(`Da <b>${fmt(huntTreasuryIncome(level))}</b> de oro/s${cost > 0 ? ` → <b>${fmt(huntTreasuryIncome(level + 1))}</b>` : ''}`);
  if (type === 'tower') lines.push(`Daño <b>${fmt(huntTowerDamage(level))}</b>/s${cost > 0 ? ` → <b>${fmt(huntTowerDamage(level + 1))}</b>` : ''} · alcance ${HUNT.towerRange}`);
  if (type === 'wall' && cost > 0) lines.push('Mejorarla duplica su vida.');
  if (type === 'workshop') {
    lines.push(`Obreros <b>${me.workers} / ${HUNT.workerMax}</b> · cada uno repara <b>${huntWorkerPower(level)}</b> de vida/s`);
  }
  const wcost = huntWorkerCost(me.workers);
  panel.innerHTML = `
    <h3>${def.icon} ${def.name}<em>nivel ${level}</em></h3>
    ${lines.map((l) => `<p>${l}</p>`).join('')}
    ${type === 'workshop' && me.workers < HUNT.workerMax ? `<div class="row"><button class="hk-btn${me.gold < wcost ? ' poor' : ''}" data-a="worker">Contratar obrero · 🪙${fmt(wcost)} <small>[O]</small></button></div>` : ''}
    <div class="row">
      ${cost > 0 ? `<button class="hk-btn primary${me.gold < cost ? ' poor' : ''}" data-a="up">Mejorar · 🪙${fmt(cost)} <small>[U]</small></button>` : '<button class="hk-btn" disabled>Nivel máximo</button>'}
      <button class="hk-btn danger" data-a="raze" title="Derribar (no devuelve oro)">✕</button>
    </div>`;
  panel.hidden = false;
}

// ---------- dibujo ----------

function lerpUnits(now: number): Map<number, { x: number; y: number }> {
  const out = new Map<number, { x: number; y: number }>();
  if (!cur) return out;
  const t = prev ? Math.min(1, (now - cur.at) / Math.max(30, cur.at - prev.at)) : 1;
  const old = new Map(prev ? prev.snap.units.map((u) => [u[0], u] as const) : []);
  for (const u of cur.snap.units) {
    const o = old.get(u[0]);
    // un salto (teletransporte) no se interpola: aparecería deslizándose por el mapa
    if (o && Math.hypot(o[3] - u[3], o[4] - u[4]) < 2) out.set(u[0], { x: o[3] + (u[3] - o[3]) * t, y: o[4] + (u[4] - o[4]) * t });
    else out.set(u[0], { x: u[3], y: u[4] });
  }
  return out;
}

function hpBar(x: number, y: number, w: number, frac: number, color: string): void {
  const s = cellPx();
  g.fillStyle = 'rgba(0, 0, 0, 0.65)';
  g.fillRect(x - (w * s) / 2, y, w * s, s * 0.11);
  g.fillStyle = color;
  g.fillRect(x - (w * s) / 2, y, w * s * Math.max(0, Math.min(1, frac)), s * 0.11);
}

function drawBuilding(b: HuntSnapBuilding, sx: number, sy: number, ghost: boolean): void {
  const s = cellPx();
  const type = HUNT_BUILDING_ORDER[b[1]];
  const color = init?.players[b[2]]?.color ?? '#fff';
  const cx = sx + s / 2;
  const cy = sy + s / 2;
  g.save();
  if (ghost) g.globalAlpha = 0.4;
  // peana del color del dueño
  g.fillStyle = 'rgba(0, 0, 0, 0.35)';
  g.beginPath();
  g.ellipse(cx, sy + s * 0.86, s * 0.44, s * 0.16, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.5, s * 0.05);
  g.stroke();
  if (type === 'wall') {
    const grd = g.createLinearGradient(0, sy, 0, sy + s);
    grd.addColorStop(0, '#9aa3b2');
    grd.addColorStop(1, '#565d6b');
    g.fillStyle = grd;
    g.beginPath();
    g.roundRect(sx + s * 0.06, sy + s * 0.14, s * 0.88, s * 0.74, s * 0.08);
    g.fill();
    g.fillStyle = '#aab3c2';
    for (let i = 0; i < 3; i++) g.fillRect(sx + s * (0.08 + i * 0.31), sy + s * 0.04, s * 0.22, s * 0.16);
    g.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    g.lineWidth = 1;
    g.strokeRect(sx + s * 0.06, sy + s * 0.5, s * 0.88, 0.5);
    g.strokeRect(sx + s * 0.5, sy + s * 0.14, 0.5, s * 0.36);
  } else if (type === 'treasury') {
    const grd = g.createRadialGradient(cx, cy, s * 0.05, cx, cy, s * 0.5);
    grd.addColorStop(0, 'rgba(255, 205, 69, 0.55)');
    grd.addColorStop(1, 'rgba(255, 205, 69, 0)');
    g.fillStyle = grd;
    g.fillRect(sx - s * 0.2, sy - s * 0.2, s * 1.4, s * 1.4);
    g.fillStyle = '#7a4f1d';
    g.beginPath();
    g.roundRect(sx + s * 0.14, sy + s * 0.4, s * 0.72, s * 0.44, s * 0.06);
    g.fill();
    g.fillStyle = '#c8922e';
    g.beginPath();
    g.roundRect(sx + s * 0.14, sy + s * 0.22, s * 0.72, s * 0.26, [s * 0.2, s * 0.2, 0, 0]);
    g.fill();
    g.fillStyle = '#ffe28a';
    g.fillRect(cx - s * 0.06, sy + s * 0.4, s * 0.12, s * 0.16);
  } else if (type === 'workshop') {
    g.fillStyle = '#6b4a2b';
    g.fillRect(sx + s * 0.14, sy + s * 0.42, s * 0.72, s * 0.42);
    g.fillStyle = '#a8442f';
    g.beginPath();
    g.moveTo(sx + s * 0.06, sy + s * 0.46);
    g.lineTo(cx, sy + s * 0.1);
    g.lineTo(sx + s * 0.94, sy + s * 0.46);
    g.closePath();
    g.fill();
    g.fillStyle = '#2a1c10';
    g.fillRect(cx - s * 0.09, sy + s * 0.58, s * 0.18, s * 0.26);
  } else {
    const lvl = b[5];
    const im = sprite(lvl >= 8 ? 'tower_archer_l3' : lvl >= 4 ? 'tower_archer_l2' : 'tower_archer_l1');
    if (im) {
      const h = s * (lvl >= 8 ? 1.55 : lvl >= 4 ? 1.2 : 1.05);
      const w = (h * im.naturalWidth) / im.naturalHeight;
      g.drawImage(im, cx - w / 2, sy + s * 0.92 - h, w, h);
    } else {
      g.fillStyle = '#8a6a3a';
      g.fillRect(sx + s * 0.25, sy + s * 0.1, s * 0.5, s * 0.78);
    }
  }
  // nivel
  g.font = `700 ${Math.round(s * 0.26)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0, 0, 0, 0.7)';
  g.beginPath();
  g.arc(sx + s * 0.84, sy + s * 0.2, s * 0.17, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.fillText(String(b[5]), sx + s * 0.84, sy + s * 0.21);
  if (b[6] < b[7] && !ghost) hpBar(cx, sy - s * 0.06, 0.9, b[6] / b[7], b[6] / b[7] > 0.4 ? '#7bd88f' : '#ff5a4e');
  if (b[0] === selected) {
    g.strokeStyle = '#ffcd45';
    g.lineWidth = 2;
    g.strokeRect(sx + 1, sy + 1, s - 2, s - 2);
  }
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
  if (cw === 0 || ch === 0) return;
  if (!ground) ground = drawGround();
  const snap = cur.snap;
  const pos = lerpUnits(now);
  const mine = snap.units.find((u) => u[2] === myIdx());
  const role = myRole();

  // cámara: pegada a tu personaje; si no tienes (caíste o miras), el mapa entero
  if (mine && amAlive()) {
    const p = pos.get(mine[0])!;
    cam.x += (p.x - cam.x) * 0.18;
    cam.y += (p.y - cam.y) * 0.18;
  } else {
    cam.x += (map.w / 2 - cam.x) * 0.1;
    cam.y += (map.h / 2 - cam.y) * 0.1;
    zoom += (Math.min(cw / (map.w * 40 * dpr), ch / (map.h * 40 * dpr)) * 0.96 - zoom) * 0.1;
  }
  const s = cellPx();
  const ox = cw / 2 - cam.x * s;
  const oy = ch / 2 - cam.y * s;
  const X = (wx: number) => ox + wx * s;
  const Y = (wy: number) => oy + wy * s;

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#05070c';
  g.fillRect(0, 0, cw, ch);
  g.imageSmoothingEnabled = true;
  g.drawImage(ground, ox, oy, map.w * s, map.h * s);

  // guarida del cazador
  {
    const gx = X(map.camp.x + 0.5);
    const gy = Y(map.camp.y + 0.5);
    const pulse = 0.6 + Math.sin(now / 500) * 0.15;
    const grd = g.createRadialGradient(gx, gy, s * 0.2, gx, gy, s * HUNT.hunter.campRadius);
    grd.addColorStop(0, `rgba(255, 70, 50, ${0.28 * pulse})`);
    grd.addColorStop(1, 'rgba(255, 70, 50, 0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(gx, gy, s * HUNT.hunter.campRadius, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1a1210';
    g.beginPath();
    g.moveTo(gx - s * 0.7, gy + s * 0.5);
    g.lineTo(gx, gy - s * 0.9);
    g.lineTo(gx + s * 0.7, gy + s * 0.5);
    g.closePath();
    g.fill();
    g.fillStyle = `rgba(255, 110, 60, ${pulse})`;
    g.beginPath();
    g.arc(gx, gy + s * 0.2, s * 0.16, 0, Math.PI * 2);
    g.fill();
  }

  // edificios (los recordados por el cazador, apagados)
  const visibleIds = new Set(snap.buildings.map((b) => b[0]));
  if (role === 'hunter') {
    for (const b of snap.buildings) ghosts.set(b[0], b);
    for (const [id, b] of ghosts) {
      if (visibleIds.has(id)) continue;
      // si ahora veo esa casilla y ya no está, es que lo derribaron
      const seen = snap.reveal || snap.vision.some(([vx, vy, r]) => Math.hypot(vx - b[3] - 0.5, vy - b[4] - 0.5) <= r - 0.5);
      if (seen) ghosts.delete(id);
      else drawBuilding(b, X(b[3]), Y(b[4]), true);
    }
  }
  const drawables: { y: number; draw: () => void }[] = [];
  for (const b of snap.buildings) drawables.push({ y: b[4] + 0.9, draw: () => drawBuilding(b, X(b[3]), Y(b[4]), false) });

  // unidades
  for (const u of snap.units) {
    const p = pos.get(u[0])!;
    const pl = init.players[u[2]];
    const old = prev?.snap.units.find((o) => o[0] === u[0]);
    const moving = !!old && Math.hypot(old[3] - u[3], old[4] - u[4]) > 0.01;
    const dirX = old ? u[3] - old[3] : 0;
    drawables.push({
      y: p.y,
      draw: () => {
        const x = X(p.x);
        const y = Y(p.y);
        g.fillStyle = 'rgba(0, 0, 0, 0.4)';
        if (u[1] === 0) {
          g.beginPath();
          g.ellipse(x, y + s * 0.35, s * 0.75, s * 0.24, 0, 0, Math.PI * 2);
          g.fill();
          const im = sprite(`boss_behemoth_f${moving ? Math.floor(now / 110) % 6 : 0}`);
          const h = s * 2.1;
          if (im) {
            const w = (h * im.naturalWidth) / im.naturalHeight;
            g.save();
            g.translate(x, y + s * 0.5);
            if (dirX > 0.001) g.scale(-1, 1);
            g.drawImage(im, -w / 2, -h, w, h);
            g.restore();
          } else {
            g.fillStyle = '#7a1f1a';
            g.beginPath();
            g.arc(x, y, s * 0.6, 0, Math.PI * 2);
            g.fill();
          }
          hpBar(x, y - s * 1.75, 1.5, u[5] / u[6], '#ff5a4e');
        } else {
          g.beginPath();
          g.ellipse(x, y + s * 0.36, s * 0.32, s * 0.12, 0, 0, Math.PI * 2);
          g.fill();
          const bob = moving ? Math.sin(now / 90) * s * 0.05 : 0;
          const col = pl?.color ?? '#fff';
          // capa
          const cape = g.createLinearGradient(0, y - s * 0.5, 0, y + s * 0.4);
          cape.addColorStop(0, col);
          cape.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
          g.fillStyle = col;
          g.beginPath();
          g.moveTo(x - s * 0.32, y + s * 0.36 + bob);
          g.quadraticCurveTo(x - s * 0.1, y - s * 0.5 + bob, x, y - s * 0.52 + bob);
          g.quadraticCurveTo(x + s * 0.1, y - s * 0.5 + bob, x + s * 0.32, y + s * 0.36 + bob);
          g.closePath();
          g.fill();
          g.fillStyle = cape;
          g.globalAlpha = 0.55;
          g.fill();
          g.globalAlpha = 1;
          g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
          g.lineWidth = Math.max(1, s * 0.03);
          g.stroke();
          // cara bajo la capucha
          g.fillStyle = '#f3d9b8';
          g.beginPath();
          g.arc(x, y - s * 0.22 + bob, s * 0.15, 0, Math.PI * 2);
          g.fill();
          g.stroke();
          g.fillStyle = col;
          g.beginPath();
          g.arc(x, y - s * 0.27 + bob, s * 0.17, Math.PI, 0);
          g.fill();
        }
        g.font = `600 ${Math.round(Math.max(10, s * 0.26))}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        const label = pl?.name ?? '';
        const ly = u[1] === 0 ? y - s * 1.82 : y - s * 0.66;
        g.strokeText(label, x, ly);
        g.fillStyle = u[1] === 0 ? '#ffb4ad' : '#fff';
        g.fillText(label, x, ly);
      },
    });
  }
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  // alcance de las torres propias seleccionadas / fantasma de colocación
  if (role === 'colonist' && amAlive() && mine) {
    const p = pos.get(mine[0])!;
    if (placing && mouse.in) {
      const cx = Math.floor(mouse.x);
      const cy = Math.floor(mouse.y);
      const far = Math.hypot(cx + 0.5 - p.x, cy + 0.5 - p.y) > HUNT.colonist.buildRange;
      const blocked = map.tiles[cy * map.w + cx] !== 0 || snap.buildings.some((b) => b[3] === cx && b[4] === cy);
      g.strokeStyle = 'rgba(255, 205, 69, 0.35)';
      g.setLineDash([6, 6]);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(X(p.x), Y(p.y), HUNT.colonist.buildRange * s, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = far || blocked ? 'rgba(255, 90, 78, 0.4)' : 'rgba(123, 216, 143, 0.4)';
      g.fillRect(X(cx), Y(cy), s, s);
      if (placing === 'tower') {
        g.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        g.beginPath();
        g.arc(X(cx + 0.5), Y(cy + 0.5), HUNT.towerRange * s, 0, Math.PI * 2);
        g.stroke();
      }
    }
    const sel = selected ? snap.buildings.find((b) => b[0] === selected) : undefined;
    if (sel && HUNT_BUILDING_ORDER[sel[1]] === 'tower') {
      g.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(X(sel[3] + 0.5), Y(sel[4] + 0.5), HUNT.towerRange * s, 0, Math.PI * 2);
      g.stroke();
    }
  }
  // destino de tu orden
  if (snap.me?.dest && amAlive()) {
    const [dx, dy] = snap.me.dest;
    g.strokeStyle = 'rgba(155, 226, 138, 0.7)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(X(dx + 0.5), Y(dy + 0.5), s * 0.18, 0, Math.PI * 2);
    g.stroke();
  }

  // efectos
  fx = fx.filter((f) => now - f.born < f.life);
  for (const f of fx) {
    const t = (now - f.born) / f.life;
    g.globalAlpha = 1 - t;
    if (f.kind === 'ring') {
      g.strokeStyle = f.color;
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(X(f.x), Y(f.y), s * (0.2 + t * 0.7), 0, Math.PI * 2);
      g.stroke();
    } else if (f.kind === 'shot') {
      g.strokeStyle = f.color;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(X(f.x + (f.tx! - f.x) * Math.max(0, t - 0.4)), Y(f.y - 0.5 + (f.ty! - f.y + 0.5) * Math.max(0, t - 0.4)));
      g.lineTo(X(f.x + (f.tx! - f.x) * Math.min(1, t + 0.4)), Y(f.y - 0.5 + (f.ty! - f.y + 0.5) * Math.min(1, t + 0.4)));
      g.stroke();
    } else if (f.kind === 'slash') {
      g.strokeStyle = f.color;
      g.lineWidth = s * 0.09;
      g.beginPath();
      g.arc(X(f.x), Y(f.y), s * 0.55, -0.9 + t * 1.6, 0.3 + t * 1.6);
      g.stroke();
    } else {
      g.font = `700 ${Math.round(Math.max(11, s * 0.34))}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      g.strokeText(f.text!, X(f.x), Y(f.y - t * 0.8));
      g.fillStyle = f.color;
      g.fillText(f.text!, X(f.x), Y(f.y - t * 0.8));
    }
  }
  g.globalAlpha = 1;

  // niebla: oscuridad con agujeros de luz donde tienes visión
  if (!snap.reveal) {
    if (!fog) fog = document.createElement('canvas');
    const fw = Math.ceil(cw / 3);
    const fh = Math.ceil(ch / 3);
    if (fog.width !== fw || fog.height !== fh) {
      fog.width = fw;
      fog.height = fh;
    }
    const f = fog.getContext('2d')!;
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, fw, fh);
    f.fillStyle = 'rgba(5, 9, 22, 0.8)';
    f.fillRect(0, 0, fw, fh);
    f.globalCompositeOperation = 'destination-out';
    for (const [vx, vy, r] of snap.vision) {
      // tu propia luz sigue a tu personaje interpolado, para que no dé tirones
      const own = mine && Math.hypot(vx - mine[3], vy - mine[4]) < 0.01 ? pos.get(mine[0])! : { x: vx, y: vy };
      const px = X(own.x) / 3;
      const py = Y(own.y) / 3;
      const rr = (r * s) / 3;
      const grd = f.createRadialGradient(px, py, rr * 0.45, px, py, rr);
      grd.addColorStop(0, 'rgba(0, 0, 0, 1)');
      grd.addColorStop(1, 'rgba(0, 0, 0, 0)');
      f.fillStyle = grd;
      f.beginPath();
      f.arc(px, py, rr, 0, Math.PI * 2);
      f.fill();
    }
    g.drawImage(fog, 0, 0, cw, ch);
  }

  syncHud();
  syncPanel();
}

// ---------- ciclo de vida (lo llama main.ts) ----------

export function isHuntActive(): boolean {
  return active;
}

export function startHunt(i: HuntInit): void {
  build();
  const fresh = !active || init?.hunterId !== i.hunterId || init.youAre !== i.youAre;
  init = i;
  active = true;
  root.querySelector<HTMLElement>('#hk-end')!.hidden = true;
  if (!fresh) return; // reconexión a la misma cacería: no reiniciar nada
  prev = null;
  cur = null;
  placing = null;
  selected = 0;
  zoom = 1;
  fx = [];
  ghosts.clear();
  hudKey = '';
  panelKey = '';
  cam.x = map.camp.x + 0.5;
  cam.y = map.camp.y + 0.5;
  const me = i.players.find((p) => p.id === i.youAre);
  toast(
    me?.role === 'hunter'
      ? '🐾 Te ha tocado ser el CAZADOR'
      : me
        ? '🏠 Eres COLONO: corre a una base y enciérrate'
        : '👁 Estás mirando la cacería',
  );
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
  const me = result.players.find((p) => p.id === init!.youAre);
  const won = me ? me.role === result.winner : null;
  const why =
    result.reason === 'hunter_dead'
      ? 'Las torres acabaron con el cazador.'
      : result.reason === 'all_dead'
        ? 'El cazador no dejó a ningún colono en pie.'
        : 'Los colonos aguantaron hasta el amanecer.';
  const mm = Math.floor(result.seconds / 60);
  const ss = String(result.seconds % 60).padStart(2, '0');
  const end = root.querySelector<HTMLElement>('#hk-end')!;
  end.innerHTML = `<div>
    <h2>${won === null ? (result.winner === 'hunter' ? '🐾 Gana el cazador' : '🏠 Ganan los colonos') : won ? '🏆 ¡Victoria!' : '💀 Derrota'}</h2>
    <p>${why} Duró ${mm}:${ss}.</p>
    <table>
      <thead><tr><th>Jugador</th><th>Papel</th><th>Oro ganado</th><th>Daño</th><th>Edificios</th></tr></thead>
      <tbody>${result.players
        .map(
          (p) => `<tr class="${p.id === init!.youAre ? 'me' : ''}">
            <td><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></i>${esc(p.name)}</td>
            <td>${p.role === 'hunter' ? '🐾 Cazador' : p.alive ? '🏠 Colono' : '☠ Colono'}</td>
            <td>${fmt(p.goldEarned)}</td><td>${fmt(p.damage)}</td><td>${p.role === 'hunter' ? '—' : p.built}</td></tr>`,
        )
        .join('')}</tbody>
    </table>
    <button class="hk-btn primary" id="hk-back" style="width:100%;padding:10px">Volver a la sala</button>
  </div>`;
  end.hidden = false;
  if (won === false) sfx.defeat();
  else sfx.victory();
  end.querySelector('#hk-back')!.addEventListener('click', () => {
    active = false;
    backToLobby();
  });
}

// La sala volvió al lobby sin que llegara el final (p. ej. el servidor se reinició).
export function abandonHunt(): void {
  active = false;
}
