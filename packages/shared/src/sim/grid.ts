import type { GameState, MapDef, TowerTypeId, Vec } from '../types.js';
import { TOWERS } from '../balance/towers.js';
import {
  blockedGrid,
  buildField,
  frontReaches,
  inPlot,
  laneEntrySubs,
  laneGoalSubs,
  plotOf,
  SUB,
} from './field.js';

// LABERINTO · ¿esta torre es MURO? Las trampas de suelo (Trampa de púas, Barril
// explosivo) se PISAN, no se rodean: no bloquean el paso ni cuentan para el
// campo de rutas. El resto de torres son muro, y por eso pueden formar laberinto.
export function blocksMovement(type: TowerTypeId | undefined): boolean {
  // sin tipo conocido asumimos muro: es el lado conservador (como mucho rechaza
  // una colocación que habría sido válida; nunca deja sellar el laberinto).
  if (!type) return true;
  return TOWERS[type]?.onPathOnly !== true;
}

// ¿el cuerpo de una torre plantada en (cx, cy) pisa esta parcela? La torre ocupa
// un cuadro entero desde su esquina, así que a media casilla puede asomar a la
// parcela vecina — por eso se comprueba solapamiento y no pertenencia.
function overlapsPlot(
  plot: { x: number; y: number; w: number; h: number },
  cx: number,
  cy: number,
): boolean {
  return cx + 1 > plot.x && cy + 1 > plot.y && cx < plot.x + plot.w && cy < plot.y + plot.h;
}

// LABERINTO · ¿poner un muro en (cx, cy) dejaría alguna entrada sin salida?
// Es LA regla del género: puedes obligar a dar mil vueltas, pero nunca cerrar
// el paso del todo. La comprueba el servidor al aplicar el comando y el cliente
// al previsualizar, porque es la misma función pura.
export function sealsMaze(
  map: MapDef,
  towers: { cx: number; cy: number; type?: TowerTypeId }[],
  cx: number,
  cy: number,
): boolean {
  const walls = [...towers.filter((t) => blocksMovement(t.type)), { cx, cy }];
  // Se rechaza si el frente de arriba se queda SIN NINGÚN hueco por el que bajar.
  // Con parcelas solo hace falta mirar la que contiene la torre: las demás no
  // pueden verse afectadas por un muro que no está en su terreno.
  for (let lane = 0; lane < map.paths.length; lane++) {
    const plot = plotOf(map, lane);
    if (map.plots && !overlapsPlot(plot, cx, cy)) continue;
    const field = buildField(
      map,
      blockedGrid(map, walls, map.plots ? plot : undefined),
      laneGoalSubs(map, lane),
    );
    if (!frontReaches(field, laneEntrySubs(map, lane))) return true;
  }
  return false;
}

// Waypoints de un camino en coordenadas de mundo (centros de celda).
export function pathWaypoints(map: MapDef, pathIdx: number): Vec[] {
  return map.paths[pathIdx].map(([c, r]) => ({ x: c + 0.5, y: r + 0.5 }));
}

export function pathLength(map: MapDef, pathIdx: number): number {
  const wps = pathWaypoints(map, pathIdx);
  let len = 0;
  for (let i = 1; i < wps.length; i++) {
    len += Math.abs(wps[i].x - wps[i - 1].x) + Math.abs(wps[i].y - wps[i - 1].y);
  }
  return len;
}

// Todas las celdas que pisa algún camino (los segmentos son axis-aligned).
export function pathCells(map: MapDef): Set<string> {
  const cells = new Set<string>();
  for (const path of map.paths) {
    for (let i = 1; i < path.length; i++) {
      const [c0, r0] = path[i - 1];
      const [c1, r1] = path[i];
      const dc = Math.sign(c1 - c0);
      const dr = Math.sign(r1 - r0);
      let c = c0;
      let r = r0;
      cells.add(`${c},${r}`);
      while (c !== c1 || r !== r1) {
        c += dc;
        r += dr;
        cells.add(`${c},${r}`);
      }
    }
  }
  return cells;
}

export function blockedCells(map: MapDef): Set<string> {
  return new Set(map.blocked.map(([c, r]) => `${c},${r}`));
}

export interface PlacementContext {
  paths: Set<string>;
  blocked: Set<string>;
}

export function makePlacementContext(map: MapDef): PlacementContext {
  return { paths: pathCells(map), blocked: blockedCells(map) };
}

export type PlacementError =
  | 'fuera'
  | 'camino'
  | 'bloqueado'
  | 'ocupado'
  | 'fuera_camino'
  // LABERINTO · la torre cerraría el paso del todo (ver sealsMaze)
  | 'sella'
  // ARENA · esa celda es de la parcela de otro jugador
  | 'fuera_parcela'
  | null;

// `towerType` opcional: relaja la regla del camino por tipo. La Trampa de púas
// (`onPathOnly`) SOLO puede ir SOBRE el camino; el resto de torres, SOLO fuera.
//
// En mapas de LABERINTO (map.maze) las reglas son otras: se construye en
// cualquier celda libre —esa es la gracia— y lo único prohibido es sellar el
// paso. `towers` acepta el tipo de cada torre porque las trampas de suelo no
// cuentan como muro; sin tipo se asume muro (lado conservador).
export function placementError(
  map: MapDef,
  ctx: PlacementContext,
  towers: { cx: number; cy: number; type?: TowerTypeId }[],
  cx: number,
  cy: number,
  towerType?: TowerTypeId,
  // ARENA · parcela del jugador que construye. Presente solo en arena; sin ella
  // vale todo el mapa, que es como funcionan los tres modos de tablero compartido.
  plot?: { x: number; y: number; w: number; h: number },
): PlacementError {
  // El laberinto va PRIMERO porque juega con otras reglas: coordenadas de media
  // casilla (no enteras) y torres que ocupan un cuadro entero desde su esquina.
  if (map.maze === true) {
    // REJILLA FINA · la torre ocupa una casilla entera pero puede plantarse cada
    // MEDIA casilla, así que su esquina cae en múltiplos de 0.5 y su cuerpo va de
    // (cx, cy) a (cx+1, cy+1). Es el build grid de Warcraft: lo que permite
    // solapar filas y cerrar las escaleras diagonales.
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return 'fuera';
    if (!Number.isInteger(cx * SUB) || !Number.isInteger(cy * SUB)) return 'fuera';
    if (cx < 0 || cy < 0 || cx + 1 > map.gridW || cy + 1 > map.gridH) return 'fuera';
    // ninguna de las casillas que pisa puede ser terreno decorativo
    for (let dy = 0; dy < 1 + (Number.isInteger(cy) ? 0 : 1); dy++) {
      for (let dx = 0; dx < 1 + (Number.isInteger(cx) ? 0 : 1); dx++) {
        if (ctx.blocked.has(`${Math.floor(cx) + dx},${Math.floor(cy) + dy}`)) return 'bloqueado';
      }
    }
    // dos torres se estorban si sus cuerpos se solapan, aunque no compartan celda
    if (towers.some((t) => Math.abs(t.cx - cx) < 1 && Math.abs(t.cy - cy) < 1)) return 'ocupado';
    // la torre ENTERA tiene que caber en la parcela propia
    if (plot && (cx < plot.x || cy < plot.y || cx + 1 > plot.x + plot.w || cy + 1 > plot.y + plot.h)) {
      return 'fuera_parcela';
    }
    // Franjas de nacimiento (arriba) y de meta (abajo): reservadas. Si no, las
    // oleadas aparecerían dentro de una torre y no habría dónde cruzar.
    const zone = plot ?? { x: 0, y: 0, w: map.gridW, h: map.gridH };
    if (cy < zone.y + 1 || cy + 1 > zone.y + zone.h - 1) return 'bloqueado';
    // las trampas de suelo se pisan: nunca pueden sellar nada
    if (!blocksMovement(towerType)) return null;
    return sealsMaze(map, towers, cx, cy) ? 'sella' : null;
  }

  if (!Number.isInteger(cx) || !Number.isInteger(cy)) return 'fuera';
  if (cx < 0 || cy < 0 || cx >= map.gridW || cy >= map.gridH) return 'fuera';
  if (plot && !inPlot(plot, cx, cy)) return 'fuera_parcela';
  const key = `${cx},${cy}`;

  const onPathOnly = towerType ? TOWERS[towerType]?.onPathOnly === true : false;
  const isPath = ctx.paths.has(key);
  if (onPathOnly) {
    // la Trampa DEBE ir sobre el camino; fuera del camino, rechazar
    if (!isPath) return 'fuera_camino';
    // dentro del camino puede haber otra trampa ocupando la celda
    if (towers.some((t) => t.cx === cx && t.cy === cy)) return 'ocupado';
    return null;
  }
  if (isPath) return 'camino';
  if (ctx.blocked.has(key)) return 'bloqueado';
  if (towers.some((t) => t.cx === cx && t.cy === cy)) return 'ocupado';
  return null;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}
