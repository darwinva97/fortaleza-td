// Prueba de la sim de CACERÍA con bots: `npx tsx tools/hunttest.ts`.
// No mide diversión; comprueba que las reglas hacen lo que dicen.
import {
  HUNT,
  HUNT_BOT,
  TICK_RATE,
  createHuntBotMemory,
  huntBotCommands,
  buildHuntSnap,
  createHunt,
  filterHuntEvents,
  getHuntMap,
  huntHunterUnit,
  huntMaxHp,
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
const run = (st: HuntState, ticks: number, cmds: HuntPlayerCommand[] = []) => {
  const evs = stepHunt(st, cmds);
  for (let i = 1; i < ticks && !st.over; i++) evs.push(...stepHunt(st, []));
  return evs;
};
const sec = (s: number) => Math.round(s * TICK_RATE);
const map = getHuntMap();

console.log('mapa');
assert(map.bases.length === 6, 'hay 6 bases');
assert(map.bases.every((b) => map.tiles[b.door.y * map.w + b.door.x] === 0), 'cada base tiene su entrada abierta');
{
  // cada interior de base es alcanzable desde la guarida
  const seen = new Set<number>([map.camp.y * map.w + map.camp.x]);
  const q = [...seen];
  while (q.length) {
    const i = q.pop()!;
    for (const d of [1, -1, map.w, -map.w]) {
      const j = i + d;
      if (map.tiles[j] === 0 && !seen.has(j)) {
        seen.add(j);
        q.push(j);
      }
    }
  }
  assert(map.bases.every((b) => seen.has((b.y + 3) * map.w + b.x + 4)), 'todas las bases son alcanzables');
}

console.log('retención y movimiento');
{
  const st = createHunt(1, roster, 'p1');
  const h = huntHunterUnit(st)!;
  const x0 = h.x;
  const ev = run(st, sec(2), [{ playerId: 'p1', cmd: { k: 'move', x: 10, y: 20 } }]);
  assert(h.x === x0, 'el cazador no se mueve mientras está retenido');
  assert(ev.some((e) => e.e === 'reject'), 'y recibe el aviso');
  const c = st.units.find((u) => u.owner === 'p2')!;
  const cx0 = c.x;
  run(st, sec(3), [{ playerId: 'p2', cmd: { k: 'move', x: 9, y: 5 } }]);
  assert(c.x !== cx0, 'el colono sí se mueve desde el principio');
  run(st, sec(HUNT.RELEASE_SEC));
  run(st, sec(3), [{ playerId: 'p1', cmd: { k: 'move', x: 10, y: 20 } }]);
  assert(h.x < x0 - 5, 'tras soltarlo, el cazador se mueve');
}

console.log('base cerrada, economía y asedio');
{
  const st = createHunt(2, roster, 'p1');
  const base = map.bases[1]; // arriba al centro
  const c = st.units.find((u) => u.owner === 'p2')!;
  run(st, sec(12), [{ playerId: 'p2', cmd: { k: 'move', x: base.x + 4, y: base.y + 3 } }]);
  assert(Math.floor(c.x) === base.x + 4 && Math.floor(c.y) === base.y + 3, 'el colono llega al interior de la base');
  const ev = run(st, 2, [
    { playerId: 'p2', cmd: { k: 'build', type: 'wall', cx: base.door.x, cy: base.door.y } },
    { playerId: 'p2', cmd: { k: 'build', type: 'treasury', cx: base.x + 2, cy: base.y + 2 } },
    { playerId: 'p2', cmd: { k: 'build', type: 'tower', cx: base.x + 4, cy: base.y + 4 } },
    { playerId: 'p2', cmd: { k: 'build', type: 'treasury', cx: base.x + 3, cy: base.y + 2 } },
  ]);
  assert(st.buildings.length === 3, 'construye muralla, tesorería y torre');
  assert(ev.some((e) => e.e === 'reject' && e.reason.includes('una')), 'la segunda tesorería se rechaza');
  const p2 = st.players.find((p) => p.id === 'p2')!;
  const gold0 = p2.gold;
  run(st, sec(10));
  assert(p2.gold === gold0 + 10, 'la tesorería nivel 1 da 1 de oro por segundo');
  const wall = st.buildings.find((b) => b.type === 'wall')!;
  const treasury = st.buildings.find((b) => b.type === 'treasury')!;
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: treasury.id } }]);
  assert(treasury.level === 1 || p2.gold < 50, 'la tesorería no sube sin oro');
  p2.gold = 1000;
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: treasury.id } }]);
  assert(treasury.level === 2, 'con muralla nivel 1, la tesorería sube a 2');
  const r = run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: treasury.id } }]);
  assert(treasury.level === 2 && r.some((e) => e.e === 'reject'), 'pero a 3 exige subir la muralla');
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'upgrade', id: wall.id } }]);
  assert(wall.level === 2 && wall.maxHp === huntMaxHp('wall', 2), 'la muralla sube y duplica su vida');

  // taller y obreros: reparan la muralla dañada
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'build', type: 'workshop', cx: base.x + 6, cy: base.y + 2 } }]);
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'worker' } }]);
  assert(p2.workers === 1, 'contrata un obrero en el taller');
  wall.hp = 10;
  run(st, sec(5));
  assert(wall.hp > 10, 'el obrero repara la muralla');

  // el cazador no puede entrar: va a la muralla y la golpea
  run(st, sec(HUNT.RELEASE_SEC));
  const h = huntHunterUnit(st)!;
  const hp = st.players.find((p) => p.id === 'p1')!;
  run(st, sec(12), [{ playerId: 'p1', cmd: { k: 'move', x: base.x + 4, y: base.y + 3 } }]);
  assert(!(Math.floor(h.y) < base.y + 6), 'la muralla le cierra el paso');
  const g0 = hp.gold;
  const hpWall = wall.hp;
  run(st, sec(8), [{ playerId: 'p1', cmd: { k: 'attack', target: wall.id } }]);
  assert(wall.hp < hpWall || !st.buildings.includes(wall), 'el cazador daña la muralla');
  assert(hp.gold > g0 + 8, 'y cobra oro por cada golpe');
  assert(h.hp < h.maxHp, 'la torre le dispara mientras tanto');
  // visión: el cazador no ve la tesorería del fondo salvo que esté cerca
  const snapH = buildHuntSnap(st, 'p1');
  const snapC = buildHuntSnap(st, 'p2');
  assert(snapC.buildings.length >= snapH.buildings.length, 'el colono ve todos sus edificios');
  assert(snapH.players.find((p) => p.id === 'p2')!.gold === -1, 'el cazador no ve el oro del colono');
}

console.log('caza y final');
{
  const st = createHunt(3, roster, 'p1');
  run(st, sec(HUNT.RELEASE_SEC) + 1);
  const victim = st.units.find((u) => u.owner === 'p2')!;
  const ev = run(st, sec(6), [{ playerId: 'p1', cmd: { k: 'attack', target: victim.id } }]);
  assert(!victim.alive, 'el cazador alcanza y mata de un golpe a un colono quieto');
  assert(ev.some((e) => e.e === 'death'), 'se anuncia la baja');
  assert(st.over === null, 'la partida sigue: queda otro colono');
  assert(filterHuntEvents(st, 'p3', [{ e: 'reject', priv: 'p1', reason: 'x' }]).length === 0, 'los avisos privados no llegan a otros');
  const other = st.units.find((u) => u.owner === 'p3')!;
  run(st, sec(8), [{ playerId: 'p1', cmd: { k: 'attack', target: other.id } }]);
  assert(st.over?.winner === 'hunter', 'sin colonos vivos gana el cazador');
}
{
  // las torres pueden matar al cazador
  const st = createHunt(4, roster, 'p1');
  const h = huntHunterUnit(st)!;
  const c = st.units.find((u) => u.owner === 'p2')!;
  st.players.find((p) => p.id === 'p2')!.gold = 100;
  run(st, sec(4), [{ playerId: 'p2', cmd: { k: 'move', x: map.camp.x + 7, y: map.camp.y } }]);
  run(st, 2, [{ playerId: 'p2', cmd: { k: 'build', type: 'tower', cx: Math.floor(c.x), cy: Math.floor(c.y) + 1 } }]);
  assert(st.buildings.length === 1, 'torre construida fuera de la zona de la guarida');
  run(st, sec(HUNT.RELEASE_SEC));
  run(st, sec(4), [{ playerId: 'p1', cmd: { k: 'move', x: c.x - 3, y: c.y } }]);
  h.hp = 1; // fuera de la guarida ya no se cura
  run(st, sec(3));
  assert(st.over?.winner === 'colonist' && st.over.reason === 'hunter_dead', 'si el cazador muere ganan los colonos');
}
{
  const st = createHunt(5, roster, 'p1');
  st.endTick = sec(5);
  run(st, sec(6));
  assert(st.over?.winner === 'colonist' && st.over.reason === 'time', 'si se acaba el tiempo ganan los colonos');
}
{
  const st = createHunt(6, roster, 'p1');
  const c = st.units.find((u) => u.owner === 'p2')!;
  const x0 = c.x;
  run(st, 1, [{ playerId: 'p2', cmd: { k: 'blink', x: c.x + 6, y: c.y } }]);
  assert(Math.abs(c.x - x0) > 5, 'el colono salta');
  const r = run(st, 1, [{ playerId: 'p2', cmd: { k: 'blink', x: c.x + 3, y: c.y } }]);
  assert(r.some((e) => e.e === 'reject'), 'y el salto queda en recarga');
}

console.log('bot cazador');
{
  const solo = [{ id: 'p2', name: 'Ana', color: '#0f0' }, HUNT_BOT];
  const play = (st: HuntState, seconds: number, each?: (t: number) => HuntPlayerCommand[]) => {
    const mem = createHuntBotMemory();
    for (let i = 0; i < sec(seconds) && !st.over; i++) {
      const cmds: HuntPlayerCommand[] = each ? each(i) : [];
      for (const cmd of huntBotCommands(st, mem)) cmds.push({ playerId: HUNT_BOT.id, cmd });
      stepHunt(st, cmds);
    }
    return mem;
  };
  // un colono que se queda quieto junto a la guarida no dura nada
  const st1 = createHunt(11, solo, HUNT_BOT.id);
  play(st1, HUNT.RELEASE_SEC + 15);
  assert(st1.over?.winner === 'hunter', 'el bot caza a un colono que no se mueve');

  // un colono encerrado: el bot encuentra la base, golpea la muralla y va a comprar
  const st2 = createHunt(12, solo, HUNT_BOT.id);
  const base = map.bases[4];
  const bot = st2.players.find((p) => p.id === HUNT_BOT.id)!;
  const ana = st2.players.find((p) => p.id === 'p2')!;
  const mem = play(st2, 240, (t) => {
    if (t === 0) return [{ playerId: 'p2', cmd: { k: 'move', x: base.x + 4.5, y: base.y + 3.5 } }];
    if (t === sec(20)) {
      return [
        { playerId: 'p2', cmd: { k: 'build', type: 'wall', cx: base.door.x, cy: base.door.y } },
        { playerId: 'p2', cmd: { k: 'build', type: 'treasury', cx: base.x + 2, cy: base.y + 3 } },
      ];
    }
    // sube la muralla cada vez que puede, como haría una persona
    if (t % sec(3) === 0) {
      const wall = st2.buildings.find((b) => b.type === 'wall');
      if (wall && ana.gold >= 8 * 2 ** (wall.level - 1)) return [{ playerId: 'p2', cmd: { k: 'upgrade', id: wall.id } }];
    }
    return [];
  });
  assert(mem.known.size > 0 || st2.over !== null, 'el bot localiza la base del colono');
  assert(bot.damage > 0, 'y golpea sus edificios');
  assert(bot.weapon > 0 || st2.over !== null, 'con el oro que saca, vuelve y compra garras');
  console.log(`    (4 min: garras ${bot.weapon}, pellejo ${bot.vitality}, oro ${Math.floor(bot.gold)}, fin ${st2.over?.winner ?? 'sigue'})`);
}

console.log(failed === 0 ? '\nTODO OK' : `\n${failed} FALLOS`);
process.exit(failed === 0 ? 0 : 1);
