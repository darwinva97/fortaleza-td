// CACERÍA · el mapa: un laberinto de PARCELAS amuralladas alrededor de la guarida.
//
// Copia la estructura que se mide en la arena grande del original (no su dibujo):
//   · decenas de recintos cerrados por roca, de 8×8 a 12×12 casillas por dentro y
//     algunos dobles mucho mayores, con puertas de 1 o 2 casillas;
//   · cada recinto forrado POR DENTRO con una fila de árboles pegada al muro (ahí
//     trabajan los leñadores); en los pasillos casi no hay árboles;
//   · una plaza central no edificable con la guarida del cazador.
// Es determinista (semilla fija): el cliente lo genera igual que el servidor y no
// hace falta enviarlo por la red.
import { rand } from '../rng.js';

export const TILE_FLOOR = 0;
export const TILE_ROCK = 1;
export const TILE_TREE = 2;

export interface HuntPlot {
  id: number;
  x: number; // rectángulo exterior (incluye el muro)
  y: number;
  w: number;
  h: number;
  doors: { x: number; y: number }[];
  shape: 'rect' | 'L' | 'twin';
  area: number; // casillas libres por dentro
  gaps: { x: number; y: number }[]; // huecos del tabique interior (parcela doble)
  cut: { x: number; y: number; w: number; h: number } | null; // esquina recortada (L)
}

export interface HuntMap {
  w: number;
  h: number;
  tiles: Uint8Array;
  noBuild: Uint8Array;
  plotOf: Int16Array; // índice de parcela de cada casilla interior (−1 fuera)
  plots: HuntPlot[];
  camp: { x: number; y: number }; // casilla de la guarida
  plaza: { x: number; y: number; w: number; h: number };
  angelSpawn: { x: number; y: number };
  trees: number[]; // índices de casilla con árbol
}

const W = 100;
const H = 100;
const MACRO = 6;

let cached: HuntMap | null = null;

export function getHuntMap(): HuntMap {
  if (cached) return cached;
  const st = { rng: 0x5eedca7 };
  const R = () => rand(st);
  const ri = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));
  const tiles = new Uint8Array(W * H);
  const noBuild = new Uint8Array(W * H);
  const plotOf = new Int16Array(W * H).fill(-1);
  const idx = (x: number, y: number) => y * W + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const set = (x: number, y: number, v: number) => {
    if (inside(x, y)) tiles[idx(x, y)] = v;
  };
  const get = (x: number, y: number) => (inside(x, y) ? tiles[idx(x, y)] : TILE_ROCK);

  // borde
  for (let x = 0; x < W; x++)
    for (const y of [0, 1, H - 2, H - 1]) set(x, y, TILE_ROCK);
  for (let y = 0; y < H; y++)
    for (const x of [0, 1, W - 2, W - 1]) set(x, y, TILE_ROCK);

  const S = Math.floor((W - 4) / MACRO); // 16
  const ox = 2;
  const oy = 2;
  const center = (cx: number, cy: number) => (cx === 2 || cx === 3) && (cy === 2 || cy === 3);

  // regiones: casillas macro, algunas fusionadas con la vecina para parcelas grandes
  const used = new Set<string>();
  const regions: { x: number; y: number; w: number; h: number }[] = [];
  for (let my = 0; my < MACRO; my++) {
    for (let mx = 0; mx < MACRO; mx++) {
      if (center(mx, my) || used.has(`${mx},${my}`)) continue;
      used.add(`${mx},${my}`);
      let w = 1;
      let h = 1;
      const r = R();
      if (r < 0.16 && mx + 1 < MACRO && !center(mx + 1, my) && !used.has(`${mx + 1},${my}`)) {
        w = 2;
        used.add(`${mx + 1},${my}`);
      } else if (r < 0.28 && my + 1 < MACRO && !center(mx, my + 1) && !used.has(`${mx},${my + 1}`)) {
        h = 2;
        used.add(`${mx},${my + 1}`);
      }
      regions.push({ x: ox + mx * S, y: oy + my * S, w: w * S, h: h * S });
    }
  }

  const plots: HuntPlot[] = [];
  const midX = W / 2;
  const midY = H / 2;
  for (const reg of regions) {
    // márgenes de 1 a 3 casillas: entre parcela y parcela queda un pasillo de 2-6
    const ml = ri(1, 3);
    const mr = ri(1, 3);
    const mt = ri(1, 3);
    const mb = ri(1, 3);
    const x = reg.x + ml;
    const y = reg.y + mt;
    const w = Math.max(9, reg.w - ml - mr);
    const h = Math.max(9, reg.h - mt - mb);
    const big = reg.w > S || reg.h > S;
    const shapeRoll = R();
    const shape: HuntPlot['shape'] = big && shapeRoll < 0.6 ? 'twin' : !big && shapeRoll < 0.3 ? 'L' : 'rect';
    // muro perimetral
    for (let i = x; i < x + w; i++) {
      set(i, y, TILE_ROCK);
      set(i, y + h - 1, TILE_ROCK);
    }
    for (let j = y; j < y + h; j++) {
      set(x, j, TILE_ROCK);
      set(x + w - 1, j, TILE_ROCK);
    }
    // forma en L: se recorta una esquina (lejos del centro del mapa) con muro
    let cut: { x: number; y: number; w: number; h: number } | null = null;
    if (shape === 'L') {
      const cw = ri(Math.floor(w / 3), Math.floor(w / 2));
      const chh = ri(Math.floor(h / 3), Math.floor(h / 2));
      const right = x + w / 2 < midX ? false : true;
      const bottom = y + h / 2 < midY ? false : true;
      // la esquina recortada es la que mira AFUERA del mapa
      const cx0 = right ? x + w - cw : x;
      const cy0 = bottom ? y + h - chh : y;
      cut = { x: cx0, y: cy0, w: cw, h: chh };
      for (let j = cy0; j < cy0 + chh; j++)
        for (let i = cx0; i < cx0 + cw; i++) set(i, j, TILE_FLOOR);
      // muro del recorte
      const ix = right ? cx0 - 1 : cx0 + cw;
      const iy = bottom ? cy0 - 1 : cy0 + chh;
      for (let j = cy0; j < cy0 + chh; j++) set(ix, j, TILE_ROCK);
      for (let i = cx0; i < cx0 + cw; i++) set(i, iy, TILE_ROCK);
      set(ix, iy, TILE_ROCK);
      // vuelve a cerrar las esquinas exteriores que el recorte dejó abiertas
      for (let i = x; i < x + w; i++) {
        if (!(i >= cx0 && i < cx0 + cw)) {
          set(i, y, TILE_ROCK);
          set(i, y + h - 1, TILE_ROCK);
        }
      }
      for (let j = y; j < y + h; j++) {
        if (!(j >= cy0 && j < cy0 + chh)) {
          set(x, j, TILE_ROCK);
          set(x + w - 1, j, TILE_ROCK);
        }
      }
    }
    // parcela doble: un tabique interior con un hueco de 2 casillas
    const gaps: { x: number; y: number }[] = [];
    if (shape === 'twin') {
      if (w >= h) {
        const sx = x + Math.floor(w / 2) + ri(-2, 2);
        const gap = ri(y + 3, y + h - 5);
        for (let j = y; j < y + h; j++) {
          if (j !== gap && j !== gap + 1) set(sx, j, TILE_ROCK);
          else gaps.push({ x: sx, y: j });
        }
      } else {
        const sy = y + Math.floor(h / 2) + ri(-2, 2);
        const gap = ri(x + 3, x + w - 5);
        for (let i = x; i < x + w; i++) {
          if (i !== gap && i !== gap + 1) set(i, sy, TILE_ROCK);
          else gaps.push({ x: i, y: sy });
        }
      }
      // el tabique no toca el muro exterior en el hueco: vuelve a cerrar el borde
      for (let i = x; i < x + w; i++) {
        set(i, y, TILE_ROCK);
        set(i, y + h - 1, TILE_ROCK);
      }
      for (let j = y; j < y + h; j++) {
        set(x, j, TILE_ROCK);
        set(x + w - 1, j, TILE_ROCK);
      }
    }
    // puertas: 1 o 2, de 1 o 2 casillas, nunca en una esquina
    const doors: { x: number; y: number }[] = [];
    const nDoors = big ? 2 : R() < 0.3 ? 2 : 1;
    const sides = ['n', 's', 'w', 'e'];
    // la primera puerta mira hacia el centro del mapa más a menudo
    const toward =
      Math.abs(x + w / 2 - midX) > Math.abs(y + h / 2 - midY) ? (x + w / 2 < midX ? 'e' : 'w') : y + h / 2 < midY ? 's' : 'n';
    const chosen = new Set<string>();
    for (let d = 0; d < nDoors; d++) {
      const first = d === 0 && R() < 0.65 ? toward : sides[ri(0, 3)];
      const width = R() < 0.5 ? 1 : 2;
      // prueba el lado elegido y, si no cabe una puerta, los demás
      const order = [first, ...sides.filter((q) => q !== first)].filter((q) => !chosen.has(q));
      let placed = false;
      for (const side of order) {
        if (placed) break;
      for (let attempt = 0; attempt < 16 && !placed; attempt++) {
        let dx: number;
        let dy: number;
        if (side === 'n' || side === 's') {
          dx = ri(x + 2, x + w - 3 - width);
          dy = side === 'n' ? y : y + h - 1;
        } else {
          dx = side === 'w' ? x : x + w - 1;
          dy = ri(y + 2, y + h - 3 - width);
        }
        // la puerta tiene que dar a suelo por fuera y por dentro (no al recorte de la L)
        const horiz = side === 'n' || side === 's';
        const ok = Array.from({ length: width }, (_, i) => {
          const cx = horiz ? dx + i : dx;
          const cy = horiz ? dy : dy + i;
          const inX = horiz ? cx : side === 'w' ? cx + 1 : cx - 1;
          const inY = horiz ? (side === 'n' ? cy + 1 : cy - 1) : cy;
          const outX = horiz ? cx : side === 'w' ? cx - 1 : cx + 1;
          const outY = horiz ? (side === 'n' ? cy - 1 : cy + 1) : cy;
          return get(cx, cy) === TILE_ROCK && get(inX, inY) === TILE_FLOOR && get(outX, outY) === TILE_FLOOR;
        }).every(Boolean);
        if (!ok) continue;
        for (let i = 0; i < width; i++) {
          const cx = horiz ? dx + i : dx;
          const cy = horiz ? dy : dy + i;
          set(cx, cy, TILE_FLOOR);
          doors.push({ x: cx, y: cy });
        }
        placed = true;
        chosen.add(side);
      }
      }
    }
    plots.push({ id: plots.length, x, y, w, h, doors, shape, area: 0, gaps, cut });
  }

  // plaza central con la guarida
  const camp = { x: Math.floor(W / 2), y: Math.floor(H / 2) };
  const plaza = { x: camp.x - 6, y: camp.y - 6, w: 13, h: 13 };
  for (let j = plaza.y; j < plaza.y + plaza.h; j++)
    for (let i = plaza.x; i < plaza.x + plaza.w; i++) {
      set(i, j, TILE_FLOOR);
      noBuild[idx(i, j)] = 1;
    }

  // interior de cada parcela (relleno desde dentro, sin cruzar muros ni puertas)
  for (const p of plots) {
    const seen = new Set<number>();
    let seed = -1;
    for (let j = p.y + 1; j < p.y + p.h - 1 && seed < 0; j++)
      for (let i = p.x + 1; i < p.x + p.w - 1 && seed < 0; i++) {
        const inCut = p.cut && i >= p.cut.x - 1 && i <= p.cut.x + p.cut.w && j >= p.cut.y - 1 && j <= p.cut.y + p.cut.h;
        if (!inCut && get(i, j) === TILE_FLOOR) seed = idx(i, j);
      }
    if (seed < 0) continue;
    const doorSet = new Set(p.doors.map((d) => idx(d.x, d.y)));
    const stack = [seed];
    seen.add(seed);
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % W;
      const cy = (c - cx) / W;
      plotOf[c] = p.id;
      for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + ddx;
        const ny = cy + ddy;
        if (nx <= p.x || ny <= p.y || nx >= p.x + p.w - 1 || ny >= p.y + p.h - 1) continue;
        const n = idx(nx, ny);
        if (seen.has(n) || doorSet.has(n) || get(nx, ny) !== TILE_FLOOR) continue;
        seen.add(n);
        stack.push(n);
      }
    }
  }

  // setos: una fila de árboles pegada por dentro a los muros de cada parcela,
  // dejando libre el paso junto a las puertas
  const nearDoor = (x: number, y: number, p: HuntPlot) =>
    [...p.doors, ...p.gaps].some((d) => Math.max(Math.abs(d.x - x), Math.abs(d.y - y)) <= 2);
  for (const p of plots) {
    for (let j = p.y + 1; j < p.y + p.h - 1; j++) {
      for (let i = p.x + 1; i < p.x + p.w - 1; i++) {
        const c = idx(i, j);
        if (plotOf[c] !== p.id || get(i, j) !== TILE_FLOOR) continue;
        const touchesWall = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => get(i + a, j + b) === TILE_ROCK);
        if (!touchesWall || nearDoor(i, j, p) || R() < 0.08) continue;
        set(i, j, TILE_TREE);
      }
    }
  }

  // pasillos: algún peñasco y alguna arboleda suelta, lejos de los muros
  const farFromWalls = (x: number, y: number, d: number) => {
    for (let j = y - d; j <= y + d; j++)
      for (let i = x - d; i <= x + d; i++) if (get(i, j) !== TILE_FLOOR) return false;
    return true;
  };
  for (let n = 0; n < 90; n++) {
    const x = ri(3, W - 4);
    const y = ri(3, H - 4);
    if (plotOf[idx(x, y)] >= 0 || noBuild[idx(x, y)] || !farFromWalls(x, y, 2)) continue;
    const kind = R() < 0.55 ? TILE_TREE : TILE_ROCK;
    const size = kind === TILE_TREE ? ri(2, 6) : ri(1, 3);
    let cx = x;
    let cy = y;
    for (let i = 0; i < size; i++) {
      if (plotOf[idx(cx, cy)] < 0 && !noBuild[idx(cx, cy)] && farFromWalls(cx, cy, 1)) set(cx, cy, kind);
      if (R() < 0.5) cx += R() < 0.5 ? 1 : -1;
      else cy += R() < 0.5 ? 1 : -1;
    }
  }

  // todo el suelo alcanzable desde la guarida; lo que quede aislado se rellena
  const reach = new Uint8Array(W * H);
  const q = [idx(camp.x, camp.y)];
  reach[q[0]] = 1;
  while (q.length) {
    const c = q.pop()!;
    const cx = c % W;
    const cy = (c - cx) / W;
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = idx(cx + ddx, cy + ddy);
      if (inside(cx + ddx, cy + ddy) && tiles[n] === TILE_FLOOR && !reach[n]) {
        reach[n] = 1;
        q.push(n);
      }
    }
  }
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === TILE_FLOOR && !reach[i]) {
      tiles[i] = TILE_ROCK;
      plotOf[i] = -1;
    }
  }
  for (const p of plots) {
    let a = 0;
    for (let j = p.y; j < p.y + p.h; j++) for (let i = p.x; i < p.x + p.w; i++) if (plotOf[idx(i, j)] === p.id && tiles[idx(i, j)] === TILE_FLOOR) a++;
    p.area = a;
  }
  const trees: number[] = [];
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === TILE_TREE) trees.push(i);

  cached = {
    w: W,
    h: H,
    tiles,
    noBuild,
    plotOf,
    plots: plots.filter((p) => p.area >= 30),
    camp,
    plaza,
    angelSpawn: { x: camp.x, y: plaza.y - 2 },
    trees,
  };
  return cached;
}
