// CACERÍA · el cazador manejado por la máquina (para jugar sin nadie más).
//
// Juega con lo que VE su bando (misma niebla) y recuerda los edificios que vio.
// Decide una vez por segundo:
//   1. malherido → regreso a la guarida (se cura un 6 %/s allí) y compra;
//   2. en la guarida: mejora la guarida y compra armas, vida y escudos;
//   3. colono a la vista y alcanzable → a por él;
//   4. edificios conocidos → primero la casa (si la ve) o la muralla más cercana;
//   5. a ciegas → el Ojo sobre la parcela más prometedora o patrulla.
import { TICK_RATE } from '../constants.js';
import { HUT_LEVELS, ITEMS, SHOP_RADIUS, WOOD_FOR_GOLD, type BuildingType } from './defs.js';
import { getHuntMap } from './map.js';
import { huntBlockedGrid, huntFindPath, huntHunterUnit, viewOf, type HuntCommand, type HuntState } from './sim.js';

export const HUNT_BOT_ID = 'bot';
export const HUNT_BOT = { id: HUNT_BOT_ID, name: 'Bestia', color: '#ff5a4e' };

export interface HuntBotMemory {
  known: Map<number, { cx: number; cy: number; size: number; type: BuildingType }>;
  patrol: number;
  retreating: boolean;
}

export function createHuntBotMemory(): HuntBotMemory {
  return { known: new Map(), patrol: 0, retreating: false };
}

const inSrc = (src: [number, number, number][], x: number, y: number) => src.some(([sx, sy, r]) => (sx - x) ** 2 + (sy - y) ** 2 <= r * r);

export function huntBotCommands(st: HuntState, mem: HuntBotMemory): HuntCommand[] {
  const p = st.players.find((q) => q.id === HUNT_BOT_ID);
  const u = huntHunterUnit(st);
  if (!p || !u || u.owner !== HUNT_BOT_ID || st.over || st.tick % TICK_RATE !== 0) return [];
  const map = getHuntMap();
  const out: HuntCommand[] = [];
  const v = viewOf(st, HUNT_BOT_ID);
  for (const b of st.buildings) {
    if (v.all || inSrc(v.src, b.cx + b.size / 2, b.cy + b.size / 2)) mem.known.set(b.id, { cx: b.cx, cy: b.cy, size: b.size, type: b.type });
  }
  for (const id of [...mem.known.keys()]) if (!st.buildings.some((b) => b.id === id)) mem.known.delete(id);
  if (st.tick < st.releaseTick || u.channelEnd > 0) return out;

  const campX = map.camp.x + 0.5;
  const campY = map.camp.y + 2.5;
  const atCamp = Math.hypot(u.x - (map.camp.x + 0.5), u.y - (map.camp.y + 0.5)) <= SHOP_RADIUS;
  const frac = u.hp / u.maxHp;
  const goHome = () => {
    if ((p.cds.recall ?? 0) <= st.tick && Math.hypot(u.x - campX, u.y - campY) > 10) out.push({ k: 'ability', a: 'recall' });
    else out.push({ k: 'move', x: campX, y: campY });
  };

  if (atCamp) {
    let gold = p.gold;
    const nextHut = HUT_LEVELS[st.hutLevel];
    if (nextHut && gold >= nextHut.cost * 2) {
      out.push({ k: 'hut' });
      gold -= nextHut.cost;
    }
    // la mejor arma y el mejor corazón que pueda pagar, alternando
    for (const line of ['weapon', 'life', 'weapon', 'armor', 'gloves'] as const) {
      const tiers = ITEMS[line].tiers;
      for (let t = tiers.length - 1; t >= 0; t--) {
        const tier = tiers[t];
        if (tier.wood > 0 || tier.gold > gold || tier.gold < gold / 16) continue;
        if (p.inv.indexOf(null) < 0) break;
        out.push({ k: 'buy', line, tier: t });
        gold -= tier.gold;
        break;
      }
    }
    if (gold > WOOD_FOR_GOLD * 2) out.push({ k: 'buywood' });
    if (frac >= 0.95) mem.retreating = false;
    if (mem.retreating) return out;
  }
  if (frac < 0.3) mem.retreating = true;
  if (mem.retreating) {
    goHome();
    return out;
  }
  // con mucho oro en el bolsillo merece la pena volver a gastarlo
  const cheapest = ITEMS.weapon.tiers.find((t) => t.gold > 0 && t.gold > p.gold / 8);
  if (!atCamp && cheapest && p.gold >= cheapest.gold * 3 && p.inv.indexOf(null) >= 0) {
    goHome();
    return out;
  }

  const g = huntBlockedGrid(st, map);
  const hx = Math.floor(u.x);
  const hy = Math.floor(u.y);
  // 3 · presa a la vista
  const prey = st.units
    .filter((o) => o.alive && (o.kind === 'elf' || o.kind === 'repairer' || o.kind === 'lumberjack') && (v.all || inSrc(v.src, o.x, o.y)))
    .sort((a, b) => (a.kind === 'elf' ? 0 : 1) - (b.kind === 'elf' ? 0 : 1) || Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y));
  for (const o of prey) {
    if (huntFindPath(g, map.w, map.h, hx, hy, { x: Math.floor(o.x), y: Math.floor(o.y), w: 1, h: 1, near: false }).reached) {
      if (!(u.order.k === 'attack' && u.order.target === o.id)) out.push({ k: 'attack', target: o.id });
      if ((p.cds.berserk ?? 0) <= st.tick && o.kind === 'elf' && Math.hypot(o.x - u.x, o.y - u.y) < 6) out.push({ k: 'ability', a: 'berserk' });
      return out;
    }
  }
  // 4 · edificios conocidos que pueda tocar: la casa, luego murallas, luego lo demás
  if (u.order.k === 'attack' && mem.known.has(u.order.target)) return out;
  const rank = (t: BuildingType) => (t === 'house' ? 0 : t === 'wall' ? 1 : t === 'tower' ? 3 : 2);
  const known = [...mem.known.entries()].sort(
    (a, b) => rank(a[1].type) - rank(b[1].type) || Math.hypot(a[1].cx - u.x, a[1].cy - u.y) - Math.hypot(b[1].cx - u.x, b[1].cy - u.y),
  );
  for (const [id, k] of known) {
    if (huntFindPath(g, map.w, map.h, hx, hy, { x: k.cx, y: k.cy, w: k.size, h: k.size, near: true }).reached) {
      out.push({ k: 'attack', target: id });
      return out;
    }
  }
  // 5 · a ciegas: el Ojo sobre una parcela al azar o patrulla
  if ((p.cds.eye ?? 0) <= st.tick) {
    const plot = map.plots[(st.tick / TICK_RATE + mem.patrol * 7) % map.plots.length | 0];
    out.push({ k: 'ability', a: 'eye', x: plot.x + plot.w / 2, y: plot.y + plot.h / 2 });
    return out;
  }
  const plot = map.plots[mem.patrol % map.plots.length];
  const door = plot.doors[0] ?? { x: plot.x, y: plot.y };
  if (Math.hypot(door.x - u.x, door.y - u.y) < 2.5) mem.patrol += 1;
  else if (u.path.length === 0) out.push({ k: 'move', x: door.x + 0.5, y: door.y + 0.5 });
  return out;
}
