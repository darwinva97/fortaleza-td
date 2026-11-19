// Prueba de la sim de CACERÍA: `npx tsx tools/hunttest.ts`.
// No mide diversión; comprueba que las reglas hacen lo que dicen y que el
// servidor aguanta una partida grande.
import {
  HUNT_BOT,
  PHASE,
  TICK_RATE,
  armorMult,
  buildHuntSnap,
  createHunt,
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
  assert(Math.abs(ana.gold - g0 - 10) <= 1, `la casa de nivel 1 da 1 de oro/s (${ana.gold - g0} en 10 s)`);
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
  const expected = Math.max(1, 5 - 1) * armorMult(5);
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
  }
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
  assert(ana.alive && ana.hp === 5, 'el primer golpe deja al colono a media vida');
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
  assert(huntHunterUnit(st)!.maxHp === 1000, 'el corazón sube la vida máxima a 1000');
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
