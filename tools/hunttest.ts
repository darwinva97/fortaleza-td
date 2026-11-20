// Prueba de la sim de CACERÍA: `npx tsx tools/hunttest.ts`.
// No mide diversión; comprueba que las reglas hacen lo que dicen y que el
// servidor aguanta una partida grande.
import {
  HUNT_BOT,
  PHASE,
  TICK_RATE,
  armorMult,
  huntWallLevel,
  levelDef,
  buildHuntSnap,
  createHunt,
  fighterStats,
  ITEMS,
  createHuntBotMemory,
  getHuntMap,
  huntBotCommands,
  huntHunterUnit,
  mainUnit,
  stepHunt,
  type HuntPlayerCommand,
  type HuntState,
} from '@td/shared';

let failed = 0;
function assert(ok: boolean, msg: string): void {
  if (!ok) {
    failed++;
    console.error('  ✗', msg);
  } else console.log('  ✓', msg);
}
const roster = [
  { id: 'p1', name: 'Caza', color: '#f00' },
  { id: 'p2', name: 'Ana', color: '#0f0' },
  { id: 'p3', name: 'Beto', color: '#00f' },
];
const sec = (s: number) => Math.round(s * TICK_RATE);
const run = (st: HuntState, ticks: number, cmds: HuntPlayerCommand[] = []) => {
  const evs = stepHunt(st, cmds);
  for (let i = 1; i < ticks && !st.over; i++) evs.push(...stepHunt(st, []));
  return evs;
};
const map = getHuntMap();
const P = (st: HuntState, id: string) => st.players.find((p) => p.id === id)!;

console.log('mapa');
assert(map.plots.length >= 20, `hay ${map.plots.length} parcelas`);
assert(map.plots.every((p) => p.doors.length >= 1), 'todas tienen puerta');
assert(map.trees.length > 500, `hay ${map.trees.length} árboles`);
const big = map.plots.filter((p) => p.area >= 60).length;
assert(big >= map.plots.length / 2, `la mayoría son grandes (${big} con ≥60 casillas libres)`);

// parcela de pruebas: una con puerta de 1 casilla
const plot = map.plots.find((p) => p.doors.length === 1 && p.area >= 60 && p.shape === 'rect')!;
const door = plot.doors[0];
const inner = (() => {
  for (let j = plot.y + 2; j < plot.y + plot.h - 2; j++)
    for (let i = plot.x + 2; i < plot.x + plot.w - 2; i++) if (map.tiles[j * map.w + i] === 0 && map.plotOf[j * map.w + i] === plot.id) return { x: i, y: j };
  return { x: plot.x + 3, y: plot.y + 3 };
})();
// casilla libre del interior, lejos de los árboles, para la casa (2×2)
const houseCell = (() => {
  for (let j = plot.y + 2; j < plot.y + plot.h - 3; j++)
    for (let i = plot.x + 2; i < plot.x + plot.w - 3; i++) {
      const ok = [0, 1].every((a) => [0, 1].every((b) => map.tiles[(j + b) * map.w + i + a] === 0 && map.plotOf[(j + b) * map.w + i + a] === plot.id));
      const nearDoor = Math.max(Math.abs(i - door.x), Math.abs(j - door.y)) <= 3;
      if (ok && !nearDoor) return { x: i, y: j };
    }
  return inner;
})();

console.log('ventaja y construcción a distancia');
{
  const st = createHunt(1, roster, 'p1');
  const h = huntHunterUnit(st)!;
  const x0 = h.x;
  const r = run(st, sec(2), [{ playerId: 'p1', cmd: { k: 'move', x: 10, y: 10 } }]);
  assert(h.x === x0 && r.some((e) => e.e === 'reject'), 'el cazador está retenido al empezar');
  const elf = mainUnit(st, 'p2')!;
  // ordena la muralla en la puerta: el colono va andando y la planta al llegar
  run(st, sec(40), [{ playerId: 'p2', cmd: { k: 'build', type: 'wall', cx: door.x, cy: door.y } }]);
  const wall = st.buildings.find((b) => b.type === 'wall');
  assert(!!wall && wall.cx === door.x && wall.cy === door.y, 'el colono camina hasta la puerta y la cierra con una muralla');
  assert(P(st, 'p2').gold === 30 - 4, 'la muralla cuesta 4 de oro');
  void elf;
}

console.log('economía, requisitos y murallas');
{
  const st = createHunt(2, roster, 'p1');
  const ana = P(st, 'p2');
  const elf = mainUnit(st, 'p2')!;
  elf.x = inner.x + 0.5;
  elf.y = inner.y + 0.5;
  const hev = run(st, sec(15), [
    { playerId: 'p2', cmd: { k: 'build', type: 'house', cx: houseCell.x, cy: houseCell.y } },
  ]);
  for (const e of hev) if (e.e === 'reject') console.log('    (rechazo:', e.reason, ')');
  const house = st.buildings.find((b) => b.type === 'house');
  assert(!!house, 'la casa se construye (gratis)');
  const g0 = ana.gold;
  run(st, sec(10));
  assert(Math.abs(ana.gold - g0 - 30) <= 3, `la casa de nivel 1 da 1×3 de oro/s (${ana.gold - g0} en 10 s)`);
  ana.gold = 10_000;
  const r = run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: house!.id } }]);
  assert(house!.level === 1 && r.some((e) => e.e === 'reject' && e.reason.includes('muralla')), 'para subir la casa hace falta una muralla');
  run(st, sec(20), [{ playerId: 'p2', cmd: { k: 'build', type: 'wall', cx: door.x, cy: door.y } }]);
  const wall = st.buildings.find((b) => b.type === 'wall')!;
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: house!.id } }]);
  assert(house!.level === 2, 'con una muralla la casa sube a nivel 2 (2 de oro/s)');
  for (let i = 0; i < 4; i++) run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: wall.id } }]);
  assert(wall.level === 5 && wall.maxHp === 250, 'tronco de la muralla: nivel 5 con 250 de vida');
  const rr = run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: wall.id } }]);
  assert(wall.level === 5 && rr.some((e) => e.e === 'reject'), 'al nivel 6 hay que elegir especialidad');
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: wall.id, branch: 'cement' } }]);
  assert(wall.level === 6 && wall.wallBranch === 'cement' && wall.maxHp === 360, 'muralla de cemento: 360 de vida');

  // asedio: el cazador golpea la muralla de cemento (armadura 5, −1 por golpe)
  run(st, sec(PHASE.headStartSec));
  const h = huntHunterUnit(st)!;
  const hunter = P(st, 'p1');
  h.x = door.x + 0.5;
  h.y = door.y + (door.y === plot.y ? -1 : door.y === plot.y + plot.h - 1 ? 1 : 0) + 0.5;
  h.x += door.x === plot.x ? -1 : door.x === plot.x + plot.w - 1 ? 1 : 0;
  const gold0 = hunter.gold;
  const hp0 = wall.hp;
  run(st, 3, [{ playerId: 'p1', cmd: { k: 'attack', target: wall.id } }]);
  // daño del troll al nivel 1 = 5 + 2 de agilidad de los talentos (Ojo EX y hueco de botas)
  const tdmg = fighterStats(st, hunter, h).dmg;
  const expected = Math.max(1, tdmg - 1) * armorMult(5);
  assert(Math.abs(hp0 - wall.hp - expected) < 0.01, `cada golpe hace ${expected.toFixed(2)} a la muralla (armadura y cemento)`);
  assert(hunter.gold - gold0 >= Math.floor(expected), 'y el cazador cobra el daño hecho en oro');

  // reparador: rellena la muralla
  run(st, sec(10), [{ playerId: 'p1', cmd: { k: 'stop' } }]);
  h.x = map.camp.x + 0.5;
  h.y = map.camp.y + 2.5;
  run(st, sec(15), [{ playerId: 'p2', cmd: { k: 'build', type: 'workshop', cx: houseCell.x + 3, cy: houseCell.y } }]);
  const shop = st.buildings.find((b) => b.type === 'workshop');
  assert(!!shop, 'construye un taller');
  if (shop) {
    run(st, 1, [{ playerId: 'p2', cmd: { k: 'train', id: shop.id, unit: 'repairer', tier: 0 } }]);
    assert(st.units.some((u) => u.kind === 'repairer' && u.alive), 'contrata un aprendiz');
    wall.hp = 100;
    run(st, sec(25));
    assert(wall.hp > 120, `el reparador sube la muralla (${Math.round(wall.hp)} de 360)`);
    // mover un obrero con el ratón y luego mandarlo a reparar algo concreto
    const rep = st.units.find((u) => u.kind === 'repairer' && u.alive)!;
    for (const b of st.buildings) b.hp = b.maxHp; // nada que reparar: se queda donde lo mandas
    run(st, sec(4), [{ playerId: 'p2', cmd: { k: 'worker', id: rep.id, x: inner.x + 0.5, y: inner.y + 0.5 } }]);
    const px0 = rep.x;
    const py0 = rep.y;
    run(st, sec(3));
    assert(Math.hypot(rep.x - inner.x - 0.5, rep.y - inner.y - 0.5) < 2.3 && rep.x === px0 && rep.y === py0, 'el reparador va a donde lo mandas y se queda ahí');
    // vender: devuelve la mitad
    const g0 = ana.gold;
    run(st, 1, [{ playerId: 'p2', cmd: { k: 'sellunit', id: rep.id } }]);
    assert(!rep.alive && ana.gold - g0 === 16, `vender un aprendiz devuelve la mitad (${ana.gold - g0} de 32)`);
  }
  // leñador en una base CERRADA: tala un árbol de dentro (antes se atascaba
  // yendo al árbol más cercano en línea recta, que estaba fuera de la muralla)
  ana.gold += 100000;
  const shop2 = st.buildings.find((b) => b.type === 'workshop')!;
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: shop2.id } }]);
  const spots: [number, number][] = [];
  for (let y = plot.y + 1; y < plot.y + plot.h - 2; y++)
    for (let x = plot.x + 1; x < plot.x + plot.w - 2; x++)
      if ([0, 1].every((a2) => [0, 1].every((b2) => map.tiles[(y + b2) * map.w + x + a2] === 0 && map.plotOf[(y + b2) * map.w + x + a2] === plot.id)) && !st.buildings.some((b) => Math.abs(b.cx - x) < 3 && Math.abs(b.cy - y) < 3)) spots.push([x, y]);
  const [ex, ey] = spots[Math.floor(spots.length / 2)];
  run(st, sec(15), [{ playerId: 'p2', cmd: { k: 'build', type: 'elftree', cx: ex, cy: ey } }]);
  const etree = st.buildings.find((b) => b.type === 'elftree');
  assert(!!etree, 'construye el árbol élfico');
  if (etree) {
    run(st, 1, [{ playerId: 'p2', cmd: { k: 'train', id: etree.id, unit: 'lumberjack', tier: 0 } }]);
    const lj = st.units.find((u) => u.kind === 'lumberjack' && u.alive)!;
    const w0 = ana.wood;
    run(st, sec(30));
    assert(ana.wood > w0 + 1 && map.plotOf[Math.floor(lj.y) * map.w + Math.floor(lj.x)] === plot.id, `el leñador tala dentro de la base cerrada (+${(ana.wood - w0).toFixed(1)} de madera en 30 s)`);
    // venderlo
    const t0 = lj.tree;
    run(st, 1, [{ playerId: 'p2', cmd: { k: 'sellunit', id: lj.id } }]);
    assert(!lj.alive && !st.treeTaken.has(t0), 'vender el leñador libera su árbol');
  }
  // vender un edificio devuelve la mitad de lo invertido
  const tw = st.buildings.find((b) => b.type === 'workshop')!;
  const inv = tw.investGold;
  const g1 = ana.gold;
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'demolish', id: tw.id } }]);
  assert(!st.buildings.includes(tw) && ana.gold - g1 === Math.floor(inv / 2), `vender el taller devuelve la mitad (${ana.gold - g1} de ${inv})`);
}

console.log('torres, golpes y papeles al morir');
{
  const st = createHunt(3, roster, 'p1');
  run(st, sec(PHASE.headStartSec) + 1);
  const h = huntHunterUnit(st)!;
  const ana = mainUnit(st, 'p2')!;
  P(st, 'p2').gold = 100;
  ana.x = h.x + 1;
  ana.y = h.y;
  run(st, 1, [{ playerId: 'p1', cmd: { k: 'attack', target: ana.id } }]);
  assert(ana.alive && ana.hp === 10 - fighterStats(st, P(st, 'p1'), h).dmg, `el primer golpe no lo mata (queda a ${ana.hp} de 10): hacen falta dos`);
  run(st, sec(2));
  assert(!ana.alive, 'el segundo lo mata');
  assert(P(st, 'p1').gold >= 75 + 67, 'el cazador se lleva el 67 % del oro del colono');
  assert(P(st, 'p2').form === 'choosing', 'el caído elige papel');
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'form', f: 'wolf' } }]);
  assert(P(st, 'p2').side === 'hunter' && st.units.some((u) => u.kind === 'wolf' && u.alive), 'como lobo se pasa al bando del cazador');
  assert(!st.over, 'la partida sigue mientras quede un colono');
  const beto = mainUnit(st, 'p3')!;
  beto.x = h.x - 1;
  beto.y = h.y;
  run(st, sec(4), [{ playerId: 'p1', cmd: { k: 'attack', target: beto.id } }]);
  run(st, 1, [{ playerId: 'p3', cmd: { k: 'form', f: 'angel' } }]);
  assert(st.over?.winner === 'hunter', 'sin colonos vivos gana el cazador (ángeles y lobos no cuentan)');
}
{
  const st = createHunt(4, roster, 'p1');
  const ana = P(st, 'p2');
  const elf = mainUnit(st, 'p2')!;
  // una torre mejorada junto a la plaza mata a un cazador débil
  const tx = map.plaza.x + map.plaza.w + 1;
  const ty = map.camp.y;
  elf.x = tx + 1.5;
  elf.y = ty + 0.5;
  run(st, sec(3), [{ playerId: 'p2', cmd: { k: 'build', type: 'tower', cx: tx, cy: ty } }]);
  const tower = st.buildings.find((b) => b.type === 'tower');
  assert(!!tower && P(st, 'p2').wood === 7, 'la torre cuesta 1 de madera');
  ana.gold = 100;
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: tower!.id } }]);
  assert(tower!.level === 2, 'mejorada a torre de madera (2 de daño)');
  run(st, sec(PHASE.headStartSec));
  const h = huntHunterUnit(st)!;
  h.hp = 6;
  h.x = tx - 2.5;
  h.y = ty + 0.5;
  run(st, sec(4), [{ playerId: 'p1', cmd: { k: 'stop' } }]);
  assert(st.over?.winner === 'colonist', 'la torre mata al cazador y ganan los colonos');
}

console.log('tienda, fusión de objetos y niveles');
{
  const st = createHunt(5, roster, 'p1');
  const hp = P(st, 'p1');
  hp.gold = 1000;
  run(st, 1, [{ playerId: 'p1', cmd: { k: 'buy', line: 'weapon', tier: 0 } }]);
  run(st, 1, [{ playerId: 'p1', cmd: { k: 'buy', line: 'weapon', tier: 0 } }]);
  const weapons = hp.inv.filter((s) => s?.kind === 'item' && s.line === 'weapon');
  assert(weapons.length === 1 && weapons[0]!.kind === 'item' && weapons[0]!.tier === 1, 'dos espadas cortas se funden en una espada (+4)');
  run(st, 1, [{ playerId: 'p1', cmd: { k: 'buy', line: 'life', tier: 0 } }]);
  assert(huntHunterUnit(st)!.maxHp === 750 + 250 + 50, `el corazón sube la vida máxima +250 (${huntHunterUnit(st)!.maxHp}: 750 + 250 + 50 por los +2 de fuerza de los talentos)`);
  hp.xp = 199;
  const h = huntHunterUnit(st)!;
  run(st, sec(PHASE.headStartSec) + 1);
  const wolfless = mainUnit(st, 'p3')!;
  wolfless.x = h.x + 1;
  wolfless.y = h.y;
  run(st, sec(3), [{ playerId: 'p1', cmd: { k: 'attack', target: wolfless.id } }]);
  assert(hp.level >= 2, `matar a un colono le sube de nivel (nivel ${hp.level})`);
  assert(h.maxHp >= 1500, 'cada nivel da +500 de vida');
}

console.log('visión');
{
  const st = createHunt(6, roster, 'p1');
  const a = mainUnit(st, 'p2')!;
  const b = mainUnit(st, 'p3')!;
  a.x = 10;
  a.y = 10;
  b.x = 90;
  b.y = 90;
  run(st, 2);
  const early = buildHuntSnap(st, 'p2');
  assert(!early.units.some((u) => u[0] === b.id), 'al principio un colono no ve a otro lejano');
  run(st, sec(PHASE.sharedVisionSec));
  b.x = 90;
  b.y = 90;
  const late = buildHuntSnap(st, 'p2');
  assert(late.units.some((u) => u[0] === b.id), 'a los 3 minutos comparten visión');
  const hs = buildHuntSnap(st, 'p1');
  assert(hs.players.find((p) => p.id === 'p2')!.gold === -1, 'el cazador no ve el oro de los colonos');
}

console.log('reglas completas del original');
{
  // murallas 16-18 y ramas nuevas
  assert(huntWallLevel(16, 'rock').flatReduce === 128 && huntWallLevel(18, 'rock').flatReduce === 16000, 'murallas torre: restan 128 / 1440 / 16000 por golpe');
  assert(huntWallLevel(7, 'hay').extraDamageTaken === 4, 'el heno recibe daño extra');
  assert(levelDef('mine', 9, null, 'main').income === 38400, 'la mina llega a 38 400 de oro/s');
  const st = createHunt(21, roster, 'p1');
  const ana = P(st, 'p2');
  const elf = mainUnit(st, 'p2')!;
  elf.x = inner.x + 0.5;
  elf.y = inner.y + 0.5;
  ana.gold = 1e7;
  ana.wood = 1e7;
  run(st, sec(20), [{ playerId: 'p2', cmd: { k: 'build', type: 'wall', cx: door.x, cy: door.y } }]);
  const wall = st.buildings.find((b) => b.type === 'wall')!;
  for (let i = 0; i < 4; i++) run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: wall.id } }]);
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: wall.id, branch: 'tree' } }]);
  const hp0 = wall.hp;
  wall.hp = 100;
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'eat', id: wall.id } }]);
  assert(st.deadTrees.size === 1, 'la muralla de árbol se come un árbol cercano');
  run(st, sec(31));
  assert(wall.hp > 250, `y recupera vida (${Math.round(wall.hp)})`);
  void hp0;
  // especialidad: Cegar → el cazador falla
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'spec', s: 'blind' } }]);
  run(st, sec(PHASE.headStartSec));
  const h = huntHunterUnit(st)!;
  elf.x = map.camp.x + 4.5;
  elf.y = map.camp.y + 0.5;
  elf.path = [];
  h.x = elf.x + 1.2;
  h.y = elf.y;
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'ability', a: 'blind', x: h.x, y: h.y } }]);
  const ev = run(st, sec(2), [{ playerId: 'p1', cmd: { k: 'attack', target: elf.id } }]);
  assert(elf.alive && ev.some((e) => e.e === 'miss'), 'cegado, el cazador falla sus golpes');
  // escudo antimagia: las raíces no le afectan
  const st2 = createHunt(22, roster, 'p1');
  run(st2, sec(PHASE.headStartSec));
  const h2 = huntHunterUnit(st2)!;
  const e2 = mainUnit(st2, 'p2')!;
  e2.x = h2.x + 2;
  e2.y = h2.y;
  run(st2, 1, [{ playerId: 'p1', cmd: { k: 'ability', a: 'ams' } }]);
  run(st2, 1, [{ playerId: 'p2', cmd: { k: 'ability', a: 'roots', x: h2.x, y: h2.y } }]);
  assert(h2.rootUntil <= st2.tick, 'con el escudo antimagia las raíces no le atrapan');
  // tienda: objetos sueltos, libros, botas aparte y rastreador
  const hp = P(st2, 'p1');
  hp.gold = 2_000_000;
  hp.wood = 20;
  h2.x = map.camp.x + 0.5;
  h2.y = map.camp.y + 2.5;
  run(st2, 1, [{ playerId: 'p1', cmd: { k: 'buytrinket', t: 'orb' } }]);
  run(st2, 1, [{ playerId: 'p1', cmd: { k: 'buycons', c: 'bookstr' } }]);
  run(st2, 1, [{ playerId: 'p1', cmd: { k: 'buy', line: 'boots', tier: 2 } }]);
  assert(hp.boots === 2 && hp.inv.filter(Boolean).length === 1, 'las botas van en su propio hueco');
  assert(h2.maxHp >= 750 + 4010 * 25, `orbe + libro de fuerza: ${h2.maxHp} de vida`);
  run(st2, 1, [{ playerId: 'p1', cmd: { k: 'beast' } }]);
  const beast = st2.units.find((u) => u.kind === 'beast');
  assert(!!beast && hp.wood === 12, 'el rastreador cuesta 8 de madera');
  e2.x = h2.x + 6;
  e2.y = h2.y;
  e2.invulnUntil = 0;
  run(st2, sec(6), [{ playerId: 'p1', cmd: { k: 'attack', target: e2.id } }]);
  assert(!e2.alive, 'el cazador y su rastreador cazan al colono');
  // ángel: velo lunar oculta a un colono
  run(st2, 1, [{ playerId: 'p2', cmd: { k: 'form', f: 'angel' } }]);
  const angel = st2.units.find((u) => u.kind === 'angel' && u.alive)!;
  const e3 = mainUnit(st2, 'p3')!;
  angel.x = e3.x + 1;
  angel.y = e3.y;
  angel.invulnUntil = 0;
  // sin el olfato del Rastreador (descubre invisibles: se prueba justo después)
  st2.eyes = st2.eyes.filter((e) => !e.detect);
  for (const u of st2.units) if (u.kind === 'beast') u.ready.detect = st2.tick + 99999;
  run(st2, 1, [{ playerId: 'p2', cmd: { k: 'ability', a: 'occult', x: e3.x, y: e3.y } }]);
  const view = buildHuntSnap(st2, 'p1');
  h2.x = e3.x + 2;
  h2.y = e3.y;
  const view2 = buildHuntSnap(st2, 'p1');
  assert(!view2.units.some((u) => u[0] === e3.id) && e3.occultUntil > st2.tick, 'el velo lunar hace invisible al colono para el cazador');
  st2.eyes.push({ side: 'hunter', detect: true, x: e3.x, y: e3.y, r: 5, until: st2.tick + 50 });
  assert(buildHuntSnap(st2, 'p1').units.some((u) => u[0] === e3.id), 'pero el olfato (lobo o Rastreador) lo descubre');
  void view;
}

console.log('lo que faltaba (2): troll, objetos, torres, Paladín, Rastreador');
{
  // armadura base del troll y talentos (+1 a todo, +1 más con el hueco de botas vacío)
  const st = createHunt(7, roster, 'p1');
  const hp = P(st, 'p1');
  const h = huntHunterUnit(st)!;
  const fs0 = fighterStats(st, hp, h);
  assert(Math.abs(fs0.armor - (3.9 + 2 * 0.5)) < 1e-6, `armadura del troll al nivel 1: 3,9 + agilidad de talentos (${fs0.armor})`);
  // botas: velocidad y agilidad
  hp.gold += 1000;
  run(st, 1, [{ playerId: 'p1', cmd: { k: 'buy', line: 'boots', tier: 0 } }]);
  const fs1 = fighterStats(st, hp, h);
  assert(hp.boots === 0 && Math.abs(fs1.armor - (3.9 + (1 + 2) * 0.5)) < 1e-6, `las botas dan +2 de agilidad (y se pierde el +1 del hueco vacío): armadura ${fs1.armor}`);
  // escarcha: el golpe del troll ralentiza al colono 3 s
  run(st, sec(PHASE.headStartSec) + 1);
  const elf = mainUnit(st, 'p2')!;
  elf.x = h.x + 0.8;
  elf.y = h.y;
  const ana = P(st, 'p2');
  ana.gold = 0;
  elf.hp = 1000; // que aguante para medir
  elf.maxHp = 1000;
  run(st, sec(2), [{ playerId: 'p1', cmd: { k: 'attack', target: elf.id } }]);
  assert(elf.chillUntil > st.tick, 'el golpe del troll deja al colono con escarcha (más lento)');
  // madera al por mayor
  hp.gold = 600000;
  h.x = map.camp.x + 0.5;
  h.y = map.camp.y + 2.5;
  const w0 = hp.wood;
  run(st, 1, [{ playerId: 'p1', cmd: { k: 'buywood', bulk: true } }]);
  assert(hp.wood - w0 === 8 && hp.gold === 100000, `8 de madera por 500 000 de oro (${hp.wood - w0}, quedan ${hp.gold})`);
  // objetos nuevos en la tienda
  const names = (line: string) => (ITEMS as any)[line].tiers.map((t: any) => t.name);
  assert(names('armor').includes('Égida del fin') && names('regen').includes('Savia eterna III') && names('life').includes('Corazón eterno III') && names('gloves').includes('Garras del caos'), 'están el último escudo, regeneración y vida de madera y los últimos guantes');
  // lobos: el cazador puede no admitirlos
  run(st, 1, [{ playerId: 'p1', cmd: { k: 'wolves', allow: false } }]);
  assert(buildHuntSnap(st, 'p2').wolves === false, 'el cazador puede no admitir lobos');
  run(st, 1, [{ playerId: 'p1', cmd: { k: 'wolves', allow: true } }]);

  // Rastreador: red al colono cercano y olfato que descubre invisibles
  hp.wood = 20;
  elf.x = map.camp.x + 30.5; // lejos al comprarlo
  elf.y = map.camp.y + 0.5;
  run(st, 1, [{ playerId: 'p1', cmd: { k: 'beast' } }]);
  const beast = st.units.find((u) => u.kind === 'beast' && u.alive)!;
  assert(!!beast, 'compra el Rastreador');
  elf.x = beast.x + 3;
  elf.y = beast.y;
  elf.rootUntil = 0;
  run(st, 2);
  assert(st.units.some((o) => o.alive && (o.kind === 'elf' || o.kind === 'repairer' || o.kind === 'lumberjack') && o.rootUntil > st.tick) && (beast.ready.ensnare ?? 0) > st.tick, 'el Rastreador lanza su red a un colono cercano (inmóvil 5 s)');
  assert(st.eyes.some((e) => e.detect && e.side === 'hunter'), 'el Rastreador olfatea: descubre invisibles a su alrededor');
}
{
  // dos trolls: «Regreso» señalando al otro troll te lleva con él
  const st = createHunt(8, roster, ['p1', 'p3']);
  run(st, sec(PHASE.headStartSec) + 1);
  const a = mainUnit(st, 'p1')!;
  const b = mainUnit(st, 'p3')!;
  b.x = map.camp.x + 12.5;
  b.y = map.camp.y + 0.5;
  run(st, sec(3), [{ playerId: 'p1', cmd: { k: 'ability', a: 'recall', x: b.x, y: b.y } }]);
  assert(Math.hypot(a.x - b.x, a.y - b.y) < 1, `«Regreso» señalando a un aliado te lleva con él (${a.x.toFixed(1)},${a.y.toFixed(1)})`);
  assert(st.players.filter((p) => p.form === 'hunter').length === 2, 'puede haber dos trolls');
}
{
  // torres: el Dragón puede saltar al de hielo; el Altar acaba en verde O misterio
  const st = createHunt(9, roster, 'p1');
  const ana = P(st, 'p2');
  const elf = mainUnit(st, 'p2')!;
  elf.x = inner.x + 0.5;
  elf.y = inner.y + 0.5;
  run(st, sec(5), [{ playerId: 'p2', cmd: { k: 'build', type: 'tower', cx: inner.x + 1, cy: inner.y } }]);
  const t = st.buildings.find((b) => b.type === 'tower')!;
  assert(!!t, 'construye una torre');
  if (t) {
    ana.gold = 1e9;
    ana.wood = 1e9;
    // tecnología máxima para la prueba: una Fortaleza (taller nivel 5) de mentira
    st.buildings.push({ ...t, id: 99999, type: 'workshop', level: 5, cx: t.cx, cy: t.cy + 30, size: 2 });
    t.level = 11;
    run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: t.id, branch: 'ice' } }]);
    assert(t.level === 13 || st.players.length < 0, `desde la Torre del dragón se puede saltar al Dragón de hielo (nivel ${t.level})`);
    t.level = 14;
    run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: t.id } }]);
    assert(t.level === 14, 'en el Altar maldito hay que elegir rama');
    run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: t.id, branch: 'green' } }]);
    assert(t.level === 15, 'Altar → Dragón verde');
    run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: t.id } }]);
    assert(t.level === 15, 'el Dragón verde es el final de su rama');
    t.level = 14;
    run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: t.id, branch: 'mystery' } }]);
    assert(t.level === 16, 'Altar → Torre del misterio');
  }
}

{
  // Paladín (madera y Luz sagrada) y la Hacha del fin (daño en área)
  const bld = (id: number, type: string, level: number, cx: number, cy: number, size: number): any => ({ id, owner: 'p2', type, level, cx, cy, size, hp: 100, maxHp: 100, wallBranch: null, towerBranch: 'main', luckArmor: 0, luckReady: 0, invulnUntil: 0, packedUntil: 0, investGold: 0, investWood: 0, eyeUntil: 0, stunUntil: 0, howlUntil: 0, retro: 0, cd: 0, forceUntil: 0 });
  const st = createHunt(10, roster, 'p1');
  const ana = P(st, 'p2');
  const ws = bld(60001, 'workshop', 5, houseCell.x, houseCell.y, 2); // Fortaleza: tecnología máxima
  st.buildings.push(ws, bld(60002, 'house', 10, houseCell.x + 3, houseCell.y, 2));
  ana.gold = 100000;
  ana.wood = 300;
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'train', id: ws.id, unit: 'repairer', tier: 5 } }]);
  const pal = st.units.find((u) => u.kind === 'repairer' && u.tier === 5 && u.alive);
  assert(!!pal && ana.wood === 300 - 256, `el Paladín cuesta 256 de madera además del oro (madera ${ana.wood})`);
  if (pal) {
    ws.hp = ws.maxHp * 0.2;
    const hp0 = ws.hp;
    run(st, 2);
    assert(ws.hp - hp0 > ws.maxHp * 0.2, `Luz sagrada: cura de golpe 5 + 35 % de lo que falta (${hp0.toFixed(0)} → ${ws.hp.toFixed(0)})`);
  }
  // Hacha del fin: el golpe al edificio también daña a los de alrededor
  const st2 = createHunt(11, roster, 'p1');
  run(st2, sec(PHASE.headStartSec) + 1);
  const hp = P(st2, 'p1');
  const h = huntHunterUnit(st2)!;
  hp.inv[0] = { kind: 'item', line: 'weapon', tier: ITEMS.weapon.tiers.length - 1 };
  const mk = (id: number, cx: number) => ({ id, owner: 'p2', type: 'wall' as const, level: 1, cx, cy: Math.floor(h.y) - 2, size: 1, hp: 1e12, maxHp: 1e12, wallBranch: null, towerBranch: 'main' as const, luckArmor: 0, luckReady: 0, invulnUntil: 0, packedUntil: 0, investGold: 0, investWood: 0, eyeUntil: 0, stunUntil: 0, howlUntil: 0, retro: 0, cd: 0, forceUntil: 0 });
  const w1: any = mk(70001, Math.floor(h.x));
  const w2: any = mk(70002, Math.floor(h.x) + 1);
  st2.buildings.push(w1, w2);
  h.y = w1.cy + 1.5;
  h.x = w1.cx + 0.5;
  run(st2, 3, [{ playerId: 'p1', cmd: { k: 'attack', target: w1.id } }]);
  assert(w1.hp < 1e12 && w2.hp < 1e12, 'la Hacha del fin daña también el edificio de al lado');
}

console.log('maná y murallas del original');
{
  const st = createHunt(12, roster, 'p1');
  const hp = P(st, 'p1');
  assert(hp.mana === 200, `el troll empieza con 200 de maná (${hp.mana})`);
  run(st, 1, [{ playerId: 'p1', cmd: { k: 'ability', a: 'eye', x: 50, y: 50 } }]);
  assert(Math.abs(hp.mana - (200 - 60)) < 1, `el Ojo cuesta 60 de maná (${hp.mana.toFixed(1)})`);
  hp.mana = 5;
  hp.cds = {};
  run(st, 1, [{ playerId: 'p1', cmd: { k: 'ability', a: 'eye', x: 50, y: 50 } }]);
  assert(!(hp.cds.eye && hp.cds.eye > st.tick), 'sin maná no se puede lanzar');
  // aleatoria: se convierte al instante en una rama de verdad
  const ana = P(st, 'p2');
  ana.gold = 100000;
  const w: any = { id: 50001, owner: 'p2', type: 'wall', level: 5, cx: 5, cy: 5, size: 1, hp: 250, maxHp: 250, wallBranch: null, towerBranch: 'main', luckArmor: 0, luckReady: 0, invulnUntil: 0, packedUntil: 0, investGold: 0, investWood: 0, eyeUntil: 0, stunUntil: 0, howlUntil: 0, retro: 0, cd: 0, forceUntil: 0 };
  st.buildings.push(w);
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: w.id, branch: 'random' } }]);
  assert(w.level === 6 && w.wallBranch !== 'random' && w.luckReady > st.tick, `la aleatoria sale como muralla de ${w.wallBranch} y podrá sortear a los 3 min`);
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: w.id, branch: 'gold' } }]);
  const w2: any = { ...w, id: 50002, level: 5, wallBranch: null, luckReady: 0 };
  st.buildings.push(w2);
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: w2.id, branch: 'gold' } }]);
  assert(w2.level === 5, 'la muralla de oro no se elige directamente');
}

console.log('ejército élfico (Cenarion Keep)');
{
  const st = createHunt(13, roster, 'p1');
  run(st, sec(PHASE.headStartSec) + 1);
  const ana = P(st, 'p2');
  const h = huntHunterUnit(st)!;
  const keep: any = { id: 40001, owner: 'p2', type: 'workshop', level: 5, cx: Math.floor(h.x) + 3, cy: Math.floor(h.y) + 3, size: 2, hp: 400, maxHp: 400, wallBranch: null, towerBranch: 'main', luckArmor: 0, luckReady: 0, invulnUntil: 0, packedUntil: 0, investGold: 0, investWood: 0, eyeUntil: 0, stunUntil: 0, howlUntil: 0, retro: 0, cd: 0, forceUntil: 0 };
  const house: any = { ...keep, id: 40002, type: 'house', level: 10, cx: keep.cx + 30 };
  st.buildings.push(keep, house);
  ana.gold = 1e6;
  ana.wood = 1e6;
  const hp0 = h.hp;
  h.maxHp = h.hp = 1e9; // que aguante para medir
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'army', id: keep.id, kind: 'elfhunter' } }]);
  const eh = st.units.find((u) => u.kind === 'elfhunter' && u.alive);
  assert(!!eh && ana.gold === 1e6 - 5120 && ana.wood === 1e6 - 160, 'la Fortaleza entrena una cazadora elfa (5120 de oro + 160 de madera)');
  run(st, sec(4));
  assert(h.hp < 1e9, `la cazadora dispara sola al cazador cercano (${(1e9 - h.hp).toFixed(0)} de daño)`);
  void hp0;
  // gigante: piel dura
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'army', id: keep.id, kind: 'giant' } }]);
  const gi = st.units.find((u) => u.kind === 'giant' && u.alive)!;
  assert(!!gi, 'entrena un gigante de montaña');
  // búho: invisible para el cazador
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'army', id: keep.id, kind: 'owl' } }]);
  const owl = st.units.find((u) => u.kind === 'owl' && u.alive)!;
  assert(!!owl && !buildHuntSnap(st, 'p1').units.some((u) => u[0] === owl.id), 'el búho es invisible para el cazador');
  // y descubre al cazador invisible
  h.invisUntil = st.tick + 999;
  owl.x = h.x + 1;
  owl.y = h.y;
  assert(buildHuntSnap(st, 'p2').units.some((u) => u[0] === h.id), 'el búho descubre al cazador invisible');
}

console.log('WASD (steer)');
{
  const st = createHunt(2, roster, 'p1');
  const elf = mainUnit(st, 'p2')!;
  elf.x = inner.x + 0.5;
  elf.y = inner.y + 0.5;
  const x0 = elf.x;
  run(st, sec(1), [{ playerId: 'p2', cmd: { k: 'steer', dx: 1, dy: 0 } }]);
  assert(elf.x > x0 + 1, `el colono anda hacia la derecha con D (${(elf.x - x0).toFixed(2)} casillas en 1 s)`);
  // contra la pared: no la atraviesa
  run(st, sec(20));
  const solid = (u: { x: number; y: number }) => map.tiles[Math.floor(u.y) * map.w + Math.floor(u.x)] !== 0;
  assert(!solid(elf) && map.plotOf[Math.floor(elf.y) * map.w + Math.floor(elf.x)] === plot.id, 'contra la pared se para sin atravesarla');
  // diagonal: se desliza por la pared
  const y1 = elf.y;
  run(st, sec(1), [{ playerId: 'p2', cmd: { k: 'steer', dx: 1, dy: 1 } }]);
  assert(Math.abs(elf.y - y1) > 0.3 || solid({ x: elf.x, y: elf.y + 0.5 }), 'en diagonal contra la pared se desliza');
  // soltar: se queda quieto
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'steer', dx: 0, dy: 0 } }]);
  const sx = elf.x;
  const sy = elf.y;
  run(st, sec(2));
  assert(elf.x === sx && elf.y === sy, 'al soltar las teclas se queda quieto');
  // una orden (construir) suelta el WASD
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'steer', dx: -1, dy: 0 } }]);
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'build', type: 'wall', cx: door.x, cy: door.y } }]);
  assert(elf.sx === 0 && elf.sy === 0, 'una orden de construir suelta la dirección');
  // entrar por una puerta de 1 casilla yendo descentrado: la esquina te guía
  {
    const st3 = createHunt(4, roster, 'p1');
    const e3 = mainUnit(st3, 'p2')!;
    const o = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ dx, dy })).find(({ dx, dy }) => map.tiles[(door.y + dy) * map.w + door.x + dx] === 0 && map.plotOf[(door.y + dy) * map.w + door.x + dx] !== plot.id)!;
    // fuera, a 2 casillas de la puerta, desplazado 0,3 de lado
    e3.x = door.x + 0.5 + o.dx * 2 + (o.dy ? 0.3 : 0);
    e3.y = door.y + 0.5 + o.dy * 2 + (o.dx ? 0.3 : 0);
    run(st3, sec(2), [{ playerId: 'p2', cmd: { k: 'steer', dx: -o.dx, dy: -o.dy } }]);
    assert(map.plotOf[Math.floor(e3.y) * map.w + Math.floor(e3.x)] === plot.id, `entra por la puerta de 1 casilla aunque vaya descentrado (${e3.x.toFixed(2)}, ${e3.y.toFixed(2)})`);
  }
  // el cazador con WASD golpea lo que tiene pegado
  const st2 = createHunt(3, roster, 'p1');
  run(st2, sec(PHASE.headStart) + 2);
  const ana = mainUnit(st2, 'p2')!;
  ana.x = inner.x + 0.5;
  ana.y = inner.y + 0.5;
  run(st2, sec(30), [{ playerId: 'p2', cmd: { k: 'build', type: 'wall', cx: door.x, cy: door.y } }]);
  const wall = st2.buildings.find((b) => b.type === 'wall');
  const hunter = huntHunterUnit(st2)!;
  // fuera de la puerta, mirando hacia la muralla
  const outs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ dx, dy, x: door.x + dx, y: door.y + dy })).filter((o) => map.tiles[o.y * map.w + o.x] === 0 && map.plotOf[o.y * map.w + o.x] !== plot.id);
  if (wall && outs.length) {
    const o = outs[0];
    hunter.x = o.x + 0.5 + o.dx * 0.6;
    hunter.y = o.y + 0.5 + o.dy * 0.6;
    const hp0 = wall.hp;
    run(st2, sec(4), [{ playerId: 'p1', cmd: { k: 'steer', dx: -o.dx, dy: -o.dy } }]);
    assert(wall.hp < hp0, `el cazador empuja con WASD contra la muralla y la golpea (${hp0} → ${wall.hp.toFixed(0)})`);
    // pegado a la muralla y empujando: nunca la atraviesa (ni en el servidor)
    const inside = () => map.plotOf[Math.floor(hunter.y) * map.w + Math.floor(hunter.x)] === plot.id;
    run(st2, sec(3), [{ playerId: 'p1', cmd: { k: 'steer', dx: -o.dx, dy: -o.dy } }]);
    assert(!inside(), 'empujando contra la muralla el cazador no entra en la base');
    let acting = 0;
    for (let i = 0; i < sec(3); i++) {
      run(st2, 1);
      acting = Math.max(acting, buildHuntSnap(st2, 'p1').units.find((u) => u[0] === hunter.id)?.[9] ?? 0);
    }
    assert(acting > 0, `el snapshot marca hacia dónde golpea (para la animación): ${acting}`);
  } else assert(false, 'no se pudo preparar la prueba del cazador contra la muralla');
}

console.log('bot y rendimiento');
{
  const big = [
    { id: 'p1', name: 'A', color: '#f00' },
    { id: 'p2', name: 'B', color: '#0f0' },
    { id: 'p3', name: 'C', color: '#00f' },
    { id: 'p4', name: 'D', color: '#ff0' },
    { id: 'p5', name: 'E', color: '#0ff' },
    { id: 'p6', name: 'F', color: '#f0f' },
    { id: 'p7', name: 'G', color: '#fff' },
    HUNT_BOT,
  ];
  const st = createHunt(7, big, HUNT_BOT.id);
  const mem = createHuntBotMemory();
  // cada colono se mete en una parcela distinta, la cierra y monta casa, taller y torres
  const plots = map.plots.filter((p) => p.doors.length === 1).slice(0, 7);
  const t0 = performance.now();
  let maxTick = 0;
  for (let i = 0; i < sec(600) && !st.over; i++) {
    const cmds: HuntPlayerCommand[] = [];
    if (i === 0) {
      plots.forEach((pl, k) => {
        const d = pl.doors[0];
        cmds.push({ playerId: big[k].id, cmd: { k: 'build', type: 'wall', cx: d.x, cy: d.y } });
      });
    }
    if (i % sec(5) === 0) {
      for (const pp of st.players) {
        if (pp.form !== 'elf') continue;
        for (const b of st.buildings.filter((o) => o.owner === pp.id)) cmds.push({ playerId: pp.id, cmd: { k: 'upgrade', id: b.id, branch: 'rock' } });
      }
    }
    for (const cmd of huntBotCommands(st, mem)) cmds.push({ playerId: HUNT_BOT.id, cmd });
    const a = performance.now();
    stepHunt(st, cmds);
    for (const pp of st.players) buildHuntSnap(st, pp.id);
    maxTick = Math.max(maxTick, performance.now() - a);
  }
  const ms = (performance.now() - t0) / Math.min(sec(600), st.tick);
  const botP = st.players.find((p) => p.id === HUNT_BOT.id)!;
  assert(botP.stats.goldEarned > 300, `el bot gana oro golpeando (${Math.round(botP.stats.goldEarned)})`);
  assert(ms < 4, `tick medio con 8 jugadores + snapshots: ${ms.toFixed(2)} ms (máx ${maxTick.toFixed(1)} ms)`);
  console.log(`    (10 min: bot nivel ${botP.level}, ${st.players.filter((p) => p.form === 'elf' && p.alive).length} colonos vivos, fin ${st.over?.winner ?? 'sigue'})`);
}

console.log(failed === 0 ? '\nTODO OK' : `\n${failed} FALLOS`);
process.exit(failed === 0 ? 0 : 1);
