import type { MapDef } from '../types.js';

// LABERINTO · CAMPO DE RUTAS (flow field)
//
// En los mapas de laberinto no hay recorrido trazado: los monstruos entran por
// TODO el borde de arriba y quieren cruzar hasta el borde de abajo, por donde
// puedan. Cada torre es un muro que les obliga a rodear.
//
// En vez de calcular una ruta por monstruo (caro, y con mil formas de
// desincronizarse), se calcula UNA vez por cambio del laberinto el coste de
// llegar a la meta desde cada punto. Todos leen ese mismo campo.
//
// Dos ventajas que justifican el diseño:
//   · coste O(celdas) por cambio, no O(monstruos) por tick;
//   · un monstruo NO guarda ruta propia, así que cuando el laberinto cambia bajo
//     sus pies no hay nada que reparar: sigue leyendo el campo desde donde esté.
//     Eso es lo que hace jugable vender una torre a mitad de oleada.
//
// REJILLA FINA (build grid): como en Warcraft, se puede construir cada MEDIA
// casilla de terreno, no solo en las casillas. Por eso todo aquí se cuenta en
// SUBCELDAS —dos por casilla y eje— y una torre ocupa SUB×SUB subceldas. Es lo
// que permite solapar filas a media casilla y cerrar las escaleras diagonales.
//
// DETERMINISMO (crítico — la sim es autoritativa y se reproduce en replays): el
// recorrido visita los vecinos SIEMPRE en el mismo orden, resuelve empates por
// índice y no consume RNG, así que el campo es función PURA de (mapa, muros).
// Por eso NO vive en GameState: se reconstruye idéntico al cargar un guardado.
//
// En estos mapas los AÉREOS también recorren el laberinto (ver moveThroughMaze):
// aquí el laberinto es el juego, y volar por encima vaciaba de sentido el oro
// invertido en muros. Siguen siendo distintos en que solo les alcanzan las torres
// antiaéreas y en que no pisan las trampas de suelo.

// subceldas por casilla de terreno y eje (build grid de media casilla)
export const SUB = 2;

export interface FlowField {
  w: number; // ancho en SUBCELDAS
  h: number; // alto en SUBCELDAS
  // COSTE hasta la meta en las unidades de STEP_STRAIGHT/STEP_DIAGONAL.
  // UNREACHABLE = subcelda encerrada por muros. Solo se usa para comparar, así
  // que la escala da igual mientras sea la misma en todo el campo.
  dist: Int32Array;
}

export const UNREACHABLE = -1;

// OCHO direcciones, como en el Line Tower Wars original: los monstruos también
// andan en diagonal y se cuelan por el hueco que dejan dos torres que solo se
// tocan en esquina. Ese detalle es el que hace posible el laberinto en ESCALERA.
//
// El orden es FIJO y no es decorativo: resuelve los empates cuando dos vecinos
// quedan a la misma distancia, así que cambiarlo cambia partidas ya grabadas.
// Rectos primero, diagonales después: a igualdad, se prefiere el paso recto.
const DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

// Coste de un paso, en enteros para que la aritmética sea exacta y reproducible
// (nada de raíces en coma flotante dentro de la sim): 10 en recto, 14 en diagonal
// ≈ 10·√2.
export const STEP_STRAIGHT = 10;
export const STEP_DIAGONAL = 14;
const STEP_COST: readonly number[] = [
  STEP_STRAIGHT,
  STEP_STRAIGHT,
  STEP_STRAIGHT,
  STEP_STRAIGHT,
  STEP_DIAGONAL,
  STEP_DIAGONAL,
  STEP_DIAGONAL,
  STEP_DIAGONAL,
];

// ---------- parcelas y bordes ----------

// ARENA · rectángulo (en casillas) de la parcela de un carril. Sin parcelas
// declaradas es el mapa entero: así juegan los tres modos de tablero compartido.
export function plotOf(
  map: MapDef,
  lane: number,
): { x: number; y: number; w: number; h: number } {
  return map.plots?.[lane] ?? { x: 0, y: 0, w: map.gridW, h: map.gridH };
}

export function inPlot(
  plot: { x: number; y: number; w: number; h: number },
  cx: number,
  cy: number,
): boolean {
  return cx >= plot.x && cy >= plot.y && cx < plot.x + plot.w && cy < plot.y + plot.h;
}

// Centro de una subcelda en coordenadas de mundo (casillas con decimales).
export function subCenter(s: number): number {
  return (s + 0.5) / SUB;
}

// Subcelda que contiene una coordenada de mundo.
export function subOf(worldCoord: number): number {
  return Math.floor(worldCoord * SUB);
}

// LABERINTO · el frente de ENTRADA: toda la fila de arriba del carril. Los
// monstruos no salen de un portal, sino repartidos por el ancho — con un único
// punto de entrada el laberinto óptimo sería siempre el mismo embudo.
export function laneEntrySubs(map: MapDef, lane: number): number[] {
  const plot = plotOf(map, lane);
  const sy = plot.y * SUB;
  const out: number[] = [];
  for (let sx = plot.x * SUB; sx < (plot.x + plot.w) * SUB; sx++) out.push(sy * map.gridW * SUB + sx);
  return out;
}

// LABERINTO · el frente de META: toda la fila de abajo del carril. Cruzarla es
// fugarse (cuesta vidas).
export function laneGoalSubs(map: MapDef, lane: number): number[] {
  const plot = plotOf(map, lane);
  const sy = (plot.y + plot.h) * SUB - 1;
  const out: number[] = [];
  for (let sx = plot.x * SUB; sx < (plot.x + plot.w) * SUB; sx++) out.push(sy * map.gridW * SUB + sx);
  return out;
}

// Fila (en subceldas) del frente de meta de un carril: el movimiento la usa para
// saber si un monstruo ya cruzó.
export function laneGoalRow(map: MapDef, lane: number): number {
  const plot = plotOf(map, lane);
  return (plot.y + plot.h) * SUB - 1;
}

// Coordenada de mundo (casillas) del centro del frente de meta: es a donde vuelan
// los aéreos y los que quedan encerrados.
export function laneGoalPoint(map: MapDef, lane: number): { x: number; y: number } {
  const plot = plotOf(map, lane);
  return { x: plot.x + plot.w / 2, y: plot.y + plot.h - 0.5 };
}

// ---------- rejilla de muros ----------

// Rejilla de muros para el recorrido, en SUBCELDAS: casillas decorativas del mapa
// + las torres que BLOQUEAN (cada una ocupa SUB×SUB subceldas desde su esquina).
// Ojo: no todas bloquean — las trampas de suelo se pisan, no se rodean, así que
// el llamador NO las incluye.
//
// `bounds` acota a una parcela: todo lo de fuera cuenta como muro. Es lo que
// mantiene a cada jugador en su terreno — sin ello un monstruo se escaparía a la
// parcela del vecino y acabaría defendido por las torres de otro.
export function blockedGrid(
  map: MapDef,
  walls: Iterable<{ cx: number; cy: number }>,
  bounds?: { x: number; y: number; w: number; h: number },
): Uint8Array {
  const w = map.gridW * SUB;
  const h = map.gridH * SUB;
  const grid = new Uint8Array(w * h);
  if (bounds) {
    const x0 = bounds.x * SUB;
    const y0 = bounds.y * SUB;
    const x1 = (bounds.x + bounds.w) * SUB;
    const y1 = (bounds.y + bounds.h) * SUB;
    for (let sy = 0; sy < h; sy++) {
      for (let sx = 0; sx < w; sx++) {
        if (sx < x0 || sy < y0 || sx >= x1 || sy >= y1) grid[sy * w + sx] = 1;
      }
    }
  }
  const fill = (cx: number, cy: number): void => {
    const sx0 = Math.round(cx * SUB);
    const sy0 = Math.round(cy * SUB);
    for (let dy = 0; dy < SUB; dy++) {
      for (let dx = 0; dx < SUB; dx++) {
        const sx = sx0 + dx;
        const sy = sy0 + dy;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        grid[sy * w + sx] = 1;
      }
    }
  };
  for (const [c, r] of map.blocked) fill(c, r);
  for (const wall of walls) fill(wall.cx, wall.cy);
  return grid;
}

// ---------- el campo ----------

// Dijkstra desde TODO el frente de meta hacia atrás (varias fuentes a la vez).
//
// Con ocho direcciones no vale un BFS: los pasos no cuestan lo mismo (14 en
// diagonal frente a 10 en recto), así que hay que expandir SIEMPRE la subcelda
// más cercana pendiente, no la primera encontrada. Se usa un montículo binario
// con desempate por índice para que el recorrido sea reproducible tick a tick y
// máquina a máquina.
export function buildField(map: MapDef, blocked: Uint8Array, goals: number[]): FlowField {
  const w = map.gridW * SUB;
  const h = map.gridH * SUB;
  const n = w * h;
  const dist = new Int32Array(n).fill(UNREACHABLE);
  const field: FlowField = { w, h, dist };

  const heap = new Int32Array(n + 1);
  let size = 0;
  // ¿va antes `a` que `b`? Menor coste primero; a igualdad, menor índice — el
  // desempate explícito es lo que hace determinista todo el recorrido.
  const before = (a: number, b: number): boolean => (dist[a] !== dist[b] ? dist[a] < dist[b] : a < b);
  const push = (cell: number): void => {
    let i = size++;
    heap[i] = cell;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(heap[i], heap[parent])) break;
      const t = heap[i];
      heap[i] = heap[parent];
      heap[parent] = t;
      i = parent;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    heap[0] = heap[--size];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let best = i;
      if (l < size && before(heap[l], heap[best])) best = l;
      if (r < size && before(heap[r], heap[best])) best = r;
      if (best === i) break;
      const t = heap[i];
      heap[i] = heap[best];
      heap[best] = t;
      i = best;
    }
    return top;
  };

  // el frente de meta entero arranca a coste 0, aunque alguna de sus subceldas
  // esté tapada: si no, un mapa mal declarado dejaría el campo vacío
  for (const g of goals) {
    if (g < 0 || g >= n) continue;
    if (dist[g] !== UNREACHABLE) continue;
    dist[g] = 0;
    push(g);
  }

  const settled = new Uint8Array(n);
  while (size > 0) {
    const cur = pop();
    if (settled[cur]) continue; // entrada obsoleta: ya se cerró con un coste menor
    settled[cur] = 1;
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (let d = 0; d < DIRS.length; d++) {
      const nx = cx + DIRS[d][0];
      const ny = cy + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (blocked[ni] || settled[ni]) continue;
      // NO se prohíbe "cortar esquina": si dos torres se tocan en diagonal, el
      // monstruo pasa por el hueco. Es la regla del Line Tower Wars y justo la
      // que hace que el laberinto en escalera funcione.
      const nd = dist[cur] + STEP_COST[d];
      if (dist[ni] === UNREACHABLE || nd < dist[ni]) {
        dist[ni] = nd;
        push(ni);
      }
    }
  }
  return field;
}

// Coste de una subcelda hasta la meta (UNREACHABLE si está encerrada o fuera).
export function fieldDist(field: FlowField, sx: number, sy: number): number {
  if (sx < 0 || sy < 0 || sx >= field.w || sy >= field.h) return UNREACHABLE;
  return field.dist[sy * field.w + sx];
}

export function reachable(field: FlowField, sx: number, sy: number): boolean {
  return fieldDist(field, sx, sy) !== UNREACHABLE;
}

// ¿queda camino desde el frente de entrada? Es la comprobación de la regla
// anti-bloqueo: basta con que UNA subcelda de arriba llegue abajo.
export function frontReaches(field: FlowField, entry: number[]): boolean {
  for (const e of entry) {
    if (e >= 0 && e < field.dist.length && field.dist[e] !== UNREACHABLE) return true;
  }
  return false;
}

// Siguiente subcelda hacia la meta: la que minimiza «lo que cuesta llegar hasta
// ella + el paso». Con pasos de distinto precio no basta con mirar quién está más
// cerca: una diagonal puede tener mejor número y aun así salir más cara.
//
// Se elige el MÍNIMO entre los vecinos, sin compararlo con la subcelda actual: en
// un camino óptimo el mejor vecino empata exactamente con ella, así que exigir
// «estrictamente menor» dejaría a los monstruos plantados sin encontrar salida.
export function nextSub(
  field: FlowField,
  sx: number,
  sy: number,
): { sx: number; sy: number } | null {
  const here = fieldDist(field, sx, sy);
  if (here === UNREACHABLE || here === 0) return null;
  let bestTotal = Number.MAX_SAFE_INTEGER;
  let best: { sx: number; sy: number } | null = null;
  for (let d = 0; d < DIRS.length; d++) {
    const nx = sx + DIRS[d][0];
    const ny = sy + DIRS[d][1];
    const nd = fieldDist(field, nx, ny);
    if (nd === UNREACHABLE) continue;
    const total = nd + STEP_COST[d];
    if (total < bestTotal) {
      bestTotal = total;
      best = { sx: nx, sy: ny };
    }
  }
  return best;
}
